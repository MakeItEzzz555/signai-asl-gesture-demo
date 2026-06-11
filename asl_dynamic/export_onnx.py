"""Export Attention-BiGRU checkpoint to ONNX and optional TorchScript."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from .constants import FRAME_FEATURE_DIM, SEQ_LEN
from .model import load_checkpoint


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export dynamic ASL checkpoint")
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--onnx-output", type=Path, default=Path("artifacts/asl_dynamic_research/model.onnx"))
    p.add_argument("--labels-output", type=Path, default=Path("artifacts/asl_dynamic_research/labels.json"))
    p.add_argument("--torchscript-output", type=Path, default=None)
    p.add_argument("--opset", type=int, default=17)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    device = torch.device("cpu")

    model, labels, _cfg, meta = load_checkpoint(args.checkpoint, device=device)
    model.eval()

    args.onnx_output.parent.mkdir(parents=True, exist_ok=True)
    args.labels_output.parent.mkdir(parents=True, exist_ok=True)

    dummy = torch.zeros(1, SEQ_LEN, FRAME_FEATURE_DIM, dtype=torch.float32)

    torch.onnx.export(
        model,
        dummy,
        args.onnx_output,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=args.opset,
    )

    args.labels_output.write_text(json.dumps({"labels": labels, "checkpoint_meta": meta}, indent=2), encoding="utf-8")

    if args.torchscript_output is not None:
        args.torchscript_output.parent.mkdir(parents=True, exist_ok=True)
        traced = torch.jit.trace(model, dummy)
        traced.save(str(args.torchscript_output))

    print(f"ONNX written: {args.onnx_output}")
    print(f"Labels written: {args.labels_output}")
    if args.torchscript_output is not None:
        print(f"TorchScript written: {args.torchscript_output}")


if __name__ == "__main__":
    main()
