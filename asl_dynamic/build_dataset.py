"""Build signer-balanced train/test datasets with 126-D temporal features."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .constants import ALL_LABELS, BLANK_MIN_SAMPLES, RANDOM_SEED
from .data_io import build_feature_dataset, save_processed_dataset


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build processed dynamic ASL dataset")
    p.add_argument("--raw-dir", type=Path, default=Path("dataset/raw"))
    p.add_argument("--out-dir", type=Path, default=Path("dataset/processed"))
    p.add_argument("--labels", nargs="+", default=ALL_LABELS)

    p.add_argument("--test-size", type=float, default=0.2)
    p.add_argument("--augment-per-sample", type=int, default=2)
    p.add_argument("--blank-min-samples", type=int, default=BLANK_MIN_SAMPLES)
    p.add_argument("--seed", type=int, default=RANDOM_SEED)
    return p.parse_args()


def main() -> None:
    args = parse_args()

    payload = build_feature_dataset(
        raw_dir=args.raw_dir,
        labels=args.labels,
        test_size=args.test_size,
        augment_per_sample=args.augment_per_sample,
        blank_min_samples=args.blank_min_samples,
        seed=args.seed,
    )

    save_processed_dataset(args.out_dir, payload)

    summary = {
        "out_dir": str(args.out_dir),
        "train_shape": tuple(payload["x_train"].shape),
        "test_shape": tuple(payload["x_test"].shape),
        "labels": payload["labels"].tolist(),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
