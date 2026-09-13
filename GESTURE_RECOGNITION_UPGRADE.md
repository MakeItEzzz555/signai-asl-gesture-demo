# Implementation Prompt: Dual-Hand Recognition + Proximity-Gated Face + Combined Gesture Training

> Status: archived post-hackathon research direction. The 164-dimensional snippets below are a proposal, not current behavior. The active demo captures a 156-dimensional extended vector with one active 63-dimensional hand slot; the shipped ONNX sequence model derives 126 temporal features per frame, and the browser-trained custom classifier uses 63 hand features.

## Goal

Fix three interconnected problems in the current landmark pipeline:

1. **Both hands recognised independently** — when both hands are active, run two separate inference pipelines and output two words simultaneously.
2. **Face landmarks must not bleed into output** — face features are only active in the feature vector when a fingertip is physically near a face landmark; otherwise the face slice is zeroed out so it cannot influence predictions.
3. **Combined hand+face gestures trained correctly** — gestures like Mother and Father require the model to know both the hand *shape* and the hand's *position relative to the face*; the current design loses the spatial relationship, so these gestures cannot be learned reliably.

---

## Part 1 — Feature Vector Redesign: 156 → 164 dimensions

The current 156-dim layout has no spatial relationship between hands and face, and always injects face features even when both hands are waving in empty space.

### New 164-dim layout

```
[0   : 63 ] right hand SHAPE  — 21 landmarks × 3, wrist-relative normalised to [-1,1]
[63  : 126] left hand  SHAPE  — 21 landmarks × 3, wrist-relative normalised to [-1,1] (zeros if absent)
[126 : 129] right wrist → nose offset — (wrist.x - nose.x, wrist.y - nose.y, wrist.z - nose.z) in raw image space [0,1]; zeros if right hand absent
[129 : 132] left wrist  → nose offset — same for left hand; zeros if left hand absent
[132 : 162] face SHAPE  — 10 key landmarks × 3, nose-relative normalised — **GATED** (all zeros unless at least one hand is near the face)
[162 : 164] proximity flags — [right_near_face (0 or 1), left_near_face (0 or 1)]
```

**Why this is better:**
- `[0:126]` captures the *shape* of each hand, position-invariant (existing behaviour, unchanged).
- `[126:132]` captures *where* each hand is relative to the face in image space. This is the key missing signal for face-interaction gestures. Mother (hand at chin, offset ≈ [0.05, 0.15, -0.1]) vs Father (hand at forehead, offset ≈ [0.05, -0.25, -0.1]) become distinguishable even if their hand shapes are nearly identical.
- `[132:162]` provides the face's shape context, but *only* when a hand is physically close. When hands are far from the face this slice is all zeros, so the model does not need to unlearn any spurious correlation between face presence and gesture label.
- `[162:164]` are explicit binary flags so the model has a clear signal about whether the face slice contains real data or zeros.

### Proximity gate definition

```typescript
// In src/utils/landmarks.ts

export const FACE_PROXIMITY_THRESHOLD = 0.15; // image-space Euclidean distance

/**
 * Returns true if any fingertip of `handRaw` is within FACE_PROXIMITY_THRESHOLD
 * of any of the key face landmark positions.
 *
 * Operates in raw image space (x, y both in [0,1]) so the check is camera-distance-invariant
 * relative to the face (face landmarks scale with the face in image space).
 *
 * @param handRaw     Raw (unnormalised) 21-point hand landmarks from MediaPipe
 * @param faceRaw     Raw 468-point face mesh landmarks from MediaPipe FaceMesh
 * @param keyIndices  FACE_KEY_INDICES (the 10 key point indices)
 */
export function isHandNearFace(
  handRaw: Landmark[],
  faceRaw: Landmark[],
  keyIndices: readonly number[] = FACE_KEY_INDICES,
): boolean {
  const FINGER_TIPS = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky tips
  for (const tipIdx of FINGER_TIPS) {
    const tip = handRaw[tipIdx];
    for (const faceIdx of keyIndices) {
      const fp = faceRaw[faceIdx];
      const dx = tip.x - fp.x;
      const dy = tip.y - fp.y;
      if (Math.sqrt(dx * dx + dy * dy) < FACE_PROXIMITY_THRESHOLD) return true;
    }
  }
  return false;
}

/**
 * Compute the wrist→nose offset in raw image space.
 * Returns [0, 0, 0] if the hand or face is absent.
 */
export function wristToNoseOffset(
  handRaw: Landmark[] | null,
  noseLandmark: Landmark | null,
): [number, number, number] {
  if (!handRaw || !noseLandmark) return [0, 0, 0];
  const wrist = handRaw[0];
  return [
    wrist.x - noseLandmark.x,
    wrist.y - noseLandmark.y,
    wrist.z - noseLandmark.z,
  ];
}

/**
 * Build the extended 164-dim feature vector.
 *
 * @param rightShape   Normalised right hand features (63 floats) or null
 * @param leftShape    Normalised left hand features (63 floats) or null
 * @param rightOffset  Wrist→nose offset for right hand (3 floats)
 * @param leftOffset   Wrist→nose offset for left hand (3 floats)
 * @param faceShape    Normalised face features (30 floats) or null (null = gate closed)
 * @param rightNear    Whether right hand is near face
 * @param leftNear     Whether left hand is near face
 */
export function buildExtendedFeatures(
  rightShape:  number[] | null,
  leftShape:   number[] | null,
  rightOffset: [number, number, number],
  leftOffset:  [number, number, number],
  faceShape:   number[] | null,
  rightNear:   boolean,
  leftNear:    boolean,
): number[] {
  return [
    ...(rightShape  ?? new Array(63).fill(0)),
    ...(leftShape   ?? new Array(63).fill(0)),
    ...rightOffset,
    ...leftOffset,
    ...(faceShape   ?? new Array(30).fill(0)),
    rightNear ? 1 : 0,
    leftNear  ? 1 : 0,
  ];
}
```

