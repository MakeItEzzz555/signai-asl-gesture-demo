"""Label definitions and normalization helpers."""

from __future__ import annotations

import re
from typing import Dict, List

TARGET_GESTURES: List[str] = ["hello", "yes", "no", "please", "help"]
BLANK_LABEL = "blank"
ALL_LABELS = TARGET_GESTURES + [BLANK_LABEL]

LABEL_TO_INDEX: Dict[str, int] = {label: idx for idx, label in enumerate(ALL_LABELS)}
INDEX_TO_LABEL: Dict[int, str] = {idx: label for label, idx in LABEL_TO_INDEX.items()}


def normalize_label(text: str) -> str:
    """Normalize raw class text to canonical lower-case tokens."""
    cleaned = re.sub(r"[^a-zA-Z\\s]", "", text or "").strip().lower()
    cleaned = re.sub(r"\\s+", " ", cleaned)
    return cleaned
