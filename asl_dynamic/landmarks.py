"""MediaPipe Tasks hand landmark extraction with 63-D normalized coordinates."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

from .constants import COORD_DIMS, EPS, FRAME_COORD_DIM, LANDMARK_COUNT

DEFAULT_HAND_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)


@dataclass
class ExtractorConfig:
    max_num_hands: int = 1
    min_detection_confidence: float = 0.6
    min_tracking_confidence: float = 0.5
    model_asset_path: str = "data/models/hand_landmarker.task"


def normalize_landmarks(hand_landmarks: Any) -> np.ndarray:
    """Convert one hand landmark set to 63-D wrist-relative scale-invariant vector."""
    if hand_landmarks is None:
        return np.zeros(FRAME_COORD_DIM, dtype=np.float32)

    coords = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks], dtype=np.float32)
    if coords.shape != (LANDMARK_COUNT, COORD_DIMS):
        return np.zeros(FRAME_COORD_DIM, dtype=np.float32)

    coords -= coords[0]
    scale = float(np.max(np.linalg.norm(coords, axis=1)))
    if scale < EPS:
        return np.zeros(FRAME_COORD_DIM, dtype=np.float32)

    coords /= scale
    return coords.reshape(-1).astype(np.float32)


class HandLandmarkExtractor:
    """MediaPipe Tasks hand extractor compatible with newer mediapipe builds."""

    def __init__(self, config: ExtractorConfig | None = None):
        self.config = config or ExtractorConfig()

        model_path = Path(self.config.model_asset_path)
        model_path.parent.mkdir(parents=True, exist_ok=True)
        if not model_path.exists():
            urlretrieve(DEFAULT_HAND_LANDMARKER_URL, model_path)

        base_options = mp_python.BaseOptions(model_asset_path=str(model_path))
        options = mp_vision.HandLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.IMAGE,
            num_hands=self.config.max_num_hands,
            min_hand_detection_confidence=self.config.min_detection_confidence,
            min_hand_presence_confidence=self.config.min_tracking_confidence,
            min_tracking_confidence=self.config.min_tracking_confidence,
        )
        self._landmarker = mp_vision.HandLandmarker.create_from_options(options)

    def close(self) -> None:
        if self._landmarker is not None:
            self._landmarker.close()
            self._landmarker = None

    def process(self, frame_bgr: np.ndarray):
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
        return self._landmarker.detect(mp_image)

    def extract(self, frame_bgr: np.ndarray) -> np.ndarray:
        results = self.process(frame_bgr)
        if not results.hand_landmarks:
            return np.zeros(FRAME_COORD_DIM, dtype=np.float32)
        return normalize_landmarks(results.hand_landmarks[0])

    def extract_and_draw(self, frame_bgr: np.ndarray, draw: bool = True) -> tuple[np.ndarray, np.ndarray]:
        """Return (coords63, drawn_frame)."""
        results = self.process(frame_bgr)
        out = frame_bgr.copy()
        if not results.hand_landmarks:
            return np.zeros(FRAME_COORD_DIM, dtype=np.float32), out

        if draw:
            h, w = out.shape[:2]
            for lm in results.hand_landmarks[0]:
                x = int(np.clip(lm.x * w, 0, w - 1))
                y = int(np.clip(lm.y * h, 0, h - 1))
                cv2.circle(out, (x, y), 3, (0, 255, 255), -1)

        coords = normalize_landmarks(results.hand_landmarks[0])
        return coords, out
