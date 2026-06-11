"""Gesture completion and sentence construction for realtime decoding."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .constants import BLANK_LABEL, CONFIDENCE_THRESHOLD, COOLDOWN_FRAMES, FRAME_COORD_DIM, STABLE_FRAMES
from .features import motion_energy


@dataclass
class SegmenterConfig:
    confidence_threshold: float = CONFIDENCE_THRESHOLD  # 0.88 - 0.92 recommended
    stable_frames: int = STABLE_FRAMES  # 6 - 10 recommended
    cooldown_frames: int = COOLDOWN_FRAMES  # 10 - 18 recommended
    min_motion_energy: float = 0.012


class GestureSegmenter:
    """State machine over per-window predictions.

    Emit rule:
    - prediction confidence >= threshold
    - label stable over last N updates
    - label != blank
    - not in cooldown
    """

    def __init__(self, cfg: SegmenterConfig | None = None):
        self.cfg = cfg or SegmenterConfig()
        self.history_labels = deque(maxlen=self.cfg.stable_frames)
        self.history_conf = deque(maxlen=self.cfg.stable_frames)
        self.cooldown = 0

    def reset(self) -> None:
        self.history_labels.clear()
        self.history_conf.clear()
        self.cooldown = 0

    def reset_stability(self) -> None:
        self.history_labels.clear()
        self.history_conf.clear()

    @property
    def stable_count(self) -> int:
        if not self.history_labels:
            return 0
        last = self.history_labels[-1]
        return sum(1 for x in self.history_labels if x == last)

    def buffer_has_motion(self, coords_seq: np.ndarray) -> bool:
        if coords_seq.ndim != 2 or coords_seq.shape[1] != FRAME_COORD_DIM:
            return False
        return motion_energy(coords_seq) >= self.cfg.min_motion_energy

    def update(self, label: str, confidence: float) -> Optional[str]:
        if self.cooldown > 0:
            self.cooldown -= 1
            return None

        if confidence < self.cfg.confidence_threshold or label == BLANK_LABEL:
            self.reset_stability()
            return None

        self.history_labels.append(label)
        self.history_conf.append(float(confidence))

        if len(self.history_labels) < self.cfg.stable_frames:
            return None

        candidate = self.history_labels[-1]
        is_stable = all(lbl == candidate for lbl in self.history_labels)
        avg_conf = float(np.mean(self.history_conf)) if self.history_conf else 0.0

        if is_stable and avg_conf >= self.cfg.confidence_threshold:
            self.reset_stability()
            self.cooldown = self.cfg.cooldown_frames
            return candidate

        return None


class SentenceBuilder:
    """Incremental sentence output with automatic spaces."""

    def __init__(self):
        self._text = ""

    @property
    def text(self) -> str:
        return self._text

    def append(self, word: str) -> str:
        self._text += f"{word} "
        return self._text

    def clear(self) -> None:
        self._text = ""
