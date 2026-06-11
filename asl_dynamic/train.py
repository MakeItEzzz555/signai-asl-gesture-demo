"""Research-grade training for dynamic ASL (BiGRU + attention)."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import GroupShuffleSplit, StratifiedGroupKFold
from torch.optim import AdamW
from torch.optim.lr_scheduler import LambdaLR
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler

from .constants import RANDOM_SEED
from .data_io import load_labels, load_npz_dataset
from .evaluate import compute_metrics, save_confusion_matrix, save_metrics
from .model import AttentionBiGRUClassifier, ModelConfig, save_checkpoint


class SequenceDataset(Dataset):
    def __init__(self, x: np.ndarray, y: np.ndarray):
        self.x = x.astype(np.float32)
        self.y = y.astype(np.int64)

    def __len__(self) -> int:
        return len(self.y)

    def __getitem__(self, idx: int):
        return torch.from_numpy(self.x[idx]), torch.tensor(self.y[idx], dtype=torch.long)


def set_seed(seed: int) -> None:
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train Attention-BiGRU on [30,126] dynamic ASL sequences")
    p.add_argument("--train-npz", type=Path, default=Path("dataset/processed/train.npz"))
    p.add_argument("--test-npz", type=Path, default=Path("dataset/processed/test.npz"))
    p.add_argument("--labels-json", type=Path, default=Path("dataset/processed/labels.json"))
    p.add_argument("--out-dir", type=Path, default=Path("artifacts/asl_dynamic_research"))

    p.add_argument("--epochs", type=int, default=80)
    p.add_argument("--warmup-epochs", type=int, default=5)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--weight-decay", type=float, default=3e-4)
    p.add_argument("--label-smoothing", type=float, default=0.10,
                   help="Cross-entropy label-smoothing factor.  Reduces overconfidence "
                        "and improves generalisation on small ASL datasets.  0 = disabled.")
    p.add_argument("--val-size", type=float, default=0.2)
    p.add_argument("--patience", type=int, default=15)

    p.add_argument("--hidden-size", type=int, default=128)
    p.add_argument("--num-layers", type=int, default=2)
    p.add_argument("--dropout", type=float, default=0.40)

    p.add_argument("--num-workers", type=int, default=0)
    p.add_argument("--seed", type=int, default=RANDOM_SEED)
    p.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    return p.parse_args()


def split_train_val(
    x: np.ndarray,
    y: np.ndarray,
    groups: np.ndarray,
    val_size: float,
    seed: int,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Signer-balanced validation split from training data."""
    if len(np.unique(groups)) < 2:
        # fallback: random split if all samples have same signer id
        idx = np.arange(len(y))
        np.random.default_rng(seed).shuffle(idx)
        n_val = max(1, int(round(len(idx) * val_size)))
        val_idx = idx[:n_val]
        tr_idx = idx[n_val:]
        return x[tr_idx], x[val_idx], y[tr_idx], y[val_idx]

    n_splits = int(round(1.0 / max(1e-6, val_size)))
    n_splits = min(max(n_splits, 2), 10)

    try:
        sgkf = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
        best = None
        best_score = float("inf")
        dummy = np.zeros((len(y), 1), dtype=np.float32)
        for tr_idx, va_idx in sgkf.split(dummy, y, groups=groups):
            ratio_err = abs(len(va_idx) / len(y) - val_size)
            score = ratio_err
            if score < best_score:
                best = (tr_idx, va_idx)
                best_score = score
        if best is not None:
            tr_idx, va_idx = best
            return x[tr_idx], x[va_idx], y[tr_idx], y[va_idx]
    except Exception:
        pass

    gss = GroupShuffleSplit(n_splits=1, test_size=val_size, random_state=seed)
    tr_idx, va_idx = next(gss.split(np.zeros(len(y)), y, groups=groups))
    return x[tr_idx], x[va_idx], y[tr_idx], y[va_idx]


def make_weighted_sampler(y: np.ndarray) -> WeightedRandomSampler:
    counts = np.bincount(y)
    counts = np.clip(counts, 1, None)
    class_weights = 1.0 / counts
    sample_weights = class_weights[y]
    return WeightedRandomSampler(
        weights=torch.from_numpy(sample_weights.astype(np.float64)),
        num_samples=len(sample_weights),
        replacement=True,
    )


def make_class_weights(y: np.ndarray, num_classes: int) -> torch.Tensor:
    """Tempered inverse-frequency weights for CrossEntropy loss."""
    counts = np.bincount(y, minlength=num_classes).astype(np.float32)
    counts = np.clip(counts, 1.0, None)
    inv_sqrt = 1.0 / np.sqrt(counts)
    weights = inv_sqrt * (num_classes / float(np.sum(inv_sqrt)))
    return torch.from_numpy(weights.astype(np.float32))


def create_warmup_cosine_lambda(total_epochs: int, warmup_epochs: int):
    warmup_epochs = max(1, min(warmup_epochs, total_epochs))

    def fn(epoch_idx: int) -> float:
        # epoch_idx starts at 0
        if epoch_idx < warmup_epochs:
            return float(epoch_idx + 1) / float(warmup_epochs)

        progress = (epoch_idx - warmup_epochs) / max(1, (total_epochs - warmup_epochs))
        cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
        return max(0.05, cosine)

    return fn


