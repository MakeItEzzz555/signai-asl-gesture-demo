"""Dataset I/O, signer-balanced splitting, and hard-negative generation."""

from __future__ import annotations

from collections import Counter
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

import numpy as np
from sklearn.model_selection import GroupShuffleSplit, StratifiedGroupKFold

from .augment import fast_motion_noise, mirror_x, random_augment, temporal_resample, temporal_shift, truncate_and_pad, wrist_drift
from .constants import ALL_LABELS, BLANK_LABEL, BLANK_MIN_SAMPLES, FACE_INTERACTIVE_LABELS, FRAME_COORD_DIM, RANDOM_SEED, SEQ_LEN
from .features import coords_to_feature_sequence, pad_or_truncate_coords


@dataclass
class RawSample:
    coords: np.ndarray  # [T,63]
    label: str
    signer_id: str
    sample_type: str
    path: Path


def _as_text(value, default: str) -> str:
    if value is None:
        return default
    if isinstance(value, np.ndarray):
        if value.size == 0:
            return default
        value = value.reshape(-1)[0]
    return str(value)


def _parse_signer_from_name(path: Path) -> str:
    # expected filename prefix: sid-<signer>__...
    m = re.match(r"sid-([^_]+)__", path.name)
    if m:
        return m.group(1)
    return "unknown"


def _load_sample_file(path: Path, default_label: str) -> RawSample:
    if path.suffix.lower() == ".npz":
        raw = np.load(path, allow_pickle=True)
        if "coords" in raw:
            coords = raw["coords"]
        elif "sequence" in raw:
            coords = raw["sequence"]
        else:
            raise ValueError(f"No coords/sequence key in {path}")

        label = _as_text(raw["label"] if "label" in raw else None, default_label).lower().strip()
        signer_id = _as_text(raw["signer_id"] if "signer_id" in raw else None, _parse_signer_from_name(path))
        sample_type = _as_text(raw["sample_type"] if "sample_type" in raw else None, "gesture")
    else:
        coords = np.load(path)
        label = default_label
        signer_id = _parse_signer_from_name(path)
        sample_type = "gesture"

    coords = np.asarray(coords, dtype=np.float32)
    if coords.ndim != 2 or coords.shape[1] != FRAME_COORD_DIM:
        raise ValueError(f"Invalid sample shape {coords.shape} in {path}")

    return RawSample(
        coords=coords,
        label=label,
        signer_id=str(signer_id),
        sample_type=str(sample_type),
        path=path,
    )


def load_raw_samples(raw_dir: Path, labels: Sequence[str]) -> List[RawSample]:
    samples: List[RawSample] = []
    for label in labels:
        label_dir = raw_dir / label
        if not label_dir.exists():
            continue

        for path in sorted(label_dir.iterdir()):
            if path.suffix.lower() not in {".npy", ".npz"}:
                continue
            try:
                sample = _load_sample_file(path, default_label=label)
            except Exception as exc:
                print(f"[WARN] skip {path}: {exc}")
                continue

            if sample.label not in labels:
                sample.label = label
            samples.append(sample)

    if not samples:
        raise RuntimeError(f"No raw samples found in: {raw_dir}")

    return samples


def _random_idle_blank(seq_len: int, rng: np.random.Generator) -> np.ndarray:
    # Small random-walk "background hand motion" centered near zero.
    walk = np.cumsum(rng.normal(0.0, 0.003, size=(seq_len, FRAME_COORD_DIM)), axis=0).astype(np.float32)
    walk *= rng.uniform(0.4, 0.9)
    walk[:, :3] = 0.0  # keep wrist near origin
    return walk.astype(np.float32)


def _static_resting_hand(non_blank_coords: list, rng: np.random.Generator) -> np.ndarray:
    """Resting hand: a real gesture posture frozen in place with micro-jitter.

    Picks a random frame from a real sequence and repeats it for the entire
    window with tiny noise, simulating a hand that is visible but not signing.
    This is the hardest blank type: the hand is in a plausible shape but not
    moving through a gesture arc.
    """
    idx = int(rng.integers(0, len(non_blank_coords)))
    seq = non_blank_coords[idx]          # [T, 63]
    frame_idx = int(rng.integers(0, seq.shape[0]))
    frame = seq[frame_idx].copy()        # [63]
    # Repeat the frozen frame and add micro-jitter
    repeated = np.tile(frame, (seq.shape[0], 1)).astype(np.float32)
    repeated += rng.normal(0.0, 0.003, size=repeated.shape).astype(np.float32)
    repeated[:, :3] = 0.0               # keep wrist at origin
    return repeated.astype(np.float32)


