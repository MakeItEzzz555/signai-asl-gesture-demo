"""Realtime webcam inference for dynamic ASL gesture bundles.

Rules:
- Rolling buffer of 64 frames
- Predict continuously
- Emit a word only if confidence > 0.85 for 10 consecutive frames
- On emit: append word + space, clear buffer, cooldown 20 frames
"""

from __future__ import annotations

import argparse
from collections import deque

import cv2
import numpy as np
import torch

from .checkpoint import load_checkpoint
from .constants import (
    CONFIDENCE_THRESHOLD,
    CONSECUTIVE_FRAMES,
    COOLDOWN_FRAMES,
    FRAME_FEATURE_DIM,
    SEQ_LEN,
)
from .feature_extractor import ExtractorConfig, MediaPipeFeatureExtractor, build_frame_feature
from .labels import BLANK_LABEL


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Realtime dynamic gesture inference")
    p.add_argument("--checkpoint", type=str, required=True)
    p.add_argument("--camera-id", type=int, default=0)
    p.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")

    p.add_argument("--confidence", type=float, default=CONFIDENCE_THRESHOLD)
    p.add_argument("--confirm-frames", type=int, default=CONSECUTIVE_FRAMES)
    p.add_argument("--cooldown", type=int, default=COOLDOWN_FRAMES)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    device = torch.device(args.device)

    model, _cfg, labels, _meta = load_checkpoint(args.checkpoint, device=device)

    cap = cv2.VideoCapture(args.camera_id)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open camera {args.camera_id}")

    extractor = MediaPipeFeatureExtractor(
        ExtractorConfig(min_detection_confidence=0.6, min_tracking_confidence=0.5)
    )

    buffer = deque(maxlen=SEQ_LEN)
    prev_coords = None

    stable_label = None
    stable_count = 0
    cooldown = 0

    sentence = ""
    latest_label = "-"
    latest_conf = 0.0

    print("Realtime inference started. Press 'q' to quit, 'c' to clear sentence.")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                continue

            coords = extractor.extract_coords_from_frame(frame)
            feat = build_frame_feature(coords, prev_coords)
            prev_coords = coords
            if feat.shape[0] != FRAME_FEATURE_DIM:
                continue

            buffer.append(feat)

            if cooldown > 0:
                cooldown -= 1
            elif len(buffer) == SEQ_LEN:
                x = np.stack(buffer).astype(np.float32)
                x_tensor = torch.from_numpy(x).unsqueeze(0).to(device)

                with torch.no_grad():
                    logits = model(x_tensor)
                    probs = torch.softmax(logits, dim=1)[0]
                    conf, idx = torch.max(probs, dim=0)

                latest_conf = float(conf.item())
                latest_label = labels[int(idx.item())]

                if latest_label != BLANK_LABEL and latest_conf >= args.confidence:
                    if stable_label == latest_label:
                        stable_count += 1
                    else:
                        stable_label = latest_label
                        stable_count = 1

                    if stable_count >= args.confirm_frames:
                        sentence += f"{latest_label} "
                        print(f"EMIT: {latest_label} (conf={latest_conf:.3f})")

                        buffer.clear()
                        prev_coords = None
                        cooldown = args.cooldown
                        stable_label = None
                        stable_count = 0
                else:
                    stable_label = None
                    stable_count = 0

            # UI overlay
            display = frame.copy()
            h, w = display.shape[:2]
            cv2.rectangle(display, (8, 8), (w - 8, 130), (0, 0, 0), -1)
            cv2.putText(display, f"Pred: {latest_label}", (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 255, 255), 2)
            cv2.putText(display, f"Conf: {latest_conf:.3f}", (16, 62), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 255, 200), 2)
            cv2.putText(display, f"Stable: {stable_count}/{args.confirm_frames}", (16, 88), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 255), 2)
            cv2.putText(display, f"Cooldown: {cooldown}", (16, 112), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 2)

            cv2.rectangle(display, (8, h - 56), (w - 8, h - 8), (0, 0, 0), -1)
            text = f"Sentence: {sentence[-90:]}"
            cv2.putText(display, text, (16, h - 24), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2)

            cv2.imshow("ASL Realtime Inference", display)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("c"):
                sentence = ""
                stable_label = None
                stable_count = 0
                cooldown = 0
                buffer.clear()
                prev_coords = None
    finally:
        extractor.close()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