### Changes needed in `src/hooks/useMediaPipe.ts`

Inside `processFrame`, after both `hands.send()` and `faceMesh.send()` complete:

```typescript
const { right: rightRaw, left: leftRaw } = handResultRef.current;
const faceRaw = faceResultRef.current;

// Nose tip is FACE_KEY_INDICES[0] = landmark 1 in the full 468-point set
const noseLandmark = faceRaw ? faceRaw[FACE_KEY_INDICES[0]] : null;

// Proximity check (operates on raw image-space coordinates)
const rightNear = rightRaw && faceRaw ? isHandNearFace(rightRaw, faceRaw) : false;
const leftNear  = leftRaw  && faceRaw ? isHandNearFace(leftRaw,  faceRaw) : false;
const anyNear   = rightNear || leftNear;

// Wrist→nose offsets (spatial relationship, always included)
const rightOffset = wristToNoseOffset(rightRaw, noseLandmark);
const leftOffset  = wristToNoseOffset(leftRaw,  noseLandmark);

// Face shape only when a hand is close
const faceFeatures = (anyNear && faceRaw) ? normalizeFaceLandmarks(faceRaw) : null;

// Hand shapes (normalised, position-invariant)
const rightShape = rightRaw ? normalizeLandmarks(rightRaw) : null;
const leftShape  = leftRaw  ? normalizeLandmarks(leftRaw)  : null;

// Assemble 164-dim vector
const extended = buildExtendedFeatures(
  rightShape, leftShape,
  rightOffset, leftOffset,
  faceShape,
  rightNear, leftNear,
);
```

Also update `ZERO_FEATURES` constant:
```typescript
const ZERO_FEATURES = new Array(164).fill(0);
```

And `MediaPipeState.normalizedFeatures` and `FEATURE_DIM_EXTENDED = 164`.

---

## Part 2 — Dual-Hand Independent Inference Pipelines

### `src/ml/inferenceModel.ts` — two independent pipelines

Create **two separate sets** of module-level state (buffers, FSM, counters), one per hand:

```typescript
// ── Right-hand pipeline ───────────────────────────────────────────────────
const rightCoordsBuffer: Float32Array[] = [];
const rightFeatureBuffer: Float32Array[] = [];
let rightPrevCoords: Float32Array | null = null;
let rightFramesSinceInfer = 0;
let rightInferenceInFlight = false;
let rightLastPrediction: SequencePrediction | null = null;
const rightFSM = new SegmentationFSM(DEFAULT_SEGMENTATION_CONFIG);

// ── Left-hand pipeline ────────────────────────────────────────────────────
const leftCoordsBuffer: Float32Array[] = [];
const leftFeatureBuffer: Float32Array[] = [];
let leftPrevCoords: Float32Array | null = null;
let leftFramesSinceInfer = 0;
let leftInferenceInFlight = false;
let leftLastPrediction: SequencePrediction | null = null;
const leftFSM = new SegmentationFSM(DEFAULT_SEGMENTATION_CONFIG);

// Reusable input buffers (one per hand, no cross-contamination)
const rightSeqBuffer = new Float32Array(SEQ_LEN * FRAME_FEATURE_DIM);
const leftSeqBuffer  = new Float32Array(SEQ_LEN * FRAME_FEATURE_DIM);
```