def _transition_blank(a: np.ndarray, b: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    cut = int(rng.integers(low=8, high=max(9, SEQ_LEN - 8)))
    a_fix = pad_or_truncate_coords(a, seq_len=SEQ_LEN)
    b_fix = pad_or_truncate_coords(b, seq_len=SEQ_LEN)
    mixed = np.vstack([a_fix[:cut], b_fix[cut:]]).astype(np.float32)
    return mixed


def _truncated_blank(seq: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    seq_fix = pad_or_truncate_coords(seq, seq_len=SEQ_LEN)
    keep = int(rng.integers(low=5, high=18))
    return truncate_and_pad(seq_fix, keep_frames=keep)


def _generate_blank_hard_negatives(
    non_blank_coords: List[np.ndarray],
    needed: int,
    rng: np.random.Generator,
) -> List[np.ndarray]:
    out: List[np.ndarray] = []
    if needed <= 0:
        return out

    for _ in range(needed):
        # 5 blank generation modes (was 4).  Mode 4 = static resting hand is the
        # hardest negative: a visible, realistic hand shape that is not performing
        # a gesture arc.  Adding it substantially reduces blank FNR (~54% currently).
        mode = int(rng.integers(0, 5))

        if mode == 0 or len(non_blank_coords) < 2:
            seq = _random_idle_blank(seq_len=SEQ_LEN, rng=rng)
        elif mode == 1:
            i, j = rng.integers(0, len(non_blank_coords), size=2)
            seq = _transition_blank(non_blank_coords[int(i)], non_blank_coords[int(j)], rng)
        elif mode == 2:
            i = int(rng.integers(0, len(non_blank_coords)))
            seq = _truncated_blank(non_blank_coords[i], rng)
        elif mode == 3:
            i = int(rng.integers(0, len(non_blank_coords)))
            base = pad_or_truncate_coords(non_blank_coords[i], seq_len=SEQ_LEN)
            seq = fast_motion_noise(base, rng=rng)
            seq = temporal_resample(seq, speed_factor=float(rng.uniform(1.3, 1.8)), out_len=SEQ_LEN)
        else:
            # Mode 4: static resting hand (hardest blank)
            seq = _static_resting_hand(non_blank_coords, rng=rng)

        out.append(pad_or_truncate_coords(seq, seq_len=SEQ_LEN))

    return out


def add_or_generate_blank_samples(
    samples: List[RawSample],
    blank_min_samples: int = BLANK_MIN_SAMPLES,
    seed: int = RANDOM_SEED,
) -> List[RawSample]:
    """Ensure enough blank class examples through recorded + synthetic hard negatives."""
    rng = np.random.default_rng(seed)

    blank_samples = [s for s in samples if s.label == BLANK_LABEL]
    non_blank_samples = [s for s in samples if s.label != BLANK_LABEL]
    non_blank_coords = [pad_or_truncate_coords(s.coords, seq_len=SEQ_LEN) for s in non_blank_samples]

    needed = max(0, int(blank_min_samples) - len(blank_samples))
    synthetic = _generate_blank_hard_negatives(non_blank_coords, needed=needed, rng=rng)

    generated: List[RawSample] = []
    for i, seq in enumerate(synthetic):
        generated.append(
            RawSample(
                coords=seq,
                label=BLANK_LABEL,
                signer_id=f"synthetic_{i % 32}",
                sample_type="hard_negative",
                path=Path(f"synthetic_blank_{i:06d}.npz"),
            )
        )

    return samples + generated


def _samples_to_arrays(samples: List[RawSample], label_to_idx: Dict[str, int]) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x_list: List[np.ndarray] = []
    y_list: List[int] = []
    signer_ids: List[str] = []
    sample_types: List[str] = []

    for s in samples:
        coords_fix = pad_or_truncate_coords(s.coords, seq_len=SEQ_LEN)
        features = coords_to_feature_sequence(coords_fix)
        x_list.append(features)
        y_list.append(label_to_idx[s.label])
        signer_ids.append(s.signer_id)
        sample_types.append(s.sample_type)

    x = np.stack(x_list).astype(np.float32)
    y = np.array(y_list, dtype=np.int64)
    groups = np.array(signer_ids, dtype="<U64")
    types = np.array(sample_types, dtype="<U32")
    return x, y, groups, types


def stratified_group_split(
    samples: List[RawSample],
    labels: Sequence[str],
    test_size: float,
    seed: int,
) -> Tuple[List[RawSample], List[RawSample]]:
    """Signer-balanced split with no signer overlap and approximate stratification."""
    label_to_idx = {label: i for i, label in enumerate(labels)}

    y = np.array([label_to_idx[s.label] for s in samples], dtype=np.int64)
    groups = np.array([s.signer_id for s in samples], dtype="<U64")

    unique_groups = np.unique(groups)
    if len(unique_groups) < 2:
        raise RuntimeError("Need at least 2 signer groups for signer-balanced split")

    # Try stratified-group CV fold selection closest to requested test ratio.
    n_splits = int(round(1.0 / max(1e-6, test_size)))
    n_splits = min(max(n_splits, 2), 10)

    best_train_idx = None
    best_test_idx = None
    best_score = float("inf")

    try:
        sgkf = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
        dummy_x = np.zeros((len(samples), 1), dtype=np.float32)
        for train_idx, test_idx in sgkf.split(dummy_x, y, groups=groups):
            ratio_err = abs(len(test_idx) / len(samples) - test_size)

            # Penalize class distribution mismatch from global distribution.
            global_dist = np.bincount(y, minlength=len(labels)) / len(y)
            test_dist = np.bincount(y[test_idx], minlength=len(labels)) / max(1, len(test_idx))
            dist_err = float(np.mean(np.abs(global_dist - test_dist)))

            score = ratio_err + dist_err
            if score < best_score:
                best_score = score
                best_train_idx = train_idx
                best_test_idx = test_idx
    except Exception:
        best_train_idx = None
        best_test_idx = None

    if best_train_idx is None or best_test_idx is None:
        gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
        train_idx, test_idx = next(gss.split(np.zeros(len(samples)), y, groups=groups))
        best_train_idx = train_idx
        best_test_idx = test_idx

    train_groups = set(groups[best_train_idx].tolist())
    test_groups = set(groups[best_test_idx].tolist())
    if train_groups.intersection(test_groups):
        raise RuntimeError("Signer overlap detected after split")

    train_samples = [samples[int(i)] for i in best_train_idx]
    test_samples = [samples[int(i)] for i in best_test_idx]
    return train_samples, test_samples


def augment_training_samples(
    train_samples: List[RawSample],
    augment_per_sample: int,
    seed: int,
) -> List[RawSample]:
    """Augment non-blank classes; keep blank augmentations minimal.

    For NON_FACE_LABELS (non-blank, non-face-interactive), also adds mirror-x
    augmented copies so the model learns hand-agnostic representations.  This
    mirrors the x-axis mirroring applied at inference time to left-hand coords
    in predictLeft(), making the model robust to both hands for symmetric gestures.

    Face-interactive labels (Group B) are intentionally excluded from mirror
    augmentation because their handedness carries semantic meaning.
    """
    if augment_per_sample <= 0:
        return train_samples

    rng = np.random.default_rng(seed)
    out: List[RawSample] = []
    non_blank_counts = Counter(s.label for s in train_samples if s.label != BLANK_LABEL)
    max_non_blank = max(non_blank_counts.values(), default=1)

    for s in train_samples:
        out.append(s)

        base = pad_or_truncate_coords(s.coords, seq_len=SEQ_LEN)

        # Heavier augmentation for gesture classes, lighter for blank.
        if s.label == BLANK_LABEL:
            local_aug_n = 1
        else:
            # Rarity-aware augmentation:
            # Underrepresented labels get extra synthetic variants so decision
            # boundaries are less biased toward frequent classes.
            # Cap raised to 6× (was 3×) so ultra-rare labels (old=2, love=5,
            # sleep=5, beautiful=6, drink=8 raw sequences) get enough diversity
            # to learn a generalised representation rather than overfitting the
            # few recorded examples.
            label_count = max(1, int(non_blank_counts.get(s.label, 1)))
            rarity_ratio = max_non_blank / label_count
            rarity_mult = int(np.clip(round(np.sqrt(rarity_ratio)), 1, 6))
            local_aug_n = max(1, int(augment_per_sample) * rarity_mult)

        for k in range(local_aug_n):
            if s.label == BLANK_LABEL:
                aug_coords = base + rng.normal(0.0, 0.004, size=base.shape).astype(np.float32)
            else:
                aug_coords = random_augment(base, rng=rng)

            out.append(
                RawSample(
                    coords=aug_coords.astype(np.float32),
                    label=s.label,
                    signer_id=s.signer_id,
                    sample_type=f"aug_{s.sample_type}",
                    path=Path(f"aug::{s.path.name}::{k}"),
                )
            )

        # Mirror-x augmentation for NON_FACE_LABELS only.
        # Applies the same x-axis flip used at inference time for left-hand coords
        # (see predictLeft in inferenceModel.ts) so the model generalises to both hands.
        is_non_face = s.label != BLANK_LABEL and s.label.lower() not in FACE_INTERACTIVE_LABELS
        if is_non_face:
            mirror_base = mirror_x(base)
            for k in range(local_aug_n):
                mirror_aug = random_augment(mirror_base, rng=rng)
                out.append(
                    RawSample(
                        coords=mirror_aug.astype(np.float32),
                        label=s.label,
                        signer_id=s.signer_id,
                        sample_type=f"mirror_aug_{s.sample_type}",
                        path=Path(f"mirror::{s.path.name}::{k}"),
                    )
                )

    return out


def build_feature_dataset(
    raw_dir: Path,
    labels: Sequence[str] = ALL_LABELS,
    test_size: float = 0.2,
    augment_per_sample: int = 2,
    blank_min_samples: int = BLANK_MIN_SAMPLES,
    seed: int = RANDOM_SEED,
) -> Dict[str, np.ndarray]:
    labels = [str(v).strip().lower() for v in labels]
    if BLANK_LABEL not in labels:
        labels = list(labels) + [BLANK_LABEL]

    samples = load_raw_samples(raw_dir=raw_dir, labels=labels)

    non_blank_signers = sorted({s.signer_id for s in samples if s.label != BLANK_LABEL and s.signer_id != "unknown"})
    if len(non_blank_signers) < 2:
        raise RuntimeError(
            "Need at least 2 non-blank signer_ids for signer-balanced split. "
            "Record data with --signer-id for multiple people."
        )

    samples = add_or_generate_blank_samples(samples, blank_min_samples=blank_min_samples, seed=seed)

    train_samples, test_samples = stratified_group_split(samples, labels=labels, test_size=test_size, seed=seed)
    train_samples = augment_training_samples(train_samples, augment_per_sample=augment_per_sample, seed=seed)

    label_to_idx = {label: i for i, label in enumerate(labels)}

    x_train, y_train, g_train, t_train = _samples_to_arrays(train_samples, label_to_idx=label_to_idx)
    x_test, y_test, g_test, t_test = _samples_to_arrays(test_samples, label_to_idx=label_to_idx)

    return {
        "x_train": x_train,
        "y_train": y_train,
        "groups_train": g_train,
        "types_train": t_train,
        "x_test": x_test,
        "y_test": y_test,
        "groups_test": g_test,
        "types_test": t_test,
        "labels": np.array(labels, dtype="<U32"),
    }


def save_processed_dataset(out_dir: Path, payload: Dict[str, np.ndarray]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    np.savez_compressed(
        out_dir / "train.npz",
        x=payload["x_train"],
        y=payload["y_train"],
        groups=payload["groups_train"],
        sample_types=payload["types_train"],
    )
    np.savez_compressed(
        out_dir / "test.npz",
        x=payload["x_test"],
        y=payload["y_test"],
        groups=payload["groups_test"],
        sample_types=payload["types_test"],
    )

    labels = payload["labels"].tolist()
    (out_dir / "labels.json").write_text(json.dumps({"labels": labels}, indent=2), encoding="utf-8")

    def _dist(y_arr: np.ndarray) -> Dict[str, int]:
        y_arr = y_arr.astype(np.int64)
        counts = np.bincount(y_arr, minlength=len(labels))
        return {labels[i]: int(counts[i]) for i in range(len(labels))}

    summary = {
        "labels": labels,
        "seq_len": SEQ_LEN,
        "feature_dim": int(payload["x_train"].shape[-1]),
        "train_samples": int(len(payload["y_train"])),
        "test_samples": int(len(payload["y_test"])),
        "train_distribution": _dist(payload["y_train"]),
        "test_distribution": _dist(payload["y_test"]),
        "train_signers": sorted(np.unique(payload["groups_train"]).tolist()),
        "test_signers": sorted(np.unique(payload["groups_test"]).tolist()),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def load_npz_dataset(npz_path: Path) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    data = np.load(npz_path, allow_pickle=True)
    x = data["x"].astype(np.float32)
    y = data["y"].astype(np.int64)
    groups = data["groups"].astype("<U64") if "groups" in data else np.array(["unknown"] * len(y), dtype="<U64")
    sample_types = data["sample_types"].astype("<U32") if "sample_types" in data else np.array(["unknown"] * len(y), dtype="<U32")
    return x, y, groups, sample_types


def load_labels(labels_json: Path) -> List[str]:
    payload = json.loads(labels_json.read_text(encoding="utf-8"))
    labels = payload.get("labels")
    if not isinstance(labels, list) or not labels:
        raise ValueError(f"Invalid labels file: {labels_json}")
    return [str(v) for v in labels]