def run_epoch(
    model: AttentionBiGRUClassifier,
    loader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
    optimizer: AdamW | None,
) -> Tuple[float, np.ndarray, np.ndarray]:
    train_mode = optimizer is not None
    model.train(train_mode)

    total_loss = 0.0
    y_true_list = []
    y_pred_list = []

    for x_batch, y_batch in loader:
        x_batch = x_batch.to(device)
        y_batch = y_batch.to(device)

        if train_mode:
            optimizer.zero_grad(set_to_none=True)

        logits = model(x_batch)
        loss = criterion(logits, y_batch)

        if train_mode:
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

        total_loss += float(loss.item()) * y_batch.size(0)

        pred = torch.argmax(logits, dim=1)
        y_true_list.append(y_batch.detach().cpu().numpy())
        y_pred_list.append(pred.detach().cpu().numpy())

    n = len(loader.dataset)
    avg_loss = total_loss / max(1, n)
    y_true = np.concatenate(y_true_list) if y_true_list else np.array([], dtype=np.int64)
    y_pred = np.concatenate(y_pred_list) if y_pred_list else np.array([], dtype=np.int64)
    return avg_loss, y_true, y_pred


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    labels = load_labels(args.labels_json)

    x_train_all, y_train_all, groups_train_all, _types_train = load_npz_dataset(args.train_npz)
    x_test, y_test, _groups_test, _types_test = load_npz_dataset(args.test_npz)

    x_train, x_val, y_train, y_val = split_train_val(
        x_train_all,
        y_train_all,
        groups=groups_train_all,
        val_size=args.val_size,
        seed=args.seed,
    )

    train_ds = SequenceDataset(x_train, y_train)
    val_ds = SequenceDataset(x_val, y_val)
    test_ds = SequenceDataset(x_test, y_test)

    sampler = make_weighted_sampler(y_train)
    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        sampler=sampler,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=False,
    )
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=args.num_workers)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=args.num_workers)

    device = torch.device(args.device)
    cfg = ModelConfig(
        hidden_size=args.hidden_size,
        num_layers=args.num_layers,
        dropout=args.dropout,
        num_classes=len(labels),
    )

    model = AttentionBiGRUClassifier(cfg).to(device)
    class_weights = make_class_weights(y_train, num_classes=len(labels)).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights, label_smoothing=args.label_smoothing)
    optimizer = AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    lr_lambda = create_warmup_cosine_lambda(total_epochs=args.epochs, warmup_epochs=args.warmup_epochs)
    scheduler = LambdaLR(optimizer, lr_lambda=lr_lambda)

    history = []
    best_val_f1 = -1.0
    best_epoch = -1
    stale_epochs = 0

    for epoch in range(1, args.epochs + 1):
        train_loss, train_true, train_pred = run_epoch(model, train_loader, criterion, device, optimizer)
        val_loss, val_true, val_pred = run_epoch(model, val_loader, criterion, device, optimizer=None)

        train_metrics = compute_metrics(train_true, train_pred, labels=labels)
        val_metrics = compute_metrics(val_true, val_pred, labels=labels)

        row = {
            "epoch": epoch,
            "lr": optimizer.param_groups[0]["lr"],
            "train_loss": train_loss,
            "val_loss": val_loss,
            "train_macro_f1": train_metrics["macro_f1"],
            "val_macro_f1": val_metrics["macro_f1"],
            "val_blank_fpr": val_metrics.get("blank_fpr", None),
        }
        history.append(row)

        print(
            f"Epoch {epoch:03d} | lr={row['lr']:.6f} "
            f"train_loss={train_loss:.4f} val_loss={val_loss:.4f} "
            f"train_f1={train_metrics['macro_f1']:.4f} val_f1={val_metrics['macro_f1']:.4f}"
        )

        if val_metrics["macro_f1"] > best_val_f1:
            best_val_f1 = val_metrics["macro_f1"]
            best_epoch = epoch
            stale_epochs = 0
            save_checkpoint(
                out_dir / "best.pt",
                model=model,
                labels=labels,
                cfg=cfg,
                epoch=epoch,
                metrics={
                    "val_macro_f1": best_val_f1,
                    "val_loss": val_loss,
                    "val_blank_fpr": val_metrics.get("blank_fpr", None),
                },
            )
        else:
            stale_epochs += 1

        scheduler.step()

        if stale_epochs >= args.patience:
            print(f"Early stopping at epoch {epoch}, best epoch={best_epoch}, best val F1={best_val_f1:.4f}")
            break

    save_checkpoint(
        out_dir / "last.pt",
        model=model,
        labels=labels,
        cfg=cfg,
        epoch=history[-1]["epoch"],
        metrics={"best_val_f1": best_val_f1, "best_epoch": best_epoch},
    )

    # Evaluate last model on test set.
    test_loss, test_true, test_pred = run_epoch(model, test_loader, criterion, device, optimizer=None)
    test_metrics: Dict = compute_metrics(test_true, test_pred, labels=labels)
    test_metrics["test_loss"] = float(test_loss)

    save_metrics(test_metrics, out_dir / "test_metrics.json")
    cm = np.array(test_metrics["confusion_matrix"], dtype=np.int64)
    np.save(out_dir / "confusion_matrix.npy", cm)
    save_confusion_matrix(cm, labels=labels, out_path=out_dir / "confusion_matrix.png")

    (out_dir / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")

    print(json.dumps({
        "best_epoch": best_epoch,
        "best_val_macro_f1": best_val_f1,
        "test_macro_f1": test_metrics["macro_f1"],
        "test_blank_fpr": test_metrics.get("blank_fpr", None),
        "out_dir": str(out_dir),
    }, indent=2))


if __name__ == "__main__":
    main()
