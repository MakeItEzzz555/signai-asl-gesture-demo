"""Augmentations for coordinate sequences shaped [T, 63]."""

from __future__ import annotations

import numpy as np

from .constants import FRAME_COORD_DIM, LANDMARK_COUNT, SEQ_LEN
from .features import pad_or_truncate_coords


def _reshape(seq: np.ndarray) -> np.ndarray:
    return seq.reshape(seq.shape[0], LANDMARK_COUNT, 3)


def _flatten(seq_xyz: np.ndarray) -> np.ndarray:
    return seq_xyz.reshape(seq_xyz.shape[0], FRAME_COORD_DIM)


def rotate_xy(seq: np.ndarray, angle_deg: float) -> np.ndarray:
    rad = np.deg2rad(angle_deg)
    c = float(np.cos(rad))
    s = float(np.sin(rad))
    rot = np.array([[c, -s], [s, c]], dtype=np.float32)

    xyz = _reshape(seq).copy()
    xy = xyz[:, :, :2]
    xy_rot = np.einsum("ij,tkj->tki", rot, xy)
    xyz[:, :, :2] = xy_rot
    xyz[:, 0, :] = 0.0
    return _flatten(xyz).astype(np.float32)


def scale_xyz(seq: np.ndarray, factor: float) -> np.ndarray:
    xyz = _reshape(seq).copy()
    xyz *= float(factor)
    xyz[:, 0, :] = 0.0
    return _flatten(xyz).astype(np.float32)


def add_noise(seq: np.ndarray, std: float) -> np.ndarray:
    out = seq.astype(np.float32) + np.random.normal(0.0, std, size=seq.shape).astype(np.float32)
    xyz = _reshape(out)
    xyz[:, 0, :] = 0.0
    return _flatten(xyz).astype(np.float32)


def temporal_resample(seq: np.ndarray, speed_factor: float, out_len: int = SEQ_LEN) -> np.ndarray:
    in_len, feat_dim = seq.shape
    warped_len = max(6, int(round(in_len / max(speed_factor, 1e-4))))

    src_x = np.linspace(0.0, 1.0, in_len, dtype=np.float32)
    dst_x = np.linspace(0.0, 1.0, warped_len, dtype=np.float32)

    warped = np.zeros((warped_len, feat_dim), dtype=np.float32)
    for i in range(feat_dim):
        warped[:, i] = np.interp(dst_x, src_x, seq[:, i])

    target_x = np.linspace(0.0, 1.0, out_len, dtype=np.float32)
    out = np.zeros((out_len, feat_dim), dtype=np.float32)
    for i in range(feat_dim):
        out[:, i] = np.interp(target_x, dst_x, warped[:, i])

    xyz = _reshape(out)
    xyz[:, 0, :] = 0.0
    return _flatten(xyz).astype(np.float32)


def truncate_and_pad(seq: np.ndarray, keep_frames: int) -> np.ndarray:
    keep_frames = int(max(4, min(seq.shape[0], keep_frames)))
    part = seq[:keep_frames]
    return pad_or_truncate_coords(part, seq_len=seq.shape[0]).astype(np.float32)


def fast_motion_noise(seq: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Create unrealistic fast movement negative by jittering and temporal skipping."""
    t = seq.shape[0]
    step = int(rng.integers(2, 4))
    idx = np.arange(0, t, step)
    fast = seq[idx]
    fast = pad_or_truncate_coords(fast, seq_len=t)
    fast = add_noise(fast, std=float(rng.uniform(0.01, 0.03)))
    return fast.astype(np.float32)


def temporal_shift(seq: np.ndarray, rng: np.random.Generator, max_shift: int = 3) -> np.ndarray:
    """Circularly shift the sequence by 0–max_shift frames.

    Simulates temporal registration jitter: the gesture starts or ends a few
    frames earlier or later than in the recorded sample.  This is especially
    useful for short-duration labels where the hand shape is ambiguous at the
    very start/end of the clip.
    """
    shift = int(rng.integers(0, max_shift + 1))
    if shift == 0:
        return seq.astype(np.float32)
    # Shift left (gesture appears earlier) or right (appears later)
    if rng.random() < 0.5:
        out = np.concatenate([seq[shift:], seq[:shift]], axis=0)
    else:
        out = np.concatenate([seq[-shift:], seq[:-shift]], axis=0)
    xyz = _reshape(out)
    xyz[:, 0, :] = 0.0  # keep wrist at origin
    return _flatten(xyz).astype(np.float32)


def wrist_drift(seq: np.ndarray, rng: np.random.Generator, max_drift: float = 0.04) -> np.ndarray:
    """Add a small, smoothly-varying wrist drift over the sequence.

    Simulates imperfect normalization or natural hand position drift during
    signing.  A low-amplitude linear trend is added in x/y and removed from
    the wrist (landmark 0 stays anchored at origin throughout).
    """
    t = seq.shape[0]
    # Linear drift ramp from 0 to a random small offset
    drift_xy = rng.uniform(-max_drift, max_drift, size=2).astype(np.float32)
    ramp = np.linspace(0.0, 1.0, t, dtype=np.float32)[:, None]  # [T, 1]
    xyz = _reshape(seq).copy()
    xyz[:, :, 0] += ramp * drift_xy[0]  # x drift applied uniformly across all landmarks
    xyz[:, :, 1] += ramp * drift_xy[1]  # y drift
    xyz[:, 0, :] = 0.0                  # keep wrist at origin
    return _flatten(xyz).astype(np.float32)


def random_augment(seq: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """General training-time augmentation for non-blank gesture clips."""
    out = seq.astype(np.float32).copy()

    if rng.random() < 0.85:
        out = rotate_xy(out, angle_deg=float(rng.uniform(-12.0, 12.0)))
    if rng.random() < 0.85:
        out = scale_xyz(out, factor=float(rng.uniform(0.90, 1.10)))
    if rng.random() < 0.90:
        out = add_noise(out, std=float(rng.uniform(0.002, 0.015)))
    if rng.random() < 0.75:
        out = temporal_resample(out, speed_factor=float(rng.uniform(0.75, 1.30)), out_len=seq.shape[0])
    if rng.random() < 0.40:
        out = temporal_shift(out, rng=rng, max_shift=3)
    if rng.random() < 0.35:
        out = wrist_drift(out, rng=rng, max_drift=0.04)

    return out.astype(np.float32)


def mirror_x(seq: np.ndarray) -> np.ndarray:
    """Mirror the x-axis of all landmarks to simulate a left-hand view.

    Applied during training to NON_FACE_LABELS so the model learns
    hand-agnostic representations: the same gesture performed with the
    left hand (x-mirrored at inference time in predictLeft()) will match
    the same class as the right-hand version.

    NOT applied to face-interactive labels where handedness is semantically
    meaningful (e.g. "Think" points to the right temple, not the left).

    Input/output shape: [T, 63]  (T = seq len, 63 = 21 landmarks × xyz)
    """
    xyz = _reshape(seq).copy()
    xyz[:, :, 0] *= -1.0   # negate x-component of every landmark
    xyz[:, 0, :] = 0.0     # keep wrist at origin
    return _flatten(xyz).astype(np.float32)