Expose two predict functions:

```typescript
/**
 * Predict from the right-hand pipeline.
 * @param landmarks 164-dim extended features; only the first 63 (right hand shape) are used.
 */
export async function predictRight(
  landmarks: number[],
  handPresent: boolean,
  isHeld: boolean,
): Promise<SequencePrediction | null> {
  // Extract right hand coords: features[0:63]
  return _predictPipeline(
    landmarks.slice(0, FRAME_COORD_DIM),
    handPresent, isHeld,
    rightCoordsBuffer, rightFeatureBuffer,
    rightSeqBuffer,
    rightFSM,
    { prevCoords: rightPrevCoordsRef, framesSinceInfer: rightFramesSinceInferRef,
      inferenceInFlight: rightInferenceInFlightRef, lastPrediction: rightLastPredictionRef },
  );
}

/**
 * Predict from the left-hand pipeline.
 * @param landmarks 164-dim extended features; only coords [63:126] (left hand shape) are used.
 */
export async function predictLeft(
  landmarks: number[],
  handPresent: boolean,
  isHeld: boolean,
): Promise<SequencePrediction | null> {
  // Extract left hand coords: features[63:126]
  return _predictPipeline(
    landmarks.slice(FRAME_COORD_DIM, FRAME_COORD_DIM * 2),
    handPresent, isHeld,
    leftCoordsBuffer, leftFeatureBuffer,
    leftSeqBuffer,
    leftFSM,
    { prevCoords: leftPrevCoordsRef, framesSinceInfer: leftFramesSinceInferRef,
      inferenceInFlight: leftInferenceInFlightRef, lastPrediction: leftLastPredictionRef },
  );
}

/**
 * Shared pipeline logic. Rename the existing `predict()` internals to this,
 * parameterised over which buffer/FSM set to use.
 */
async function _predictPipeline(
  coords63: number[],
  handPresent: boolean,
  isHeld: boolean,
  coordsBuffer: Float32Array[],
  featureBuffer: Float32Array[],
  seqBuf: Float32Array,
  fsm: SegmentationFSM,
  refs: PipelineRefs,
): Promise<SequencePrediction | null> { /* ... existing predict() logic ... */ }
```

> **Implementation note:** The cleanest way to refactor this is to extract the body of the current `predict()` into `_predictPipeline()`, then have `predictRight` call it with `right*` state and `predictLeft` call it with `left*` state. The `PipelineRefs` object holds `useRef`-style objects (plain `{ current: ... }`) pointing to the mutable scalars.

Also export:
```typescript
export function resetPredictionState() {
  // Reset BOTH pipelines
  resetPipeline(rightCoordsBuffer, rightFeatureBuffer, rightFSM, ...);
  resetPipeline(leftCoordsBuffer,  leftFeatureBuffer,  leftFSM,  ...);
}
```

### `src/pages/RecognizePage.tsx` — dual pending words

#### State additions

```typescript
interface PredictionState {
  // ... existing fields ...

  // Right hand pending word (from ONNX rightFSM)
  pendingWordRight: string | null;
  pendingConfidenceRight: number;

  // Left hand pending word (from ONNX leftFSM)
  pendingWordLeft: string | null;
  pendingConfidenceLeft: number;
}
```

Add reducer actions:
```typescript
| { type: 'UPDATE_RIGHT'; result: SequencePrediction }
| { type: 'UPDATE_LEFT';  result: SequencePrediction }
| { type: 'CONFIRM_RIGHT' }
| { type: 'CONFIRM_LEFT'  }
| { type: 'DISCARD_RIGHT' }
| { type: 'DISCARD_LEFT'  }
```

#### `onLandmarks` callback — two async calls

```typescript
// In ONNX mode, fire both pipelines in parallel:
void Promise.all([
  predictRight(features, handPresent, isHeld),
  predictLeft(features, leftHandPresent, false),
]).then(([resultRight, resultLeft]) => {
  if (resultRight) dispatch({ type: 'UPDATE_RIGHT', result: resultRight });
  if (resultLeft)  dispatch({ type: 'UPDATE_LEFT',  result: resultLeft  });
});
```

`leftHandPresent` is derived from whether `_rawLeft` is non-null in the callback:

```typescript
const onLandmarks = useCallback((
  features: number[],
  _rawRight: Landmark[] | null,
  handPresent: boolean,   // right hand present
  isHeld: boolean,
  rawLeft?: Landmark[] | null,
  _face?: Landmark[] | null,
) => {
  const leftHandPresent = rawLeft != null;
  // ... rest of callback
}, []);
```

