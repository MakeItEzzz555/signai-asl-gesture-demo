"""Realtime dynamic ASL inference with motion gating and robust segmentation."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path
from typing import Callable, List, Tuple

import cv2
import numpy as np
import torch

from .constants import (
    CONFIDENCE_THRESHOLD,
    COOLDOWN_FRAMES,
    FRAME_COORD_DIM,
    FRAME_FEATURE_DIM,
    MOTION_GATE_THRESHOLD,
    SEQ_LEN,
    STABLE_FRAMES,
)
from .data_io import load_labels
from .features import build_frame_feature, motion_energy
from .landmarks import ExtractorConfig, HandLandmarkExtractor
from .model import load_checkpoint
from .segmentation import GestureSegmenter, SegmenterConfig, SentenceBuilder


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Realtime ASL dynamic inference (CPU-friendly)")
    p.add_argument("--checkpoint", type=Path, default=Path("artifacts/asl_dynamic_research/best.pt"))
    p.add_argument("--labels-json", type=Path, default=Path("dataset/processed/labels.json"))

    p.add_argument("--backend", type=str, default="torch", choices=["torch", "onnx"])
    p.add_argument("--onnx-model", type=Path, default=None)

    p.add_argument("--camera-id", type=int, default=0)
    p.add_argument("--device", type=str, default="cpu")

    p.add_argument("--confidence", type=float, default=CONFIDENCE_THRESHOLD)
    p.add_argument("--stable-frames", type=int, default=STABLE_FRAMES)
    p.add_argument("--cooldown", type=int, default=COOLDOWN_FRAMES)

    p.add_argument("--motion-threshold", type=float, default=MOTION_GATE_THRESHOLD)
    p.add_argument("--force-infer-interval", type=int, default=5)
    p.add_argument("--draw", action="store_true")
    return p.parse_args()


def _torch_predictor(checkpoint: Path, device: torch.device) -> Tuple[Callable[[np.ndarray], Tuple[int, float]], List[str]]:
    model, labels, _cfg, _meta = load_checkpoint(checkpoint, device=device)

    def predict(seq_features: np.ndarray) -> Tuple[int, float]:
        x = torch.from_numpy(seq_features.astype(np.float32)).unsqueeze(0).to(device)
        with torch.inference_mode():
            logits = model(x)
            probs = torch.softmax(logits, dim=1)[0]
            conf, idx = torch.max(probs, dim=0)
        return int(idx.item()), float(conf.item())

    return predict, labels


def _onnx_predictor(onnx_model: Path, labels: List[str]) -> Callable[[np.ndarray], Tuple[int, float]]:
    try:
        import onnxruntime as ort
    except Exception as exc:
        raise RuntimeError("onnxruntime is required for --backend onnx") from exc

    session = ort.InferenceSession(str(onnx_model), providers=["CPUExecutionProvider"])
    in_name = session.get_inputs()[0].name
    out_name = session.get_outputs()[0].name

    def predict(seq_features: np.ndarray) -> Tuple[int, float]:
        x = seq_features.astype(np.float32)[None, :, :]
        logits = session.run([out_name], {in_name: x})[0][0]
        probs = np.exp(logits - np.max(logits))
        probs /= np.sum(probs)
        idx = int(np.argmax(probs))
        conf = float(probs[idx])
        return idx, conf

    return predict


def main() -> None:
    args = parse_args()

    if args.backend == "torch":
        predictor, labels = _torch_predictor(args.checkpoint, torch.device(args.device))
    else:
        labels = load_labels(args.labels_json)
        if args.onnx_model is None:
            raise ValueError("--onnx-model is required when --backend onnx")
        predictor = _onnx_predictor(args.onnx_model, labels)

    cap = cv2.VideoCapture(args.camera_id)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open camera {args.camera_id}")

    extractor = HandLandmarkExtractor(ExtractorConfig())

    coords_buffer: deque[np.ndarray] = deque(maxlen=SEQ_LEN)
    feature_buffer: deque[np.ndarray] = deque(maxlen=SEQ_LEN)
    prev_coords = None

    segmenter = GestureSegmenter(
        SegmenterConfig(
            confidence_threshold=args.confidence,
            stable_frames=args.stable_frames,
            cooldown_frames=args.cooldown,
            min_motion_energy=args.motion_threshold,
        )
    )
    sentence = SentenceBuilder()

    latest_label = "-"
    latest_conf = 0.0
    frames_since_infer = 0

    print("Realtime inference started. Keys: q=quit, c=clear sentence")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                continue

            if args.draw:
                coords, show = extractor.extract_and_draw(frame, draw=True)
            else:
                coords = extractor.extract(frame)
                show = frame.copy()

            if coords.shape[0] != FRAME_COORD_DIM:
                continue

            feat = build_frame_feature(coords, prev_coords)
            prev_coords = coords

            coords_buffer.append(coords)
            feature_buffer.append(feat)
            frames_since_infer += 1

            if len(feature_buffer) == SEQ_LEN:
                coords_seq = np.stack(coords_buffer).astype(np.float32)
                seq_features = np.stack(feature_buffer).astype(np.float32)
                assert seq_features.shape == (SEQ_LEN, FRAME_FEATURE_DIM)

                mot = motion_energy(coords_seq)
                enough_motion = mot >= args.motion_threshold
                force_infer = frames_since_infer >= args.force_infer_interval

                if enough_motion or force_infer:
                    idx, conf = predictor(seq_features)
                    frames_since_infer = 0

                    latest_label = labels[idx]
                    latest_conf = conf

                    emitted = segmenter.update(latest_label, latest_conf)
                    if emitted:
                        sentence.append(emitted)

                        coords_buffer.clear()
                        feature_buffer.clear()
                        prev_coords = None
                        print(f"EMIT: {emitted} (conf={latest_conf:.3f})")
                else:
                    # Low-motion region: avoid false stability carry-over.
                    segmenter.reset_stability()

            h, w = show.shape[:2]
            cv2.rectangle(show, (8, 8), (w - 8, 146), (0, 0, 0), -1)
            cv2.putText(show, f"Pred: {latest_label}", (16, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.78, (0, 255, 255), 2)
            cv2.putText(show, f"Conf: {latest_conf:.3f}", (16, 58), cv2.FONT_HERSHEY_SIMPLEX, 0.66, (200, 255, 200), 2)
            cv2.putText(
                show,
                f"Stable: {segmenter.stable_count}/{segmenter.cfg.stable_frames}",
                (16, 82),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.60,
                (180, 180, 255),
                2,
            )
            cv2.putText(show, f"Cooldown: {segmenter.cooldown}", (16, 106), cv2.FONT_HERSHEY_SIMPLEX, 0.60, (180, 180, 180), 2)

            motion_val = motion_energy(np.stack(coords_buffer).astype(np.float32)) if len(coords_buffer) >= 2 else 0.0
            cv2.putText(show, f"Motion: {motion_val:.4f}", (16, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.60, (180, 255, 180), 2)
            cv2.putText(show, f"Buffer: {len(feature_buffer)}/{SEQ_LEN}", (220, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.60, (180, 255, 180), 2)

            cv2.rectangle(show, (8, h - 56), (w - 8, h - 8), (0, 0, 0), -1)
            cv2.putText(show, f"Sentence: {sentence.text[-90:]}", (16, h - 24), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2)

            cv2.imshow("ASL Dynamic Realtime", show)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("c"):
                sentence.clear()
                segmenter.reset()
                coords_buffer.clear()
                feature_buffer.clear()
                prev_coords = None
    finally:
        extractor.close()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
