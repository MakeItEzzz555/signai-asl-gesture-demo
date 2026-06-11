# Model Architecture Analysis

## Active Model

The active demo model is:

```text
public/models/asl_dynamic.onnx
```

It was restored from:

```text
artifacts/asl_dynamic_research/model.onnx
```

The paired labels file is:

```text
public/models/asl_dynamic_labels.json
```

The model input shape is:

```text
[batch, 30, 126]
```

Meaning:

| Dimension | Meaning |
| --- | --- |
| batch | one real-time sample |
| 30 | sequence frames |
| 126 | 63 normalized landmark coordinates plus 63 velocity features |

## Output Labels

The restored checkpoint has seven outputs:

```text
hello, yes, no, please, help, goodbye, blank
```

The demo exposes only:

```text
hello, yes, no, please, help, blank
```

`goodbye` remains in the ONNX head for checkpoint compatibility but is filtered in runtime inference. If the model predicts `goodbye`, the app treats it as `blank` for the demo.

## Architecture

The checkpoint is an Attention BiGRU sequence classifier:

| Stage | Role |
| --- | --- |
| Input projection | maps 126 frame features into the model hidden size |
| BiGRU stack | models forward and backward temporal motion |
| Temporal attention | weights the most informative frames |
| Classifier head | emits logits for the checkpoint labels |

This architecture is still a good fit for the prototype because it is small, fast, and deploys cleanly through ONNX Runtime Web.

## Runtime Post-Processing

The browser does not expose raw model output directly. The runtime applies:

- 30-frame rolling sequence buffering
- confidence thresholding
- margin checks between top predictions
- `SegmentationFSM` stabilization
- label gating to the demo vocabulary
- face-touch suppression when the FaceMesh heuristic is active

This is why the active product behavior is narrower than the ONNX output head.

## Metrics Behind the Rollback

The model was rolled back because the expanded classifier was less reliable.

| Model | Labels | Validation Macro F1 | Test Macro F1 | Decision |
| --- | --- | ---: | ---: | --- |
| Research rollback | 6 signs + blank | 0.7599 | 0.6960 | Active |
| Expanded model | 25 signs + blank | 0.4236 | 0.3349 | Archived |

The expanded model produced too many inaccurate predictions for a demo. The smaller checkpoint is more defensible for a hackathon prototype.

## Why Not Retrain the Head Immediately

A true five-label-plus-blank model would be cleaner than filtering `goodbye` at runtime. However, changing the output head requires retraining and validating the checkpoint.

For the current demo, runtime gating is lower risk because:

- the restored checkpoint is already validated
- model input shape remains unchanged
- ONNX loading remains unchanged
- non-demo output is safely suppressed

The next training pass should use `scripts/train_demo_dynamic_model.sh` to produce a true five-sign model.

## Face-Touch Architecture

Face-touch behavior is outside the ONNX model.

The app uses:

- MediaPipe FaceMesh for face landmarks
- MediaPipe Hands for fingertip landmarks
- deterministic fingertip-to-region distance checks

This is intentionally separate from the classifier. The model should not learn face-contact labels until there is enough balanced face-touch data.

## Second-Hand Architecture Status

Second-hand recognition is removed from the demo path.

The current model and runtime are optimized for one primary hand. Reintroducing two hands requires more than changing MediaPipe settings. A proper bimanual architecture needs:

- stable hand identity tracking
- left/right or primary/secondary assignment rules
- inter-hand distance and relative motion features
- bimanual training examples
- separate validation for face-hand interference

Until those exist, second-hand recognition should stay archived.

## Recommended Next Model Work

Before the hackathon:

1. Do not expand the vocabulary.
2. Do not re-enable second-hand recognition.
3. Keep the FaceMesh heuristic.
4. Smoke-test the five visible signs in realistic lighting.

After the hackathon:

1. Collect more balanced samples for `hello`, `yes`, `no`, `please`, and `help`.
2. Retrain with `scripts/train_demo_dynamic_model.sh`.
3. Export a true five-label-plus-blank ONNX model.
4. Add new labels one at a time only if macro F1 and live behavior stay stable.
5. Treat bimanual recognition as a separate research milestone.