#### UI — two confirmation rows

When `pendingWordRight` or `pendingWordLeft` is set, show separate rows:

```tsx
{/* Right hand pending */}
{pred.pendingWordRight && (
  <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/30">
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-primary/60 uppercase tracking-wide">Right →</span>
      <span className="text-xl font-bold text-primary glow-cyan-text">{pred.pendingWordRight}</span>
      <span className="text-xs font-mono text-muted-foreground">{pred.pendingConfidenceRight.toFixed(1)}%</span>
    </div>
    <div className="ml-auto flex gap-2">
      <button onClick={handleConfirmRight} className="...">✓ Add</button>
      <button onClick={handleDiscardRight} className="...">✗</button>
    </div>
  </div>
)}

{/* Left hand pending */}
{pred.pendingWordLeft && (
  <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30">
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-orange-400/60 uppercase tracking-wide">Left →</span>
      <span className="text-xl font-bold text-orange-400">{pred.pendingWordLeft}</span>
      <span className="text-xs font-mono text-muted-foreground">{pred.pendingConfidenceLeft.toFixed(1)}%</span>
    </div>
    <div className="ml-auto flex gap-2">
      <button onClick={handleConfirmLeft} className="...">✓ Add</button>
      <button onClick={handleDiscardLeft} className="...">✗</button>
    </div>
  </div>
)}
```

---

## Part 3 — Combined Hand+Face Gesture Seeds (164-dim)

### Wrist→nose offsets for face-interaction gestures

These values go into slots `[126:129]` (right wrist) and `[129:132]` (left wrist).
All values are in image space [0,1]. The nose is the reference point.

| Gesture | Right wrist offset `(dx, dy, dz)` | Proximity flag |
|---------|-----------------------------------|----------------|
| Think   | `(-0.20, -0.10, -0.08)` (right temple) | `[1, 0]` |
| Know    | `(0.05, -0.25, -0.10)` (forehead centre) | `[1, 0]` |
| Father  | `(0.08, -0.28, -0.10)` (forehead, thumb up) | `[1, 0]` |
| Mother  | `(0.06, 0.16, -0.10)` (chin, thumb at chin) | `[1, 0]` |
| Eat     | `(0.02, 0.07, -0.12)` (mouth) | `[1, 0]` |
| Drink   | `(0.03, 0.05, -0.12)` (mouth, C-hand tilt) | `[1, 0]` |
| Sleep   | `(-0.18, 0.05, -0.05)` (cheek) | `[1, 0]` |
| Hot     | `(0.02, 0.08, -0.13)` (mouth, claw hand) | `[1, 0]` |
| Beautiful | `(0.0, -0.05, -0.05)` (face centre, circling) | `[1, 0]` |
| Old     | `(0.05, 0.18, -0.08)` (chin, fist moving down) | `[1, 0]` |

For all non-face-interaction gestures, wrist offsets are `[0, 0, 0]` (or realistic offsets if needed) and proximity flags are `[0, 0]` and the face slice is all zeros.

### New gestures to add to `gestureSeeds` in `datasetUtils.ts`

Add the following new gesture entries. Each seed is **164 elements** = right(63) + left(63) + rightOffset(3) + leftOffset(3) + faceGated(30) + flags(2).

**WATER** — W-handshape (index, middle, ring extended, others curled), dominant hand:
- right hand: W-shape (index, middle, ring open; thumb+pinky curled)
- left: zeros, wristOffset: [0,0,0], face: zeros, flags: [0,0]

**BATHROOM** — B-hand shakes side to side, B-handshape:
- right hand: B-shape (all 4 fingers extended together, thumb tucked)
- face: zeros, flags: [0,0]

**HAPPY** — Both open palms brush upward on chest:
- Bimanual: both open hands
- flags: [0,0] (not near face)

**ANGRY** — Claw-hand pulls away from face, face proximity triggered:
- right hand: claw shape
- wristOffset: approximately at chin/lower face [0.02, 0.12, -0.10]
- face: NEUTRAL_FACE, flags: [1, 0]

**SICK** — Middle finger to forehead (other fingers splayed):
- right hand: middle finger prominent, others slightly spread
- wristOffset: [0.05, -0.22, -0.09] (forehead), face: NEUTRAL_FACE, flags: [1, 0]

**HUNGRY** — Claw-hand circles on stomach:
- right hand: C/claw shape
- wristOffset: [0.0, 0.40, 0.0] (stomach, below nose), face: zeros, flags: [0,0]

**TIRED** — Both bent hands droop from shoulders:
- Bimanual: both bent-O/loose hands
- flags: [0,0]

