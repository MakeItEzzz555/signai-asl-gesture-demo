"""Extract 30x63 raw sequence samples from local MS-ASL metadata + videos."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import List

import cv2
import numpy as np

from asl_sequence.preprocess_msasl import (
    build_video_index,
    get_word_from_item,
    infer_frame_bounds,
    load_class_map,
    load_json,
    resolve_video_path,
)

from .constants import GESTURE_LABELS, SEQ_LEN
from .features import pad_or_truncate_coords
from .landmarks import ExtractorConfig, HandLandmarkExtractor

ALIAS_MAP = {
    "bye": "goodbye",
    "good bye": "goodbye",
    "good-bye": "goodbye",
    "good-by": "goodbye",
    "thankyou": "thank you",
    "thanks": "thank you",
    "understand": "i understand",
    "finish": "done",
    "hurt": "pain",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Extract raw dynamic samples from MS-ASL")
    p.add_argument("--metadata-root", type=Path, default=Path("data/msasl/metadata/MS-ASL"))
    p.add_argument("--video-root", type=Path, default=Path("data/msasl/videos"))
    p.add_argument("--out-dir", type=Path, default=Path("dataset/raw_msasl"))

    p.add_argument("--labels", nargs="+", default=GESTURE_LABELS)
    p.add_argument("--seq-len", type=int, default=SEQ_LEN)
    p.add_argument("--max-per-label", type=int, default=0, help="0 means no cap")
    p.add_argument("--default-fps", type=float, default=30.0)
    return p.parse_args()


def _extract_coords_sequence(
    extractor: HandLandmarkExtractor,
    video_path: Path,
    start_frame: int | None,
    end_frame: int | None,
    seq_len: int,
) -> np.ndarray:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    if start_frame is not None and start_frame > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(start_frame))

    coords_frames: List[np.ndarray] = []
    try:
        while True:
            frame_pos = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
            if end_frame is not None and frame_pos > int(end_frame):
                break

            ok, frame = cap.read()
            if not ok:
                break

            coords_frames.append(extractor.extract(frame))
    finally:
        cap.release()

    if not coords_frames:
        return np.zeros((seq_len, 63), dtype=np.float32)

    seq = np.stack(coords_frames).astype(np.float32)
    return pad_or_truncate_coords(seq, seq_len=seq_len)


def _get_signer_id(item: dict) -> str:
    for key in ("signer_id", "signer", "signerid", "person_id"):
        v = item.get(key)
        if isinstance(v, (int, float)):
            return str(int(v))
        if isinstance(v, str) and v.strip():
            return v.strip()
    return "unknown"


def _canonical_label(label: str) -> str:
    key = label.strip().lower()
    return ALIAS_MAP.get(key, key)


def main() -> None:
    args = parse_args()
    labels = [v.strip().lower() for v in args.labels]
    max_per_label = None if args.max_per_label <= 0 else int(args.max_per_label)

    class_map = load_class_map(args.metadata_root / "MSASL_classes.json")
    by_name, by_stem = build_video_index(args.video_root)

    split_files = [
        args.metadata_root / "MSASL_train.json",
        args.metadata_root / "MSASL_val.json",
        args.metadata_root / "MSASL_test.json",
    ]

    extractor = HandLandmarkExtractor(
        ExtractorConfig(min_detection_confidence=0.6, min_tracking_confidence=0.5)
    )

    counts = defaultdict(int)
    skipped = defaultdict(int)
    processed = 0

    try:
        for split_file in split_files:
            if not split_file.exists():
                continue
            split_name = split_file.stem.replace("MSASL_", "")
            items = load_json(split_file)
            if not isinstance(items, list):
                continue

            for item in items:
                label = _canonical_label(get_word_from_item(item, class_map))
                if label not in labels:
                    skipped["non_target"] += 1
                    continue

                if max_per_label is not None and counts[label] >= max_per_label:
                    skipped["max_per_label"] += 1
                    continue

                video_path = resolve_video_path(item, args.video_root, by_name, by_stem)
                if video_path is None:
                    skipped["missing_video"] += 1
                    continue

                start_frame, end_frame = infer_frame_bounds(item, default_fps=args.default_fps)
                signer_id = _get_signer_id(item)

                try:
                    seq = _extract_coords_sequence(
                        extractor,
                        video_path=video_path,
                        start_frame=start_frame,
                        end_frame=end_frame,
                        seq_len=args.seq_len,
                    )
                except Exception:
                    skipped["extract_error"] += 1
                    continue

                out_dir = args.out_dir / label
                out_dir.mkdir(parents=True, exist_ok=True)

                idx = counts[label]
                out_path = out_dir / f"sid-{signer_id}__msasl_{split_name}_{idx:05d}.npz"
                np.savez_compressed(
                    out_path,
                    coords=seq.astype(np.float32),
                    label=np.array(label),
                    signer_id=np.array(signer_id),
                    sample_type=np.array("gesture"),
                )

                counts[label] += 1
                processed += 1

                if processed % 100 == 0:
                    print(f"processed={processed} counts={dict(counts)}")
    finally:
        extractor.close()

    summary = {
        "labels": labels,
        "seq_len": args.seq_len,
        "processed": processed,
        "counts": dict(counts),
        "skipped": dict(skipped),
        "source": {
            "metadata_root": str(args.metadata_root),
            "video_root": str(args.video_root),
        },
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
