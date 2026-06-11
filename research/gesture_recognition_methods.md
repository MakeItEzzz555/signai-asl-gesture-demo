# Gesture Recognition Method Notes

## Current Production Method

The hackathon prototype uses a hybrid approach:

- MediaPipe Hands detects one primary hand.
- MediaPipe FaceMesh stays enabled for face-touch interactions.
- The ONNX dynamic model classifies one-hand motion sequences.
- A deterministic face-touch heuristic emits face-region interactions outside the classifier.

This split is intentional. The one-hand model is reliable enough for a demo, while the face-touch heuristic preserves the useful face-plus-hand behavior without adding unstable classes to the trained model.

## One-Hand Dynamic Classifier

The active classifier is an Attention BiGRU exported to ONNX.

```text
input:  [batch, 30, 126]
output: hello, yes, no, please, help, goodbye, blank
visible demo labels: hello, yes, no, please, help, blank
```

Each frame contains normalized hand coordinates plus velocity features:

- 21 landmarks
- 3 coordinates per landmark
- 63 position values
- 63 velocity values
- 126 total features per frame

The app keeps a 30-frame rolling window and passes it through the ONNX model. `SegmentationFSM` stabilizes predictions before emitting a word.

## Runtime Label Gating

The restored model still has a `goodbye` output because that was part of the best checkpoint. Runtime code filters it out:

- visible score list includes only demo labels
- non-demo top predictions are treated as `blank`
- the UI and emitted transcript stay inside the demo vocabulary

This is safer than changing the model head without retraining, and it keeps the demo behavior aligned with the strongest available checkpoint.

## Face-Touch Heuristic

Face-touch interactions use landmarks directly instead of ML classification.

Inputs:

- fingertip landmarks: 8, 12
- face regions: mouth, eye, nose, forehead, ear
- touch threshold: approximately `0.065` in normalized image coordinates

Behavior:

- detect fingertip-to-face-region proximity
- suppress hand-only model output as soon as raw index/middle face contact is detected
- require the same face region for 4 consecutive frames
- emit one mapped face interaction label per continuous face contact
- suppress one-hand model output while face interaction is active

This avoids the earlier issue where hand-only training confused face-contact signs with generic motion or blank.

## Why Second-Hand Recognition Was Removed

The two-hand path caused demo-risk behavior:

- the second hand could steal or disturb primary-hand detections
- hand-to-face interactions became harder to separate from the second hand
- mirrored or crossed hands increased landmark assignment instability
- bimanual labels were not backed by a dedicated balanced dataset

For the hackathon prototype, the correct move is to keep one primary hand and preserve face-touch recognition. Second-hand recognition should return later as a separate model and dataset effort.

## Methods Considered

| Method | Current decision | Reason |
| --- | --- | --- |
| One-hand Attention BiGRU | Keep | Fast, already exported to ONNX, best current metrics |
| FaceMesh proximity heuristic | Keep | Works without scarce face-contact training data |
| Expanded 25-sign classifier | Archive | Test macro F1 dropped to about 0.335 |
| Second-hand classifier path | Remove from demo | Interferes with hand and face recognition |
| Transformer sequence model | Defer | More data and validation needed |
| ST-GCN | Defer | Higher complexity and uncertain browser payoff |
| Static image classifier | Do not use | Cannot model dynamic signs |

## Recommended Demo Strategy

Use a narrow, stable recognition surface:

1. One primary hand for ML gesture recognition.
2. Five visible one-hand signs: `hello`, `yes`, `no`, `please`, `help`.
3. Face-touch interactions handled by heuristic landmark proximity.
4. No visible second-hand model output.
5. No expanded vocabulary until the dataset supports it.

This gives the demo a clear story: reliable real-time one-hand ASL gestures plus face-aware interaction.

## Post-Hackathon Research Path

After the demo, expand in this order:

1. Collect more balanced data for the five retained labels.
2. Retrain a true five-label-plus-blank ONNX model.
3. Reintroduce one new label at a time only after offline metrics stay stable.
4. Build a dedicated face-interaction dataset if heuristic coverage becomes insufficient.
5. Design a separate bimanual feature pipeline before restoring second-hand recognition.
