"""MediaPipe landmark extraction + temporal feature construction."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

from .constants import EPS, FRAME_COORD_DIM, FRAME_FEATURE_DIM, LANDMARK_COUNT, SEQ_LEN

DEFAULT_HAND_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)


@dataclass
class ExtractorConfig:
    max_num_hands: int = 1
    model_complexity: int = 1
    min_detection_confidence: float = 0.5
    min_tracking_confidence: float = 0.5
    model_asset_path: str = "data/models/hand_landmarker.task"


def normalize_landmarks(landmarks) -> np.ndarray:
    """Normalize 21x3 landmarks using wrist translation + max-abs scale."""
    if not landmarks or len(landmarks) != LANDMARK_COUNT:
        return np.zeros(FRAME_COORD_DIM, dtype=np.float32)

    coords = np.array([[lm.x, lm.y, lm.z] for lm in landmarks], dtype=np.float32)
    coords -= coords[0]
    scale = float(np.max(np.abs(coords)))
    if scale < EPS:
        return np.zeros(FRAME_COORD_DIM, dtype=np.float32)
    coords /= scale
    return coords.reshape(-1).astype(np.float32)


def build_frame_feature(coords: np.ndarray, prev_coords: Optional[np.ndarray]) -> np.ndarray:
    """Build 126-dim feature = [coords(63), temporal_derivative(63)]."""
    if prev_coords is None:
        dcoords = np.zeros_like(coords, dtype=np.float32)
    else:
        dcoords = coords - prev_coords
    feat = np.concatenate([coords, dcoords], axis=0)
    return feat.astype(np.float32)


def pad_or_truncate_sequence(sequence: np.ndarray, seq_len: int = SEQ_LEN) -> np.ndarray:
    """Return fixed-length [seq_len, 126] by center-truncation or zero-padding."""
    if sequence.ndim != 2 or sequence.shape[1] != FRAME_FEATURE_DIM:
        raise ValueError(f"Expected [T, {FRAME_FEATURE_DIM}] sequence, got {sequence.shape}")

    t = sequence.shape[0]
    if t == seq_len:
        return sequence

    if t > seq_len:
        start = (t - seq_len) // 2
        return sequence[start : start + seq_len]

    padded = np.zeros((seq_len, FRAME_FEATURE_DIM), dtype=np.float32)
    padded[:t] = sequence
    return padded


def hand_presence_ratio(sequence: np.ndarray) -> float:
    """Compute fraction of frames with non-zero landmark coordinates."""
    coords = sequence[:, :FRAME_COORD_DIM]
    active = np.linalg.norm(coords, axis=1) > EPS
    return float(active.mean()) if len(active) else 0.0


class MediaPipeFeatureExtractor:
    """Reusable MediaPipe Hands extractor for offline and realtime pipelines."""

    def __init__(self, config: ExtractorConfig | None = None):
        self.config = config or ExtractorConfig()
        self.model_path = Path(self.config.model_asset_path)
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.model_path.exists():
            urlretrieve(DEFAULT_HAND_LANDMARKER_URL, self.model_path)

        base_options = mp_python.BaseOptions(model_asset_path=str(self.model_path))
        options = mp_vision.HandLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.IMAGE,
            num_hands=self.config.max_num_hands,
            min_hand_detection_confidence=self.config.min_detection_confidence,
            min_hand_presence_confidence=self.config.min_tracking_confidence,
            min_tracking_confidence=self.config.min_tracking_confidence,
        )
        self._hands = mp_vision.HandLandmarker.create_from_options(options)

    def close(self) -> None:
        if self._hands:
            self._hands.close()
            self._hands = None

    def extract_coords_from_frame(self, frame_bgr: np.ndarray) -> np.ndarray:
        """Extract normalized 63-dim coords from a single BGR frame."""
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
        results = self._hands.detect(mp_image)
        if not results.hand_landmarks:
            return np.zeros(FRAME_COORD_DIM, dtype=np.float32)
        return normalize_landmarks(results.hand_landmarks[0])

    def extract_feature_sequence_from_video(
        self,
        video_path: str | Path,
        start_frame: Optional[int] = None,
        end_frame: Optional[int] = None,
        max_frames: Optional[int] = None,
    ) -> np.ndarray:
        """Read clip frames and convert to [T, 126] sequence."""
        path = Path(video_path)
        if not path.exists():
            raise FileNotFoundError(path)

        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            raise RuntimeError(f"Unable to open video: {path}")

        if start_frame is not None and start_frame > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(start_frame))

        features = []
        prev_coords = None
        frames_read = 0

        try:
            while True:
                if max_frames is not None and frames_read >= max_frames:
                    break

                frame_pos = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
                if end_frame is not None and frame_pos > int(end_frame):
                    break

                ok, frame = cap.read()
                if not ok:
                    break

                coords = self.extract_coords_from_frame(frame)
                features.append(build_frame_feature(coords, prev_coords))
                prev_coords = coords
                frames_read += 1
        finally:
            cap.release()

        if not features:
            return np.zeros((0, FRAME_FEATURE_DIM), dtype=np.float32)
        return np.stack(features).astype(np.float32)
