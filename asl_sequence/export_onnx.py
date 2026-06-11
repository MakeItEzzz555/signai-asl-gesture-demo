"""Export trained BiLSTM checkpoint to ONNX for browser inference."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from .checkpoint import load_checkpoint
from .constants import FRAME_FEATURE_DIM, SEQ_LEN


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export ASL BiLSTM checkpoint to ONNX")
    p.add_argument(
        "--checkpoint",
        type=Path,
        default=Path("artifacts/bilstm_asl/best.pt"),
        help="Path to .pt checkpoint",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=Path("public/models/asl_bilstm.onnx"),
        help="Output ONNX model path",
    )
    p.add_argument(
        "--labels-output",
        type=Path,
        default=Path("public/models/asl_labels.json"),
        help="Output labels JSON path",
    )
    p.add_argument("--opset", type=int, default=17, help="ONNX opset version")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    device = torch.device("cpu")
    model, _cfg, labels, _meta = load_checkpoint(args.checkpoint, device=device)
    model.eval()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.labels_output.parent.mkdir(parents=True, exist_ok=True)

    dummy = torch.zeros(1, SEQ_LEN, FRAME_FEATURE_DIM, dtype=torch.float32)

    torch.onnx.export(
        model,
        dummy,
        args.output,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=args.opset,
    )

    args.labels_output.write_text(json.dumps({"labels": labels}, indent=2), encoding="utf-8")
    print(f"ONNX model written to: {args.output}")
    print(f"Labels written to: {args.labels_output}")


if __name__ == "__main__":
    main()
