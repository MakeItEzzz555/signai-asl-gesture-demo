"""Evaluation metrics for multi-class gesture classification."""

from __future__ import annotations

from typing import Dict, List

import numpy as np
from sklearn.metrics import classification_report, confusion_matrix, f1_score


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray, labels: List[str]) -> Dict:
    label_ids = list(range(len(labels)))
    report = classification_report(
        y_true,
        y_pred,
        labels=label_ids,
        target_names=labels,
        output_dict=True,
        zero_division=0,
    )
    macro_f1 = f1_score(y_true, y_pred, labels=label_ids, average="macro", zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=label_ids)

    return {
        "macro_f1": float(macro_f1),
        "classification_report": report,
        "confusion_matrix": cm,
    }
