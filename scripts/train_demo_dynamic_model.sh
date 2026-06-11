#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT_DIR/.venv/bin/python"

RAW_DIR="$ROOT_DIR/dataset/raw_msasl_demo"
PROCESSED_DIR="$ROOT_DIR/dataset/processed_msasl_demo"
ARTIFACTS_DIR="$ROOT_DIR/artifacts/asl_dynamic_demo"

LABELS=(
  "hello"
  "yes"
  "no"
  "please"
  "help"
)

echo "[1/4] Extracting raw MS-ASL clips..."
if [[ "${SKIP_EXTRACT:-0}" == "1" ]]; then
  echo "Skipping extraction (SKIP_EXTRACT=1). Reusing: $RAW_DIR"
else
  "$PY" -m asl_dynamic.build_from_msasl \
    --metadata-root "$ROOT_DIR/data/msasl/metadata/MS-ASL" \
    --video-root "$ROOT_DIR/data/msasl/videos" \
    --out-dir "$RAW_DIR" \
    --labels "${LABELS[@]}" \
    --max-per-label 120
fi

echo "[2/4] Building processed dataset..."
"$PY" -m asl_dynamic.build_dataset \
  --raw-dir "$RAW_DIR" \
  --out-dir "$PROCESSED_DIR" \
  --labels "${LABELS[@]}" \
  --test-size 0.2 \
  --augment-per-sample 6 \
  --blank-min-samples 600

echo "[3/4] Training model..."
"$PY" -m asl_dynamic.train \
  --train-npz "$PROCESSED_DIR/train.npz" \
  --test-npz "$PROCESSED_DIR/test.npz" \
  --labels-json "$PROCESSED_DIR/labels.json" \
  --out-dir "$ARTIFACTS_DIR" \
  --epochs 60 \
  --warmup-epochs 6 \
  --batch-size 32 \
  --lr 1e-3 \
  --patience 14

echo "[4/4] Exporting ONNX..."
"$PY" -m asl_dynamic.export_onnx \
  --checkpoint "$ARTIFACTS_DIR/best.pt" \
  --onnx-output "$ROOT_DIR/public/models/asl_dynamic.onnx" \
  --labels-output "$ROOT_DIR/public/models/asl_dynamic_labels.json"

echo "Done."
