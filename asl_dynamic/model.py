"""BiGRU + temporal attention model and checkpoint utilities."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple

import torch
import torch.nn as nn

from .attention import TemporalAttention
from .constants import FRAME_FEATURE_DIM


@dataclass
class ModelConfig:
    input_size: int = FRAME_FEATURE_DIM
    hidden_size: int = 128
    num_layers: int = 2
    dropout: float = 0.40
    num_classes: int = 7


class AttentionBiGRUClassifier(nn.Module):
    """Input projection -> 2-layer BiGRU -> temporal attention -> classifier."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        if cfg.hidden_size > 192:
            raise ValueError("hidden_size must be <= 192 for real-time CPU inference")

        self.cfg = cfg

        self.input_proj = nn.Sequential(
            nn.Linear(cfg.input_size, cfg.hidden_size),
            nn.LayerNorm(cfg.hidden_size),
            nn.ReLU(inplace=True),
        )

        self.bigru = nn.GRU(
            input_size=cfg.hidden_size,
            hidden_size=cfg.hidden_size,
            num_layers=cfg.num_layers,
            dropout=cfg.dropout if cfg.num_layers > 1 else 0.0,
            bidirectional=True,
            batch_first=True,
        )

        seq_hidden_dim = cfg.hidden_size * 2
        self.attn = TemporalAttention(hidden_dim=seq_hidden_dim, attn_dim=cfg.hidden_size)

        self.classifier = nn.Sequential(
            nn.Dropout(cfg.dropout),
            nn.Linear(seq_hidden_dim, cfg.hidden_size),
            nn.ReLU(inplace=True),
            nn.Dropout(cfg.dropout),
            nn.Linear(cfg.hidden_size, cfg.num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [B, 30, 126]
        x = self.input_proj(x)
        seq_out, _ = self.bigru(x)  # [B, T, 2H]
        context, _alpha = self.attn(seq_out)
        logits = self.classifier(context)
        return logits


def save_checkpoint(
    path: str | Path,
    model: AttentionBiGRUClassifier,
    labels: List[str],
    cfg: ModelConfig,
    epoch: int,
    metrics: Dict[str, Any],
) -> None:
    payload = {
        "state_dict": model.state_dict(),
        "labels": labels,
        "config": asdict(cfg),
        "epoch": int(epoch),
        "metrics": metrics,
    }
    torch.save(payload, Path(path))


def load_checkpoint(path: str | Path, device: torch.device) -> Tuple[AttentionBiGRUClassifier, List[str], ModelConfig, Dict[str, Any]]:
    payload = torch.load(Path(path), map_location=device)
    cfg = ModelConfig(**payload["config"])
    labels = list(payload["labels"])

    model = AttentionBiGRUClassifier(cfg).to(device)
    model.load_state_dict(payload["state_dict"])
    model.eval()

    meta = {
        "epoch": payload.get("epoch", -1),
        "metrics": payload.get("metrics", {}),
    }
    return model, labels, cfg, meta
