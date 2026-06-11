# Dynamic ASL (Research-Grade)

Temporal ASL recognizer for dynamic gesture bundles with realtime CPU inference.

Classes:
- `hello`
- `yes`
- `no`
- `please`
- `help`
- `goodbye`
- `blank`

## Architecture

1. Landmark extraction (`landmarks.py`)
- MediaPipe Hands, 21 landmarks, xyz.
- Wrist-relative translation normalization.
- Scale-invariant normalization by max wrist distance.
- Per-frame output: `63`.

2. Feature engineering (`features.py`)
- Temporal derivative per landmark:
  - `dx_t = x_t - x_(t-1)`
  - `dy_t = y_t - y_(t-1)`
  - `dz_t = z_t - z_(t-1)`
- First frame derivative is zeros.
- Per-frame output: `126 = 63 xyz + 63 dxyz`.

3. Model (`model.py` + `attention.py`)
- Input `[B, 30, 126]`
- Linear projection `126 -> hidden`
- 2-layer BiGRU (`hidden <= 128`)
- Attention pooling over time
- Dropout + linear classifier

4. Segmentation (`segmentation.py`)
- Sliding 30-frame buffer
- Confidence threshold
- Stability frames
- Cooldown
- Emit only if predicted class != `blank`
- Sentence builder appends `word + " "`

5. Motion gating (`infer_realtime.py`)
- Compute motion energy from frame-to-frame landmark deltas.
- Skip expensive model forward on low motion.
- Force periodic inference for responsiveness.

## Package layout

```text
asl_dynamic/
  landmarks.py
  features.py
  attention.py
  model.py
  segmentation.py
  augment.py
  data_io.py
  record_dataset.py
  build_dataset.py
  build_from_msasl.py
  train.py
  evaluate.py
  infer_realtime.py
  export_onnx.py
```

## Data recording

Record with signer metadata (required for signer-balanced split):

```bash
python -m asl_dynamic.record_dataset --label hello --signer-id s01 --samples 80 --draw
python -m asl_dynamic.record_dataset --label yes --signer-id s01 --samples 80 --draw
python -m asl_dynamic.record_dataset --label no --signer-id s01 --samples 80 --draw
python -m asl_dynamic.record_dataset --label please --signer-id s01 --samples 80 --draw
python -m asl_dynamic.record_dataset --label help --signer-id s01 --samples 80 --draw
python -m asl_dynamic.record_dataset --label goodbye --signer-id s01 --samples 80 --draw
python -m asl_dynamic.record_dataset --label blank --signer-id s01 --sample-type idle --samples 120 --draw
```

Repeat for multiple signers (`s02`, `s03`, ...).

Raw layout:

```text
dataset/raw/
  hello/
  yes/
  no/
  please/
  help/
  goodbye/
  blank/
```

Each sample is `.npz` containing:
- `coords`: `(30, 63)`
- `label`
- `signer_id`
- `sample_type`

## Optional: Build raw data from MS-ASL

```bash
python -m asl_dynamic.build_from_msasl \
  --metadata-root data/msasl/metadata/MS-ASL \
  --video-root data/msasl/videos \
  --out-dir dataset/raw_msasl \
  --labels hello yes no please help goodbye \
  --max-per-label 400
```

## Build processed dataset

Includes:
- signer-balanced train/test split (no signer overlap)
- 126-D feature construction
- blank class generation and hard negatives

```bash
python -m asl_dynamic.build_dataset \
  --raw-dir dataset/raw \
  --out-dir dataset/processed \
  --test-size 0.2 \
  --augment-per-sample 2 \
  --blank-min-samples 400
```

Outputs:
- `dataset/processed/train.npz`
- `dataset/processed/test.npz`
- `dataset/processed/labels.json`
- `dataset/processed/summary.json`

## Train

```bash
python -m asl_dynamic.train \
  --train-npz dataset/processed/train.npz \
  --test-npz dataset/processed/test.npz \
  --labels-json dataset/processed/labels.json \
  --out-dir artifacts/asl_dynamic_research \
  --epochs 60 --warmup-epochs 5 --batch-size 32 --lr 1e-3
```

Training upgrades:
- CrossEntropy
- class-balanced sampler
- warmup + cosine LR
- weight decay
- grad clipping `1.0`
- early stopping on validation macro F1

## Evaluate

```bash
python -m asl_dynamic.evaluate \
  --checkpoint artifacts/asl_dynamic_research/best.pt \
  --npz dataset/processed/test.npz \
  --labels-json dataset/processed/labels.json \
  --out-dir artifacts/asl_dynamic_eval
```

Reported metrics:
- macro F1
- confusion matrix
- per-class precision/recall/F1
- blank false-positive metrics

## Realtime inference

Torch backend:

```bash
python -m asl_dynamic.infer_realtime \
  --backend torch \
  --checkpoint artifacts/asl_dynamic_research/best.pt \
  --labels-json dataset/processed/labels.json \
  --confidence 0.90 --stable-frames 8 --cooldown 14 --draw
```

ONNX Runtime backend:

```bash
python -m asl_dynamic.infer_realtime \
  --backend onnx \
  --onnx-model artifacts/asl_dynamic_research/model.onnx \
  --labels-json artifacts/asl_dynamic_research/labels.json
```

## Export ONNX / TorchScript

```bash
python -m asl_dynamic.export_onnx \
  --checkpoint artifacts/asl_dynamic_research/best.pt \
  --onnx-output artifacts/asl_dynamic_research/model.onnx \
  --labels-output artifacts/asl_dynamic_research/labels.json \
  --torchscript-output artifacts/asl_dynamic_research/model.ts
```
