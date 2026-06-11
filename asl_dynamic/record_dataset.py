"""Interactive recorder for dynamic ASL sequences with signer metadata.

Writes `.npz` files under:
  dataset/raw/<label>/
Each sample stores:
  - coords: [30,63]
  - label
  - signer_id
  - sample_type
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import cv2
import numpy as np

from .constants import ALL_LABELS, BLANK_LABEL, FRAME_COORD_DIM, SEQ_LEN
from .features import pad_or_truncate_coords
from .landmarks import ExtractorConfig, HandLandmarkExtractor


SAMPLE_TYPES = ["gesture", "idle", "transition", "background_noise", "partial"]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Record dynamic ASL sequences")
    p.add_argument("--label", type=str, required=True, choices=ALL_LABELS)
    p.add_argument("--signer-id", type=str, required=True)
    p.add_argument("--sample-type", type=str, default="gesture", choices=SAMPLE_TYPES)

    p.add_argument("--out-dir", type=Path, default=Path("dataset/raw"))
    p.add_argument("--samples", type=int, default=80)
    p.add_argument("--seq-len", type=int, default=SEQ_LEN)
    p.add_argument("--camera-id", type=int, default=0)
    p.add_argument("--countdown", type=float, default=1.2)
    p.add_argument("--draw", action="store_true")
    return p.parse_args()


def save_sample(
    out_path: Path,
    coords_seq: np.ndarray,
    label: str,
    signer_id: str,
    sample_type: str,
) -> None:
    np.savez_compressed(
        out_path,
        coords=coords_seq.astype(np.float32),
        label=np.array(label),
        signer_id=np.array(signer_id),
        sample_type=np.array(sample_type),
        timestamp=np.array(int(time.time() * 1000), dtype=np.int64),
    )


def main() -> None:
    args = parse_args()
    label = args.label.lower().strip()
    signer_id = args.signer_id.strip()

    if label == BLANK_LABEL and args.sample_type == "gesture":
        # Default sample type for blank recordings.
        args.sample_type = "idle"

    label_dir = args.out_dir / label
    label_dir.mkdir(parents=True, exist_ok=True)

    extractor = HandLandmarkExtractor(ExtractorConfig())
    cap = cv2.VideoCapture(args.camera_id)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open webcam {args.camera_id}")

    recorded = 0
    is_capturing = False
    buffer: list[np.ndarray] = []
    capture_start_ts = 0.0

    print(
        f"Recording label={label}, signer_id={signer_id}, sample_type={args.sample_type}. "
        "SPACE=start sample, Q=quit"
    )

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                continue

            coords, drawn = extractor.extract_and_draw(frame, draw=args.draw)
            show = drawn

            if is_capturing:
                now = time.time()
                if now >= capture_start_ts + args.countdown:
                    buffer.append(coords)

                if len(buffer) >= args.seq_len:
                    seq = np.stack(buffer[: args.seq_len]).astype(np.float32)
                    seq = pad_or_truncate_coords(seq, seq_len=args.seq_len)
                    if seq.shape != (args.seq_len, FRAME_COORD_DIM):
                        raise RuntimeError("Recorded sequence shape mismatch")

                    ts = int(time.time() * 1000)
                    name = f"sid-{signer_id}__{args.sample_type}__{ts}_{recorded:04d}.npz"
                    out_path = label_dir / name
                    save_sample(out_path, seq, label=label, signer_id=signer_id, sample_type=args.sample_type)

                    recorded += 1
                    is_capturing = False
                    buffer = []
                    print(f"Saved [{recorded}/{args.samples}] -> {out_path}")

            line1 = f"Label={label} Signer={signer_id} Saved={recorded}/{args.samples}"
            if is_capturing:
                wait_left = max(0.0, capture_start_ts + args.countdown - time.time())
                if wait_left > 0:
                    line2 = f"Countdown: {wait_left:.1f}s"
                else:
                    line2 = f"Capturing: {len(buffer)}/{args.seq_len}"
            else:
                line2 = "SPACE=capture one sample | Q=quit"

            cv2.rectangle(show, (8, 8), (show.shape[1] - 8, 74), (0, 0, 0), -1)
            cv2.putText(show, line1, (16, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.60, (0, 255, 255), 2)
            cv2.putText(show, line2, (16, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.56, (190, 255, 190), 2)

            cv2.imshow("ASL Dynamic Recorder", show)
            key = cv2.waitKey(1) & 0xFF

            if key == ord("q"):
                break
            if key == ord(" ") and not is_capturing and recorded < args.samples:
                is_capturing = True
                buffer = []
                capture_start_ts = time.time()

            if recorded >= args.samples:
                print("Target sample count reached.")
                break
    finally:
        extractor.close()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
