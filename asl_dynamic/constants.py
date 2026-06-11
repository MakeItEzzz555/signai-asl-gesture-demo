"""Global constants for research-grade dynamic ASL recognition."""

from __future__ import annotations

# Target dynamic gestures for the hackathon demo build.
GESTURE_LABELS = [
    "hello",
    "yes",
    "no",
    "please",
    "help",
]
BLANK_LABEL = "blank"
ALL_LABELS = GESTURE_LABELS + [BLANK_LABEL]

# Temporal setup.
SEQ_LEN = 30
LANDMARK_COUNT = 21
COORD_DIMS = 3
FRAME_COORD_DIM = LANDMARK_COUNT * COORD_DIMS  # 63
FRAME_FEATURE_DIM = LANDMARK_COUNT * (COORD_DIMS * 2)  # 126 (xyz + dxyz)

# Realtime segmentation defaults.
CONFIDENCE_THRESHOLD = 0.90
STABLE_FRAMES = 8
COOLDOWN_FRAMES = 14
MOTION_GATE_THRESHOLD = 0.012

# Blank class coverage.
# Raised from 400→600: more diverse synthetic blank examples reduce the high
# blank FNR (0.54) by giving the model harder negative examples to discriminate
# against (including the new "static resting hand" generation mode in data_io.py).
BLANK_MIN_SAMPLES = 600

RANDOM_SEED = 42
EPS = 1e-6

# Face-touch gestures are handled by the browser heuristic, not the ML class set.
FACE_INTERACTIVE_LABELS: frozenset = frozenset()

# All non-blank labels that are NOT face-interactive.
# Mirror augmentation IS applied to these at training time so the model
# recognises the same gesture from either hand (left or right).
NON_FACE_LABELS: frozenset = frozenset(
    label for label in GESTURE_LABELS if label not in FACE_INTERACTIVE_LABELS
)
