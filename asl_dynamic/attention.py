"""Temporal attention pooling module."""

from __future__ import annotations

import torch
import torch.nn as nn


class TemporalAttention(nn.Module):
    """Additive attention over sequence states.

    score_t = tanh(W h_t)
    alpha = softmax(v^T score_t)
    context = sum_t alpha_t * h_t
    """

    def __init__(self, hidden_dim: int, attn_dim: int | None = None):
        super().__init__()
        attn_dim = attn_dim or hidden_dim
        self.proj = nn.Linear(hidden_dim, attn_dim)
        self.v = nn.Linear(attn_dim, 1, bias=False)

    def forward(self, seq_states: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        # seq_states: [B, T, H]
        score = torch.tanh(self.proj(seq_states))  # [B, T, A]
        logits = self.v(score).squeeze(-1)  # [B, T]
        alpha = torch.softmax(logits, dim=1)
        context = torch.bmm(alpha.unsqueeze(1), seq_states).squeeze(1)  # [B, H]
        return context, alpha
