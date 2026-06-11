"""Evaluation CLI and metrics utilities for dynamic ASL models."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List

import matplotlib.pyplot as plt
import numpy as np
import torch
from sklearn.metrics import classification_report, confusion_matrix, f1_score

from .constants import BLANK_LABEL
from .data_io import load_labels, load_npz_dataset
from .model import load_checkpoint


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray, labels: List[str]) -> Dict:
    macro_f1 = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
    report = classification_report(
        y_true,
        y_pred,
        labels=list(range(len(labels))),
        target_names=labels,
        output_dict=True,
        zero_division=0,
    )

    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(labels))))

    blank_idx = labels.index(BLANK_LABEL) if BLANK_LABEL in labels else -1
    blank_metrics = {}
    if blank_idx >= 0:
        tp = float(cm[blank_idx, blank_idx])
        fn = float(cm[blank_idx, :].sum() - tp)
        fp = float(cm[:, blank_idx].sum() - tp)
        tn = float(cm.sum() - tp - fn - fp)

        blank_fpr = fp / max(1.0, (fp + tn))
        blank_false_activation_rate = fn / max(1.0, (tp + fn))
        blank_metrics = {
            "blank_fpr": blank_fpr,
            "blank_false_activation_rate": blank_false_activation_rate,
        }

    return {
        "macro_f1": macro_f1,
        "classification_report": report,
        "confusion_matrix": cm.tolist(),
        **blank_metrics,
    }


def save_confusion_matrix(cm: np.ndarray, labels: List[str], out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(8, 7))
    im = ax.imshow(cm, cmap="Blues")
    plt.colorbar(im, ax=ax)

    ax.set_xticks(np.arange(len(labels)))
    ax.set_yticks(np.arange(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="right")
    ax.set_yticklabels(labels)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")

    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center", color="black")

    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=220)
    plt.close(fig)


def save_metrics(metrics: Dict, out_json: Path) -> None:
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(metrics, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Evaluate dynamic ASL checkpoint")
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--npz", type=Path, default=Path("dataset/processed/test.npz"))
    p.add_argument("--labels-json", type=Path, default=Path("dataset/processed/labels.json"))
    p.add_argument("--out-dir", type=Path, default=Path("artifacts/asl_dynamic_eval"))
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    device = torch.device(args.device)

    labels = load_labels(args.labels_json)
    model, ckpt_labels, _cfg, meta = load_checkpoint(args.checkpoint, device=device)
    if ckpt_labels and ckpt_labels != labels:
        print("[WARN] checkpoint label order differs from labels-json; using checkpoint labels")
        labels = ckpt_labels

    x, y, _groups, _types = load_npz_dataset(args.npz)

    y_true = []
    y_pred = []

    model.eval()
    with torch.inference_mode():
        for start in range(0, len(y), args.batch_size):
            xb = torch.from_numpy(x[start : start + args.batch_size]).to(device)
            logits = model(xb)
            pred = torch.argmax(logits, dim=1).detach().cpu().numpy()

            y_pred.append(pred)
            y_true.append(y[start : start + args.batch_size])

    y_true_np = np.concatenate(y_true)
    y_pred_np = np.concatenate(y_pred)

    metrics = compute_metrics(y_true_np, y_pred_np, labels=labels)
    metrics["checkpoint_meta"] = meta

    args.out_dir.mkdir(parents=True, exist_ok=True)
    save_metrics(metrics, args.out_dir / "metrics.json")
    cm_np = np.array(metrics["confusion_matrix"], dtype=np.int64)
    np.save(args.out_dir / "confusion_matrix.npy", cm_np)
    save_confusion_matrix(cm_np, labels=labels, out_path=args.out_dir / "confusion_matrix.png")

    print(json.dumps({
        "macro_f1": metrics["macro_f1"],
        "blank_fpr": metrics.get("blank_fpr"),
        "blank_false_activation_rate": metrics.get("blank_false_activation_rate"),
        "out_dir": str(args.out_dir),
    }, indent=2))


if __name__ == "__main__":
    main()
