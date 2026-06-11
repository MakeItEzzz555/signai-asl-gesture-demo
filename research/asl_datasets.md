# ASL Dataset Notes for the Hackathon Demo

## Current Demo Scope

The active prototype is intentionally narrow:

- ML gestures shown to users: `hello`, `yes`, `no`, `please`, `help`
- Runtime blank class: `blank`
- Face-touch interactions: handled by the MediaPipe FaceMesh proximity heuristic, not by the trained classifier
- Second-hand recognition: removed from the demo path because it introduced interference between hands and face points

The deployed ONNX model was rolled back to the stronger research checkpoint in `artifacts/asl_dynamic_research/`. That checkpoint still has seven output labels:

```text
hello, yes, no, please, help, goodbye, blank
```

The runtime filters predictions down to the five demo signs plus `blank`. `goodbye` is kept only because it is part of the restored model's output head; it is not surfaced as a demo gesture.

## Active Dataset

The active model was trained from the MS-ASL demo extraction at `dataset/processed_msasl6`.

```text
sequence length: 30 frames
feature dimension: 126
train samples: 1201
test samples: 116
```

Training distribution:

| Label | Samples |
| --- | ---: |
| hello | 111 |
| yes | 117 |
| no | 129 |
| please | 84 |
| help | 84 |
| goodbye | 24 |
| blank | 652 |

Test distribution:

| Label | Samples |
| --- | ---: |
| hello | 4 |
| yes | 7 |
| no | 7 |
| please | 9 |
| help | 13 |
| goodbye | 2 |
| blank | 74 |

This distribution explains the current product decision. The five retained signs have enough signal for a demo; `goodbye` has too little test support and performed poorly, so it is suppressed.

## Current Model Metrics

The restored demo checkpoint has better reliability than the expanded classifier:

| Checkpoint | Scope | Validation Macro F1 | Test Macro F1 | Notes |
| --- | --- | ---: | ---: | --- |
| `artifacts/asl_dynamic_research` | 6 signs + blank | 0.7599 | 0.6960 | Active rollback source |
| `artifacts/asl_dynamic_expanded` | 25 signs + blank | 0.4236 | 0.3349 | Archived for post-demo work |

The expanded 25-sign model was removed from the live demo path because many classes had too few reliable examples. Adding more labels reduced accuracy and increased false predictions, which is the wrong tradeoff for a local hackathon prototype.

## Training Scripts

Use this script for the next demo-safe retraining pass:

```bash
scripts/train_demo_dynamic_model.sh
```

It is scoped to the five demo labels:

```text
hello, yes, no, please, help
```

The older expanded script remains available for research, but it should not be used for the hackathon build unless the dataset is rebuilt and validated with balanced per-class support.

## Face-Touch Data Policy

Face-touch gestures are not part of the classifier training set for the demo. They are handled by landmark proximity:

- MediaPipe FaceMesh finds stable face anchor regions.
- MediaPipe Hands provides fingertip positions.
- The app emits mapped face-touch labels when a fingertip enters a face region.

This keeps face interactions working without forcing the model to learn scarce face-contact examples. Do not train these labels until a dedicated, balanced face-interaction dataset exists.

## Expansion Rules After the Demo

Only add a new ML label when all of these are true:

- At least 30-50 clean usable sequences exist for the label.
- The label has signer-balanced train, validation, and test coverage.
- The label improves or preserves macro F1 in an offline test.
- The live FSM thresholds are calibrated for the new label.

Second-hand gestures should be treated as a separate research track. They need a bimanual dataset and explicit hand-to-hand spatial features, not just `maxNumHands: 2` in MediaPipe.

## Recommendation

For the hackathon, keep the one-hand five-sign model and FaceMesh heuristic. The highest-value dataset work is collecting more clean samples for the five retained labels, then retraining with `scripts/train_demo_dynamic_model.sh`.