**PAIN** (updated) — Both index fingers approach each other at chest:
- Bimanual: both index fingers pointing toward each other
- flags: [0,0]

**CONFUSED** — One-handed: wavy B-hand near forehead with proximity:
- right hand: loose/bent B-shape
- wristOffset: [0.0, -0.20, -0.08], face: NEUTRAL_FACE, flags: [1, 0]

**FAMILY** — F-hand circles (F = thumb and index make circle, others spread):
- right hand: F-handshape
- flags: [0,0]

### Feature dimension update

Wherever `FEATURE_DIM`, `FEATURE_DIM_EXTENDED`, or the number `156` appears in the codebase, update to `164`:

- `src/utils/landmarks.ts` → `FEATURE_DIM_EXTENDED = 164`
- `src/hooks/useMediaPipe.ts` → `ZERO_FEATURES = new Array(164).fill(0)`
- `src/ml/model.ts` → `FEATURE_DIM = 164` (and `inputShape: [164]`)
- `src/dataset/datasetUtils.ts` → `parseImportedDataset` accepts `63`, `156` (legacy), or `164` (new)
- `src/ml/inferenceModel.ts` → ONNX model is unchanged (still reads first 63 from the vector), but update any assertion that checks `landmarks.length !== FRAME_COORD_DIM` to allow `>= FRAME_COORD_DIM`

---

## Part 4 — TF.js Custom Model for Face-Interaction Gestures

The custom model now receives 164-dim input and should learn to use the proximity flags and wrist offsets to distinguish face-interaction gestures.

### `src/ml/model.ts` — architecture update

```typescript
export const FEATURE_DIM = 164;

// Larger capacity to handle richer input
tf.layers.dense({ inputShape: [164], units: 256, activation: 'relu' }),
tf.layers.dropout({ rate: 0.35 }),
tf.layers.dense({ units: 128, activation: 'relu' }),
tf.layers.dropout({ rate: 0.2 }),
tf.layers.dense({ units: 64, activation: 'relu' }),
tf.layers.dropout({ rate: 0.1 }),
tf.layers.dense({ units: numClasses, activation: 'softmax' }),
```

### Training tips for face-interaction gestures

When recording samples for Mother, Father, Think, etc.:
- Ensure the camera can see both your face and your hand simultaneously
- Hold the gesture for the full recording duration (do not drift hand away from face mid-record)
- The face proximity gate will automatically set the face slice to active (non-zero) during capture
- The wrist→nose offset will be automatically captured from the raw landmarks
- Aim for 30+ samples per face-interaction gesture from slightly different angles and distances

---

## Summary of Files to Modify

| File | Changes |
|------|---------|
| `src/utils/landmarks.ts` | Add `isHandNearFace()`, `wristToNoseOffset()`, update `buildExtendedFeatures()` to 164-dim, `FEATURE_DIM_EXTENDED = 164` |
| `src/hooks/useMediaPipe.ts` | Compute proximity gate, wrist offsets, pass to `buildExtendedFeatures()` |
| `src/ml/inferenceModel.ts` | Refactor `predict()` into `_predictPipeline()`, expose `predictRight()` + `predictLeft()` with independent buffers and FSM instances |
| `src/ml/model.ts` | `FEATURE_DIM = 164`, add hidden layer, update `saveModel`/`loadModel` version check |
| `src/pages/RecognizePage.tsx` | Dual pending words, dual confirm/discard buttons, call `predictRight` + `predictLeft` in parallel |
| `src/dataset/datasetUtils.ts` | Seeds upgraded to 164-dim with wrist offsets and proximity flags, `parseImportedDataset` accepts 63/156/164, new gestures added |
| `src/contexts/AppContext.tsx` | Expand `DEFAULT_GESTURES` with new gestures (Water, Bathroom, Happy, Angry, Sick, Hungry, Tired, Confused, Family) |

---

## Validation Checklist

After implementing:

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run` — all 8 FSM tests pass (add new tests for `predictLeft`/`predictRight` independence)
- [ ] In the browser: open Dataset page, show only right hand → only right detection badge lights up
- [ ] Show only left hand → only left detection badge lights up (orange)
- [ ] Show face with hand far away → purple "Face" badge appears but face slice in features = zeros (verified via debug log)
- [ ] Touch index finger to forehead → face slice becomes non-zero (proximity gate fires)
- [ ] Show both hands doing different static gestures simultaneously → two separate recognition outputs appear (requires training custom model with both-hand samples)
- [ ] Mother gesture (thumb at chin): face badge + proximity flag [1,0] active in features
- [ ] Father gesture (thumb at forehead): face badge + proximity flag [1,0] active in features
