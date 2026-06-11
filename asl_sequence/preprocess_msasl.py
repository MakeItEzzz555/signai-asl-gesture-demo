"""Preprocess MS-ASL clips into fixed 64x126 gesture bundles for BiLSTM training.

Pipeline:
1) Filter MS-ASL metadata to target classes: hello, yes, no, please, help
2) Resolve local video files
3) Extract MediaPipe 3D landmarks frame-by-frame
4) Build per-frame features: [x,y,z normalized coords (63), temporal deltas (63)]
5) Build fixed windows of 64 frames (pad/truncate)
6) Add synthetic transition/idle windows as BLANK class
7) Save train/val/test npz files and label map
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import numpy as np

from .constants import FRAME_COORD_DIM, FRAME_FEATURE_DIM, RANDOM_SEED, SEQ_LEN
from .dataset_io import save_label_map
from .feature_extractor import MediaPipeFeatureExtractor, hand_presence_ratio, pad_or_truncate_sequence
from .labels import ALL_LABELS, BLANK_LABEL, LABEL_TO_INDEX, TARGET_GESTURES, normalize_label
from .utils import ensure_dir

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_class_map(path: Optional[Path]) -> Dict[int, str]:
    if path is None:
        return {}
    raw = load_json(path)

    if isinstance(raw, list):
        return {int(i): str(v) for i, v in enumerate(raw)}

    if isinstance(raw, dict):
        out = {}
        for k, v in raw.items():
            try:
                out[int(k)] = str(v)
            except ValueError:
                continue
        return out

    return {}


def get_word_from_item(item: dict, class_map: Dict[int, str]) -> str:
    for key in ("clean_text", "text", "gloss", "label_text", "class_name", "word"):
        v = item.get(key)
        if isinstance(v, str) and v.strip():
            return normalize_label(v)

    label_val = item.get("label")
    if isinstance(label_val, str):
        return normalize_label(label_val)

    if isinstance(label_val, (int, float)):
        mapped = class_map.get(int(label_val))
        if mapped:
            return normalize_label(mapped)

    return ""


def build_video_index(video_root: Path) -> Tuple[Dict[str, Path], Dict[str, List[Path]]]:
    by_name: Dict[str, Path] = {}
    by_stem: Dict[str, List[Path]] = {}
    for path in video_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTS:
            continue
        by_name[path.name.lower()] = path
        by_stem.setdefault(path.stem.lower(), []).append(path)
    return by_name, by_stem


def resolve_video_path(item: dict, video_root: Path, by_name: Dict[str, Path], by_stem: Dict[str, List[Path]]) -> Optional[Path]:
    direct_keys = ["video_path", "path", "file", "filename", "clip_path"]
    for key in direct_keys:
        raw = item.get(key)
        if isinstance(raw, str) and raw.strip():
            p = Path(raw)
            if p.exists():
                return p
            rp = video_root / raw
            if rp.exists():
                return rp

    candidates: List[str] = []
    for key in ("video", "video_id", "vid", "id", "clip_id", "name"):
        val = item.get(key)
        if isinstance(val, str) and val.strip():
            candidates.append(val.strip())
        elif isinstance(val, (int, float)):
            candidates.append(str(int(val)))

    url = item.get("url")
    if isinstance(url, str) and url.strip():
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        if "v" in query and query["v"]:
            candidates.append(query["v"][0])

        stem = Path(parsed.path).stem
        if stem and stem.lower() not in {"watch", "shorts"}:
            candidates.append(stem)

    for cand in candidates:
        cand_path = Path(cand)
        if cand_path.suffix.lower() in VIDEO_EXTS:
            p = video_root / cand_path.name
            if p.exists():
                return p
            found = by_name.get(cand_path.name.lower())
            if found:
                return found
        else:
            for ext in VIDEO_EXTS:
                name = f"{cand}{ext}"
                found = by_name.get(name.lower())
                if found:
                    return found

            stem_hits = by_stem.get(cand.lower())
            if stem_hits:
                return stem_hits[0]

    return None


def infer_frame_bounds(item: dict, default_fps: float) -> Tuple[Optional[int], Optional[int]]:
    start_frame = item.get("start_frame")
    end_frame = item.get("end_frame")

    if isinstance(start_frame, (int, float)) or isinstance(end_frame, (int, float)):
        sf = int(start_frame) if isinstance(start_frame, (int, float)) else None
        ef = int(end_frame) if isinstance(end_frame, (int, float)) else None
        return sf, ef

    fps = item.get("fps")
    if not isinstance(fps, (int, float)) or fps <= 0:
        fps = default_fps

    start_time = item.get("start_time")
    end_time = item.get("end_time")
    if isinstance(start_time, (int, float)) and isinstance(end_time, (int, float)) and end_time > start_time:
        sf = int(float(start_time) * float(fps))
        ef = int(float(end_time) * float(fps))
        return sf, ef

    return None, None


def add_blank_samples(x: np.ndarray, y: np.ndarray, blank_ratio: float, rng: np.random.Generator) -> Tuple[np.ndarray, np.ndarray]:
    if x.size == 0 or blank_ratio <= 0:
        return x, y

    n_existing = x.shape[0]
    n_blank = max(1, int(round(n_existing * blank_ratio)))
    blank_label = LABEL_TO_INDEX[BLANK_LABEL]

    blank_sequences = []

    # Half idle low-motion windows, half transition windows.
    n_idle = n_blank // 2
    n_trans = n_blank - n_idle

    for _ in range(n_idle):
        seq = np.zeros((SEQ_LEN, FRAME_FEATURE_DIM), dtype=np.float32)
        noise = rng.normal(0.0, 0.01, size=seq.shape).astype(np.float32)
        seq += noise
        blank_sequences.append(seq)

    for _ in range(n_trans):
        i, j = rng.integers(0, n_existing, size=2)
        a = x[i].copy()
        b = x[j].copy()
        cut = int(rng.integers(low=16, high=48))

        mixed = np.vstack([a[:cut], b[cut:]])
        mixed = mixed[:SEQ_LEN]
        if mixed.shape[0] < SEQ_LEN:
            pad = np.zeros((SEQ_LEN - mixed.shape[0], FRAME_FEATURE_DIM), dtype=np.float32)
            mixed = np.vstack([mixed, pad])

        # Downscale absolute coords so transition windows are less class-specific.
        mixed[:, :FRAME_COORD_DIM] *= 0.6
        blank_sequences.append(mixed.astype(np.float32))

    blank_x = np.stack(blank_sequences).astype(np.float32)
    blank_y = np.full((blank_x.shape[0],), blank_label, dtype=np.int64)

    x_out = np.concatenate([x, blank_x], axis=0)
    y_out = np.concatenate([y, blank_y], axis=0)

    perm = rng.permutation(len(y_out))
    return x_out[perm], y_out[perm]


def process_split(
    split_name: str,
    items: Iterable[dict],
    extractor: MediaPipeFeatureExtractor,
    video_root: Path,
    by_name: Dict[str, Path],
    by_stem: Dict[str, List[Path]],
    class_map: Dict[int, str],
    seq_len: int,
    min_presence: float,
    limit_per_class: Optional[int],
    default_fps: float,
) -> Tuple[np.ndarray, np.ndarray, Dict[str, int], Dict[str, int]]:
    per_class_count = {label: 0 for label in TARGET_GESTURES}
    skip_stats = {
        "non_target": 0,
        "missing_video": 0,
        "empty_clip": 0,
        "low_hand_presence": 0,
        "limit_reached": 0,
        "processing_error": 0,
    }

    x_seq = []
    y_idx = []

    for n, item in enumerate(items, start=1):
        word = get_word_from_item(item, class_map)
        if word not in TARGET_GESTURES:
            skip_stats["non_target"] += 1
            continue

        if limit_per_class is not None and per_class_count[word] >= limit_per_class:
            skip_stats["limit_reached"] += 1
            continue

        video_path = resolve_video_path(item, video_root, by_name, by_stem)
        if video_path is None:
            skip_stats["missing_video"] += 1
            continue

        start_frame, end_frame = infer_frame_bounds(item, default_fps=default_fps)

        try:
            seq = extractor.extract_feature_sequence_from_video(
                video_path=video_path,
                start_frame=start_frame,
                end_frame=end_frame,
            )
        except Exception:
            skip_stats["processing_error"] += 1
            continue

        if seq.shape[0] == 0:
            skip_stats["empty_clip"] += 1
            continue

        if hand_presence_ratio(seq) < min_presence:
            skip_stats["low_hand_presence"] += 1
            continue

        seq = pad_or_truncate_sequence(seq, seq_len=seq_len)
        x_seq.append(seq)
        y_idx.append(LABEL_TO_INDEX[word])
        per_class_count[word] += 1

        if n % 200 == 0:
            print(f"[{split_name}] processed {n} metadata rows")

    if not x_seq:
        return (
            np.zeros((0, seq_len, FRAME_FEATURE_DIM), dtype=np.float32),
            np.zeros((0,), dtype=np.int64),
            per_class_count,
            skip_stats,
        )

    x_arr = np.stack(x_seq).astype(np.float32)
    y_arr = np.array(y_idx, dtype=np.int64)
    return x_arr, y_arr, per_class_count, skip_stats


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build 5-class (+blank) dynamic ASL sequence dataset from MS-ASL")
    p.add_argument("--metadata-dir", type=Path, required=True, help="Directory with MSASL_train/val/test JSON metadata")
    p.add_argument("--video-root", type=Path, required=True, help="Root directory containing downloaded video clips")
    p.add_argument("--out-dir", type=Path, default=Path("data/processed_msasl_5class"))
    p.add_argument("--class-map-json", type=Path, default=None, help="Optional JSON mapping class IDs to words")
    p.add_argument("--train-file", type=str, default="MSASL_train.json")
    p.add_argument("--val-file", type=str, default="MSASL_val.json")
    p.add_argument("--test-file", type=str, default="MSASL_test.json")
    p.add_argument("--seq-len", type=int, default=SEQ_LEN)
    p.add_argument("--min-hand-presence", type=float, default=0.20)
    p.add_argument("--blank-ratio", type=float, default=0.30, help="blank samples as fraction of non-blank count")
    p.add_argument("--limit-per-class", type=int, default=None, help="Optional cap per class for quick experiments")
    p.add_argument("--default-fps", type=float, default=30.0)
    p.add_argument("--seed", type=int, default=RANDOM_SEED)
    return p.parse_args()


def main() -> None:
    args = parse_args()

    out_dir = ensure_dir(args.out_dir)
    rng = np.random.default_rng(args.seed)

    class_map = load_class_map(args.class_map_json)
    by_name, by_stem = build_video_index(args.video_root)
    print(f"Indexed {len(by_name)} videos under {args.video_root}")

    split_files = {
        "train": args.metadata_dir / args.train_file,
        "val": args.metadata_dir / args.val_file,
        "test": args.metadata_dir / args.test_file,
    }

    extractor = MediaPipeFeatureExtractor()
    summary = {
        "labels": ALL_LABELS,
        "seq_len": args.seq_len,
        "frame_feature_dim": FRAME_FEATURE_DIM,
        "target_gestures": TARGET_GESTURES,
        "blank_label": BLANK_LABEL,
        "splits": {},
    }

    try:
        for split_name, path in split_files.items():
            if not path.exists():
                raise FileNotFoundError(f"Missing metadata file: {path}")

            items = load_json(path)
            if not isinstance(items, list):
                raise ValueError(f"Metadata JSON must be a list: {path}")

            x, y, per_class, skip_stats = process_split(
                split_name=split_name,
                items=items,
                extractor=extractor,
                video_root=args.video_root,
                by_name=by_name,
                by_stem=by_stem,
                class_map=class_map,
                seq_len=args.seq_len,
                min_presence=args.min_hand_presence,
                limit_per_class=args.limit_per_class,
                default_fps=args.default_fps,
            )

            x, y = add_blank_samples(x, y, blank_ratio=args.blank_ratio, rng=rng)

            np.savez_compressed(out_dir / f"{split_name}.npz", X=x, y=y)

            counts = {label: int((y == LABEL_TO_INDEX[label]).sum()) for label in ALL_LABELS}
            summary["splits"][split_name] = {
                "num_sequences": int(len(y)),
                "class_counts": counts,
                "non_blank_counts": per_class,
                "skips": skip_stats,
            }

            print(f"[{split_name}] saved {len(y)} sequences -> {out_dir / f'{split_name}.npz'}")
            print(f"[{split_name}] class counts: {counts}")

    finally:
        extractor.close()

    save_label_map(out_dir / "labels.json", ALL_LABELS)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Saved labels and summary to {out_dir}")


if __name__ == "__main__":
    main()
