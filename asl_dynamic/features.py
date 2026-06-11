"""Temporal feature construction and utility functions."""

from __future__ import annotations

import numpy as np

from .constants import EPS, FRAME_COORD_DIM, FRAME_FEATURE_DIM, SEQ_LEN


def pad_or_truncate_coords(seq_coords: np.ndarray, seq_len: int = SEQ_LEN) -> np.ndarray:
    """Force coordinate sequence into [seq_len, 63] via center-truncate/zero-pad."""
    if seq_coords.ndim != 2 or seq_coords.shape[1] != FRAME_COORD_DIM:
        raise ValueError(f"Expected [T, {FRAME_COORD_DIM}], got {seq_coords.shape}")

    t = seq_coords.shape[0]
    if t == seq_len:
        return seq_coords.astype(np.float32)
    if t > seq_len:
        start = (t - seq_len) // 2
        return seq_coords[start : start + seq_len].astype(np.float32)

    out = np.zeros((seq_len, FRAME_COORD_DIM), dtype=np.float32)
    out[:t] = seq_coords
    return out


def build_frame_feature(coords_t: np.ndarray, coords_prev: np.ndarray | None) -> np.ndarray:
    """Build 126-D frame feature: [xyz(63), dxyz(63)]."""
    if coords_t.shape[0] != FRAME_COORD_DIM:
        raise ValueError(f"coords_t must have {FRAME_COORD_DIM} values")

    if coords_prev is None:
        dcoords = np.zeros_like(coords_t, dtype=np.float32)
    else:
        dcoords = (coords_t - coords_prev).astype(np.float32)

    feat = np.concatenate([coords_t.astype(np.float32), dcoords], axis=0)
    if feat.shape[0] != FRAME_FEATURE_DIM:
        raise RuntimeError("feature dimension mismatch")
    return feat.astype(np.float32)


def coords_to_feature_sequence(seq_coords: np.ndarray) -> np.ndarray:
    """Convert [T,63] coordinates into [T,126] coordinates+velocity."""
    if seq_coords.ndim != 2 or seq_coords.shape[1] != FRAME_COORD_DIM:
        raise ValueError(f"Expected [T, {FRAME_COORD_DIM}], got {seq_coords.shape}")

    t = seq_coords.shape[0]
    out = np.zeros((t, FRAME_FEATURE_DIM), dtype=np.float32)

    prev = None
    for i in range(t):
        out[i] = build_frame_feature(seq_coords[i], prev)
        prev = seq_coords[i]
    return out


def feature_presence_ratio(seq_coords: np.ndarray) -> float:
    """Fraction of frames with non-trivial hand coordinates."""
    if seq_coords.size == 0:
        return 0.0
    active = np.linalg.norm(seq_coords, axis=1) > EPS
    return float(active.mean())


def motion_energy(seq_coords: np.ndarray) -> float:
    """Mean absolute frame-to-frame coordinate change."""
    if seq_coords.ndim != 2 or seq_coords.shape[1] != FRAME_COORD_DIM or seq_coords.shape[0] < 2:
        return 0.0
    diffs = np.diff(seq_coords, axis=0)
    return float(np.mean(np.abs(diffs)))


def motion_energy_from_features(seq_features: np.ndarray) -> float:
    """Read motion energy from dxyz part of [T,126]."""
    if seq_features.ndim != 2 or seq_features.shape[1] != FRAME_FEATURE_DIM:
        return 0.0
    dxyz = seq_features[:, FRAME_COORD_DIM:]
    return float(np.mean(np.abs(dxyz)))
