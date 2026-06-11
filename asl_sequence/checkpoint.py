"""Checkpoint save/load helpers for BiLSTM gesture models."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple

import torch

from .model import BiLSTMClassifier, model_config_from_dict, model_config_to_dict, ModelConfig


def save_checkpoint(
    path: str | Path,
    model: BiLSTMClassifier,
    cfg: ModelConfig,
    labels: List[str],
    epoch: int,
    metrics: Dict,
) -> None:
    payload = {
        "model_state_dict": model.state_dict(),
        "model_config": model_config_to_dict(cfg),
        "labels": labels,
        "epoch": epoch,
        "metrics": metrics,
    }
    torch.save(payload, Path(path))


def load_checkpoint(path: str | Path, device: torch.device) -> Tuple[BiLSTMClassifier, ModelConfig, List[str], Dict]:
    payload = torch.load(Path(path), map_location=device)
    cfg = model_config_from_dict(payload["model_config"])
    model = BiLSTMClassifier(cfg).to(device)
    model.load_state_dict(payload["model_state_dict"])
    model.eval()

    labels = payload.get("labels", [])
    meta = {
        "epoch": payload.get("epoch", -1),
        "metrics": payload.get("metrics", {}),
    }
    return model, cfg, labels, meta
