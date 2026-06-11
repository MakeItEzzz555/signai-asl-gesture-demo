"""NPZ dataset I/O utilities for sequence classification."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import torch
from torch.utils.data import Dataset


class SequenceNPZDataset(Dataset):
    """PyTorch dataset backed by compressed npz arrays (X, y)."""

    def __init__(self, npz_path: str | Path):
        npz_path = Path(npz_path)
        if not npz_path.exists():
            raise FileNotFoundError(npz_path)

        with np.load(npz_path) as data:
            self.X = data["X"].astype(np.float32)
            self.y = data["y"].astype(np.int64)

        if self.X.shape[0] != self.y.shape[0]:
            raise ValueError("Mismatched sample counts between X and y")

    def __len__(self) -> int:
        return int(self.X.shape[0])

    def __getitem__(self, idx: int):
        x = torch.from_numpy(self.X[idx])
        y = torch.tensor(self.y[idx], dtype=torch.long)
        return x, y


def load_npz_arrays(npz_path: str | Path) -> Tuple[np.ndarray, np.ndarray]:
    with np.load(npz_path) as data:
        x = data["X"].astype(np.float32)
        y = data["y"].astype(np.int64)
    return x, y


def save_label_map(path: str | Path, labels: List[str]) -> None:
    payload = {
        "labels": labels,
        "label_to_index": {label: i for i, label in enumerate(labels)},
    }
    Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_label_map(path: str | Path) -> Dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))
