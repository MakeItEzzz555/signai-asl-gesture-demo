# MediaPipe Implementation Notes

## Active Configuration

The live hackathon build uses MediaPipe Hands and MediaPipe FaceMesh together.

Hands:

```text
maxNumHands: 1
modelComplexity: 1
minDetectionConfidence: 0.6
minTrackingConfidence: 0.5
```

FaceMesh:

```text
maxNumFaces: 1
refineLandmarks: false
minDetectionConfidence: 0.5
minTrackingConfidence: 0.5
```

The key change is `maxNumHands: 1`. The app now treats the first detected hand as the primary hand and does not run a second-hand classifier path.

## Landmark Flow

Per video frame:

1. MediaPipe Hands detects up to one hand.
2. That hand is assigned to the primary recognition pipeline.
3. MediaPipe FaceMesh detects one face.
4. Fingertips are checked against face regions for touch interactions.
5. Hand landmarks are normalized and sent to the ONNX gesture model.

The active model still expects a 126-dimensional one-hand feature vector:

```text
21 landmarks * 3 xyz coordinates = 63
63 velocity features = 126
```

## Primary-Hand Policy

The demo no longer depends on handedness labels. The first detected hand is the primary hand.

This removes several unstable cases:

- MediaPipe handedness flipping on mirrored webcam feeds
- second-hand landmarks interfering with the active gesture
- crossed hands changing which hand is considered left or right
- face-touch gestures being disturbed by a second hand

Internally, any older two-hand compatibility fields are either unused or filled with neutral values so the rest of the app remains stable.

## FaceMesh Policy

FaceMesh remains part of the demo. It is not removed with the second-hand rollback.

The face-touch path checks only the two most reliable fingertip tips against face regions:

- index tip: 8
- middle tip: 12

The heuristic uses normalized 2D distance to detect contact or near-contact. The current threshold is approximately `0.065`.
Raw index/middle contact suppresses hand-only model output immediately, and the same region must be detected for 4 consecutive frames before the app emits a face-touch interaction. A continuous face contact can emit only one region label until contact clears.

When face touch is active, the app prioritizes the face interaction and suppresses hand-only word emission until the face interaction clears. This keeps a finger near the face from being misread as a normal one-hand sign.

## Why FaceMesh Is Kept

Earlier notes said FaceMesh was not integrated. That is now outdated.

FaceMesh is useful because hand-only landmarks cannot answer this question:

```text
Is the fingertip touching a meaningful face region?
```

The current heuristic answers that directly, without needing scarce training data for face-contact signs. This is more reliable for the demo than adding face labels to the classifier.

## Why Two Hands Are Disabled

Using two detected hands during the demo caused practical recognition problems:

- the wrong hand could be selected as the active hand
- second-hand movement could trigger false predictions
- hand-face contact could be confused with another hand
- the dataset did not contain enough bimanual examples for robust ML recognition

For this prototype, one primary hand plus face landmarks is the correct MediaPipe configuration.

## Known Failure Modes

| Condition | Effect | Mitigation |
| --- | --- | --- |
| Fast motion | hand detector can drop landmarks | 30-frame buffer and FSM smoothing |
| Hand partly leaves frame | normalized features become noisy | keep the signing hand in view |
| Finger very close to face but not touching | heuristic can fire early | tune face threshold after live testing |
| Multiple people in frame | FaceMesh picks one face | demo with a single signer |
| Two hands visible | only one hand is used | instruct demo users to sign with one hand |

## Recommended Tuning Before Demo

Keep these defaults unless live testing shows a clear issue:

- Hands detection confidence: `0.6`
- Hands tracking confidence: `0.5`
- FaceMesh detection confidence: `0.5`
- FaceMesh tracking confidence: `0.5`
- Touch threshold: `0.065`
- Face-touch fingertips: index tip `8`, middle tip `12`
- Face-touch confirmation: `4` consecutive frames on the same region

Do not re-enable `maxNumHands: 2` for the hackathon build. If two-hand recognition returns later, it should have a dedicated bimanual feature pipeline and dataset.
