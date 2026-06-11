"""Evaluate trained BiLSTM model: macro-F1, report, confusion matrix."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
from torch.utils.data import DataLoader

from .checkpoint import load_checkpoint
from .dataset_io import SequenceNPZDataset
from .metrics import compute_metrics
from .utils import ensure_dir


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Evaluate BiLSTM ASL sequence model")
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--test-npz", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, default=Path("artifacts/eval"))
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    return p.parse_args()


def plot_confusion_matrix(cm: np.ndarray, labels: list[str], out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(8, 6))
    im = ax.imshow(cm, cmap="Blues")
    fig.colorbar(im, ax=ax)

    ax.set_xticks(np.arange(len(labels)))
    ax.set_yticks(np.arange(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="right")
    ax.set_yticklabels(labels)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title("Confusion Matrix")

    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(int(cm[i, j])), ha="center", va="center", fontsize=9)

    fig.tight_layout()
    fig.savefig(out_path, dpi=160)
    plt.close(fig)


def main() -> None:
    args = parse_args()
    out_dir = ensure_dir(args.out_dir)
    device = torch.device(args.device)

    model, _cfg, labels, meta = load_checkpoint(args.checkpoint, device=device)

    ds = SequenceNPZDataset(args.test_npz)
    loader = DataLoader(ds, batch_size=args.batch_size, shuffle=False)

    y_true, y_pred = [], []
    model.eval()
    with torch.no_grad():
        for x, y in loader:
            x = x.to(device)
            logits = model(x)
            pred = torch.argmax(logits, dim=1).cpu().numpy()

            y_true.append(y.numpy())
            y_pred.append(pred)

    y_true_arr = np.concatenate(y_true)
    y_pred_arr = np.concatenate(y_pred)
    metrics = compute_metrics(y_true_arr, y_pred_arr, labels)

    print(f"Checkpoint epoch: {meta.get('epoch', -1)}")
    print(f"Macro F1: {metrics['macro_f1']:.4f}")

    result = {
        "macro_f1": metrics["macro_f1"],
        "classification_report": metrics["classification_report"],
        "checkpoint_meta": meta,
    }

    (out_dir / "metrics.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    np.save(out_dir / "confusion_matrix.npy", metrics["confusion_matrix"])
    plot_confusion_matrix(metrics["confusion_matrix"], labels, out_dir / "confusion_matrix.png")

    print(f"Saved evaluation outputs to {out_dir}")


if __name__ == "__main__":
    main()
