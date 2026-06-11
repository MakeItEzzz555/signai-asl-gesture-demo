# Dynamic ASL Sequence Pipeline (PyTorch)

This package implements a 64-frame dynamic gesture pipeline for:
- `hello`, `yes`, `no`, `please`, `help`
- plus `blank` transition class

## 1) Install dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-ml.txt
```

## 2) Prepare dataset from MS-ASL metadata + local clips

```bash
python -m asl_sequence.preprocess_msasl \
  --metadata-dir /path/to/msasl/metadata \
  --video-root /path/to/msasl/videos \
  --out-dir data/processed_msasl_5class
```

Expected metadata files by default:
- `MSASL_train.json`
- `MSASL_val.json`
- `MSASL_test.json`

Outputs:
- `train.npz`, `val.npz`, `test.npz`
- `labels.json`
- `summary.json`

## 3) Train BiLSTM

```bash
python -m asl_sequence.train \
  --train-npz data/processed_msasl_5class/train.npz \
  --val-npz data/processed_msasl_5class/val.npz \
  --labels-json data/processed_msasl_5class/labels.json \
  --out-dir artifacts/bilstm_asl
```

Outputs:
- `artifacts/bilstm_asl/best.pt`
- `artifacts/bilstm_asl/last.pt`
- `artifacts/bilstm_asl/history.json`

## 4) Evaluate

```bash
python -m asl_sequence.evaluate \
  --checkpoint artifacts/bilstm_asl/best.pt \
  --test-npz data/processed_msasl_5class/test.npz \
  --out-dir artifacts/eval
```

Outputs:
- `metrics.json`
- `confusion_matrix.npy`
- `confusion_matrix.png`

## 5) Realtime inference

```bash
python -m asl_sequence.realtime_infer \
  --checkpoint artifacts/bilstm_asl/best.pt \
  --camera-id 0
```

Runtime decision rule:
- rolling window: 64 frames
- emit when `confidence > 0.85` for `10` consecutive frames
- append emitted word + space
- clear buffer + cooldown of `20` frames
