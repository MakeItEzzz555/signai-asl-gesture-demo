"""BiLSTM model for dynamic gesture-bundle classification."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import torch
import torch.nn as nn

from .constants import FRAME_FEATURE_DIM


@dataclass
class ModelConfig:
    input_size: int = FRAME_FEATURE_DIM
    hidden_size: int = 256
    num_layers: int = 2
    dropout: float = 0.3
    num_classes: int = 6


class BiLSTMClassifier(nn.Module):
    """BiLSTM encoder over 64-frame windows with pooled classification head."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.cfg = cfg

        self.lstm = nn.LSTM(
            input_size=cfg.input_size,
            hidden_size=cfg.hidden_size,
            num_layers=cfg.num_layers,
            dropout=cfg.dropout if cfg.num_layers > 1 else 0.0,
            bidirectional=True,
            batch_first=True,
        )

        pooled_dim = cfg.hidden_size * 4  # mean pool + max pool from bidirectional output
        self.norm = nn.LayerNorm(pooled_dim)
        self.head = nn.Sequential(
            nn.Linear(pooled_dim, cfg.hidden_size),
            nn.ReLU(inplace=True),
            nn.Dropout(cfg.dropout),
            nn.Linear(cfg.hidden_size, cfg.num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [batch, 64, 126]
        seq_out, _ = self.lstm(x)
        mean_pool = seq_out.mean(dim=1)
        max_pool, _ = seq_out.max(dim=1)
        pooled = torch.cat([mean_pool, max_pool], dim=-1)
        pooled = self.norm(pooled)
        logits = self.head(pooled)
        return logits


def model_config_to_dict(cfg: ModelConfig) -> dict:
    return asdict(cfg)


def model_config_from_dict(raw: dict) -> ModelConfig:
    return ModelConfig(**raw)
