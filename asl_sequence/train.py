"""Train BiLSTM for dynamic ASL gesture-bundle classification."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import torch
import torch.nn as nn
from torch.optim import AdamW
from torch.optim.lr_scheduler import ReduceLROnPlateau
from torch.utils.data import DataLoader

from .checkpoint import save_checkpoint
from .constants import RANDOM_SEED
from .dataset_io import SequenceNPZDataset, load_label_map
from .metrics import compute_metrics
from .model import BiLSTMClassifier, ModelConfig
from .utils import ensure_dir, set_seed


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train BiLSTM on 64x126 ASL sequence windows")
    p.add_argument("--train-npz", type=Path, required=True)
    p.add_argument("--val-npz", type=Path, required=True)
    p.add_argument("--labels-json", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, default=Path("artifacts/bilstm_asl"))

    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--patience", type=int, default=8)

    p.add_argument("--hidden-size", type=int, default=256)
    p.add_argument("--num-layers", type=int, default=2)
    p.add_argument("--dropout", type=float, default=0.3)

    p.add_argument("--num-workers", type=int, default=2)
    p.add_argument("--seed", type=int, default=RANDOM_SEED)
    p.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    return p.parse_args()


def class_weights_from_dataset(ds: SequenceNPZDataset, num_classes: int) -> torch.Tensor:
    counts = np.bincount(ds.y, minlength=num_classes).astype(np.float32)
    counts = np.maximum(counts, 1.0)
    weights = counts.sum() / (num_classes * counts)
    return torch.tensor(weights, dtype=torch.float32)


def run_epoch(
    model: BiLSTMClassifier,
    loader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
    optimizer: AdamW | None = None,
) -> Tuple[float, np.ndarray, np.ndarray]:
    is_train = optimizer is not None
    model.train(is_train)

    total_loss = 0.0
    y_true_all = []
    y_pred_all = []

    for x, y in loader:
        x = x.to(device)
        y = y.to(device)

        if is_train:
            optimizer.zero_grad(set_to_none=True)

        logits = model(x)
        loss = criterion(logits, y)

        if is_train:
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=3.0)
            optimizer.step()

        total_loss += float(loss.item()) * y.size(0)

        pred = torch.argmax(logits, dim=1)
        y_true_all.append(y.detach().cpu().numpy())
        y_pred_all.append(pred.detach().cpu().numpy())

    total_samples = len(loader.dataset)
    avg_loss = total_loss / max(total_samples, 1)
    y_true = np.concatenate(y_true_all) if y_true_all else np.array([], dtype=np.int64)
    y_pred = np.concatenate(y_pred_all) if y_pred_all else np.array([], dtype=np.int64)
    return avg_loss, y_true, y_pred


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    out_dir = ensure_dir(args.out_dir)

    label_map = load_label_map(args.labels_json)
    labels: List[str] = label_map["labels"]
    num_classes = len(labels)

    train_ds = SequenceNPZDataset(args.train_npz)
    val_ds = SequenceNPZDataset(args.val_npz)

    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=True,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=True,
    )

    device = torch.device(args.device)
    cfg = ModelConfig(
        hidden_size=args.hidden_size,
        num_layers=args.num_layers,
        dropout=args.dropout,
        num_classes=num_classes,
    )

    model = BiLSTMClassifier(cfg).to(device)
    weights = class_weights_from_dataset(train_ds, num_classes=num_classes).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)

    best_macro_f1 = -1.0
    best_epoch = -1
    epochs_without_improvement = 0
    history: List[Dict] = []

    for epoch in range(1, args.epochs + 1):
        train_loss, train_true, train_pred = run_epoch(
            model=model,
            loader=train_loader,
            criterion=criterion,
            device=device,
            optimizer=optimizer,
        )
        val_loss, val_true, val_pred = run_epoch(
            model=model,
            loader=val_loader,
            criterion=criterion,
            device=device,
            optimizer=None,
        )

        train_metrics = compute_metrics(train_true, train_pred, labels)
        val_metrics = compute_metrics(val_true, val_pred, labels)
        scheduler.step(val_loss)

        row = {
            "epoch": epoch,
            "train_loss": train_loss,
            "val_loss": val_loss,
            "train_macro_f1": train_metrics["macro_f1"],
            "val_macro_f1": val_metrics["macro_f1"],
            "lr": optimizer.param_groups[0]["lr"],
        }
        history.append(row)

        print(
            f"Epoch {epoch:03d} | "
            f"train_loss={train_loss:.4f} val_loss={val_loss:.4f} "
            f"train_f1={train_metrics['macro_f1']:.4f} val_f1={val_metrics['macro_f1']:.4f}"
        )

        if val_metrics["macro_f1"] > best_macro_f1:
            best_macro_f1 = val_metrics["macro_f1"]
            best_epoch = epoch
            epochs_without_improvement = 0

            save_checkpoint(
                path=out_dir / "best.pt",
                model=model,
                cfg=cfg,
                labels=labels,
                epoch=epoch,
                metrics={
                    "val_macro_f1": float(val_metrics["macro_f1"]),
                    "val_loss": float(val_loss),
                },
            )
        else:
            epochs_without_improvement += 1

        if epochs_without_improvement >= args.patience:
            print(f"Early stopping at epoch {epoch} (best epoch {best_epoch}, best val F1 {best_macro_f1:.4f})")
            break

    save_checkpoint(
        path=out_dir / "last.pt",
        model=model,
        cfg=cfg,
        labels=labels,
        epoch=history[-1]["epoch"] if history else 0,
        metrics={"best_val_macro_f1": float(best_macro_f1), "best_epoch": int(best_epoch)},
    )

    (out_dir / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"Saved checkpoints + history to: {out_dir}")


if __name__ == "__main__":
    main()
