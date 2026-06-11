/**
 * inferenceModel.ts — ONNX runtime inference for dynamic ASL gestures.
 *
 * Supports the hackathon demo pipeline: one primary hand for ML inference,
 * with face-touch gestures handled separately in the UI layer.
 *
 * Per-hand input:  63 coordinates (xyz × 21 landmarks)
 * Per-hand feature: 126 = [63 coords, 63 temporal derivatives]
 * Sequence shape: [1, 30, 126]
 *
 */

import * as ort from 'onnxruntime-web';
import {
  DEFAULT_SEGMENTATION_CONFIG,
  SegmentationFSM,
  type SegmentationSnapshot,
} from './segmentationFSM';

export type { SegmentationState } from './segmentationFSM';
export { DEFAULT_SEGMENTATION_CONFIG };

const MODEL_URL  = '/models/asl_dynamic.onnx';
const LABELS_URL = '/models/asl_dynamic_labels.json';

const SEQ_LEN          = 30;
const FRAME_COORD_DIM  = 63;
const FRAME_FEATURE_DIM = 126;
export const SEQUENCE_FRAMES = SEQ_LEN;

const MOTION_GATE_THRESHOLD = 0.012;
const FORCE_INFER_INTERVAL  = 5;
const BLANK_LABEL = DEFAULT_SEGMENTATION_CONFIG.blankLabel;
const DEMO_LABELS = new Set(['hello', 'yes', 'no', 'please', 'help', BLANK_LABEL]);

// ── Inference quality gates ───────────────────────────────────────────────────
//
// MARGIN_GATE_THRESHOLD: minimum gap (in probability, 0–1) between the top-1
// and top-2 class probabilities before a label is accepted.  When the gap is
// smaller the prediction is ambiguous (e.g. "yes" 55% / "hello" 45%) and we
// treat it as blank to avoid false emissions.
const MARGIN_GATE_THRESHOLD = 0.12;

// Per-label minimum confidence overrides. Labels that share similar gesture
// kinematics require a higher bar to suppress cross-class false positives.
const PER_LABEL_THRESHOLDS: Record<string, number> = {
  'yes':      0.93,
  'hello':    0.88,
  'no':       0.88,
};

export interface PredictionScore {
  label: string;
  score: number; // 0-100
}

export interface SequencePrediction {
  label: string;
  confidence: number;
  liveLabel: string;
  liveConfidence: number;
  allScores: PredictionScore[];
  emittedWord: string | null;
  state: import('./segmentationFSM').SegmentationState;
  stableCount: number;
  dropCount: number;
  confirmFrames: number;
  cooldown: number;
  blankStableCount: number;
  blankStableRequired: number;
  lastCompletedWord: string | null;
  bufferSize: number;
  threshold: number;
  motionEnergy: number;
}

// ── Shared session state ─────────────────────────────────────────────────────
let session: ort.InferenceSession | null = null;
let labels: string[] = [];
let isLoading = false;
let loadError: string | null = null;
let hasBlankLabel = false;
let ortConfigured = false;

// ── Primary-hand pipeline state ──────────────────────────────────────────────
interface Pipeline {
  coordsBuffer: Float32Array[];
  featureBuffer: Float32Array[];
  prevCoords: Float32Array | null;
  framesSinceInfer: number;
  inferenceInFlight: boolean;
  lastPrediction: SequencePrediction | null;
  seqBuffer: Float32Array;
  fsm: SegmentationFSM;
}

// ── Label group classification ────────────────────────────────────────────────
//
// Face-interactive labels (AppContext Group B): the hand must approach/touch
// the face for the gesture to be meaningful.  Handedness matters for these
// (e.g. "Think" goes to the right temple), so:
//   - Mirror augmentation is EXCLUDED for these at training time.
//   - At inference time, emitting these labels should be paired with a
//     detected face interaction; otherwise the output is suppressed.
//
export const FACE_INTERACTIVE_LABELS = new Set([
  'think', 'know', 'father', 'mother', 'eat',
  'drink', 'sleep', 'hot', 'beautiful', 'old',
]);

/** True if `label` is a face-interactive gesture (Group B). */
export function isFaceInteractiveLabel(label: string): boolean {
  const canonical = label.trim().toLowerCase().replace(/[_\-]+/g, ' ');
  return FACE_INTERACTIVE_LABELS.has(canonical);
}

function createPipeline(config = DEFAULT_SEGMENTATION_CONFIG): Pipeline {
  return {
    coordsBuffer: [],
    featureBuffer: [],
    prevCoords: null,
    framesSinceInfer: 0,
    inferenceInFlight: false,
    lastPrediction: null,
    seqBuffer: new Float32Array(SEQ_LEN * FRAME_FEATURE_DIM),
    fsm: new SegmentationFSM(config),
  };
}

const rightPipeline = createPipeline();

// ── Utility functions ────────────────────────────────────────────────────────
function configureOrt() {
  if (ortConfigured) return;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';
  ortConfigured = true;
}

function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(v => Math.exp(v - maxLogit));
  const sum = exps.reduce((acc, v) => acc + v, 0);
  return exps.map(v => v / (sum || 1));
}

function argmax(values: number[]): number {
  let maxIdx = 0;
  let maxVal = values[0] ?? Number.NEGATIVE_INFINITY;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > maxVal) { maxVal = values[i]; maxIdx = i; }
  }
  return maxIdx;
}

function buildFrameFeature(coords: Float32Array, prev: Float32Array | null): Float32Array {
  const out = new Float32Array(FRAME_FEATURE_DIM);
  for (let i = 0; i < FRAME_COORD_DIM; i++) {
    const curr = coords[i];
    out[i] = curr;
    out[i + FRAME_COORD_DIM] = prev ? curr - prev[i] : 0;
  }
  return out;
}

function pushFrame(p: Pipeline, coords: Float32Array, feat: Float32Array) {
  p.coordsBuffer.push(coords);
  p.featureBuffer.push(feat);
  if (p.coordsBuffer.length > SEQ_LEN) p.coordsBuffer.shift();
  if (p.featureBuffer.length > SEQ_LEN) p.featureBuffer.shift();
}

function resetPipeline(p: Pipeline) {
  p.coordsBuffer.length = 0;
  p.featureBuffer.length = 0;
  p.prevCoords = null;
  p.framesSinceInfer = 0;
}

function computeMotionEnergy(p: Pipeline): number {
  if (p.coordsBuffer.length < 2) return 0;
  let sumAbs = 0, count = 0;
  for (let t = 1; t < p.coordsBuffer.length; t++) {
    const curr = p.coordsBuffer[t];
    const prev = p.coordsBuffer[t - 1];
    for (let i = 0; i < FRAME_COORD_DIM; i++) {
      sumAbs += Math.abs(curr[i] - prev[i]);
      count++;
    }
  }
  return count > 0 ? sumAbs / count : 0;
}

// ── Prediction builders ──────────────────────────────────────────────────────
function buildStatusPrediction(
  p: Pipeline,
  snapshot: SegmentationSnapshot,
  label: string,
  confidence: number,
  liveLabel: string,
  liveConfidence: number,
  allScores: PredictionScore[],
  emittedWord: string | null,
  motionEnergy: number,
): SequencePrediction {
  return {
    label, confidence, liveLabel, liveConfidence, allScores, emittedWord,
    state: snapshot.state,
    stableCount: snapshot.stableCount,
    dropCount: snapshot.dropCount,
    confirmFrames: snapshot.confirmFrames,
    cooldown: snapshot.cooldown,
    blankStableCount: snapshot.blankStableCount,
    blankStableRequired: snapshot.blankStableRequired,
    lastCompletedWord: snapshot.lastCompletedWord,
    bufferSize: p.featureBuffer.length,
    threshold: snapshot.threshold,
    motionEnergy,
  };
}

function idleBlankPrediction(p: Pipeline, motionEnergy: number): SequencePrediction {
  return buildStatusPrediction(p, p.fsm.getSnapshot(), BLANK_LABEL, 0, BLANK_LABEL, 0, [], null, motionEnergy);
}

function reuseLastPrediction(p: Pipeline, motionEnergy: number): SequencePrediction {
  if (!p.lastPrediction) return idleBlankPrediction(p, motionEnergy);
  return { ...p.lastPrediction, emittedWord: null, bufferSize: p.featureBuffer.length, motionEnergy };
}

// ── ONNX session ─────────────────────────────────────────────────────────────
async function loadLabels(): Promise<string[]> {
  const res = await fetch(LABELS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load label file (${res.status})`);
  const payload = await res.json() as { labels?: unknown };
  if (!payload || !Array.isArray(payload.labels) || payload.labels.length === 0) {
    throw new Error('Invalid label file format');
  }
  return payload.labels.map(v => String(v));
}

async function createSession(): Promise<ort.InferenceSession> {
  configureOrt();
  return ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
}

function validateSessionSignature(loadedSession: ort.InferenceSession, loadedLabels: string[]) {
  if (loadedSession.inputNames.length === 0 || loadedSession.outputNames.length === 0) {
    throw new Error('ONNX session is missing input/output names');
  }
  const inputMeta = loadedSession.inputMetadata[0];
  if (!inputMeta?.isTensor) throw new Error('ONNX input must be a tensor');
  const inputShape = inputMeta.shape;
  if (inputShape.length !== 3) throw new Error(`Expected ONNX input rank 3, received ${inputShape.length}`);
  if (typeof inputShape[1] === 'number' && inputShape[1] !== SEQ_LEN) {
    throw new Error(`Expected ONNX sequence length ${SEQ_LEN}, received ${inputShape[1]}`);
  }
  if (typeof inputShape[2] === 'number' && inputShape[2] !== FRAME_FEATURE_DIM) {
    throw new Error(`Expected ONNX feature dim ${FRAME_FEATURE_DIM}, received ${inputShape[2]}`);
  }
  const outputMeta = loadedSession.outputMetadata[0];
  if (outputMeta?.isTensor) {
    const outputShape = outputMeta.shape;
    const classDim = outputShape[outputShape.length - 1];
    if (typeof classDim === 'number' && classDim !== loadedLabels.length) {
      throw new Error(`Expected ONNX output classes ${loadedLabels.length}, received ${classDim}`);
    }
  }
}

export async function loadModel(): Promise<boolean> {
  if (session) return true;
  if (isLoading) return false;
  if (loadError) loadError = null;

  isLoading = true;
  try {
    const [loadedLabels, loadedSession] = await Promise.all([loadLabels(), createSession()]);
    validateSessionSignature(loadedSession, loadedLabels);
    labels = loadedLabels;
    session = loadedSession;
    hasBlankLabel = loadedLabels.includes(BLANK_LABEL);
    loadError = null;
    return true;
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load ONNX model';
    session = null;
    labels = [];
    hasBlankLabel = false;
    return false;
  } finally {
    isLoading = false;
  }
}

export function isModelReady(): boolean { return session !== null && labels.length > 0; }
export function getLoadingState() { return { isLoading, loadError }; }
export function getLabels() { return [...labels]; }

// ── Core inference call ──────────────────────────────────────────────────────
async function runSequenceInference(inputData: Float32Array): Promise<{
  label: string; confidenceProb: number; allScores: PredictionScore[];
} | null> {
  if (!session || labels.length === 0) return null;
  const inputName  = session.inputNames[0];
  const outputName = session.outputNames[0];
  const inputTensor = new ort.Tensor('float32', inputData, [1, SEQ_LEN, FRAME_FEATURE_DIM]);
  const outputs = await session.run({ [inputName]: inputTensor });
  const outputTensor = outputs[outputName];
  if (!outputTensor) return null;
  const logits = Array.from(outputTensor.data as Float32Array);
  (outputTensor as ort.Tensor & { dispose?: () => void }).dispose?.();
  if (logits.length !== labels.length) {
    throw new Error(`Model output size (${logits.length}) does not match label count (${labels.length})`);
  }
  const probs = softmax(logits);
  const topIdx = argmax(probs);
  const allScores = labels.map((label, idx) => ({
    label,
    score: Math.round(probs[idx] * 1000) / 10,
  })).filter(s => DEMO_LABELS.has(s.label)).sort((a, b) => b.score - a.score);
  return { label: labels[topIdx], confidenceProb: probs[topIdx], allScores };
}

// ── Shared per-pipeline predict logic ────────────────────────────────────────
async function predictWithPipeline(
  coords63: number[],    // 63 values for one hand
  handPresent: boolean,
  isHeld: boolean,
  p: Pipeline,
): Promise<SequencePrediction | null> {
  if (!session || labels.length === 0) return null;

  const coords = new Float32Array(FRAME_COORD_DIM);
  for (let i = 0; i < FRAME_COORD_DIM; i++) {
    coords[i] = Number.isFinite(coords63[i]) ? coords63[i] : 0;
  }

  const feat = buildFrameFeature(coords, p.prevCoords);
  p.prevCoords = coords;
  pushFrame(p, coords, feat);

  const motionEnergy = computeMotionEnergy(p);
  const lowMotion = motionEnergy < MOTION_GATE_THRESHOLD;
  const trackingBlankLike = !handPresent && !isHeld;

  // Let the FSM handle cooldown frames
  if (p.fsm.isCoolingDown()) {
    const cooldownStep = p.fsm.step({
      predictedLabel: BLANK_LABEL,
      confidenceProb: 0,
      isBlankLike: trackingBlankLike,
      isLowMotion: lowMotion,
    });
    const result = buildStatusPrediction(p, cooldownStep.snapshot, BLANK_LABEL, 0, BLANK_LABEL, 0, [], cooldownStep.emittedWord, motionEnergy);
    p.lastPrediction = result;
    return result;
  }

  // Buffer not full yet
  if (p.featureBuffer.length < SEQ_LEN) {
    const result = idleBlankPrediction(p, motionEnergy);
    p.lastPrediction = result;
    return result;
  }

  // Another inference already in-flight for this hand.
  if (p.inferenceInFlight) return reuseLastPrediction(p, motionEnergy);

  p.framesSinceInfer++;
  const shouldRunModel = !lowMotion || p.framesSinceInfer >= FORCE_INFER_INTERVAL;
  if (!shouldRunModel) {
    const result = reuseLastPrediction(p, motionEnergy);
    p.lastPrediction = result;
    return result;
  }

  p.inferenceInFlight = true;
  try {
    // Pack feature buffer into the reusable sequence tensor
    for (let t = 0; t < SEQ_LEN; t++) {
      p.seqBuffer.set(p.featureBuffer[t], t * FRAME_FEATURE_DIM);
    }
    const raw = await runSequenceInference(p.seqBuffer);
    if (!raw) return null;

    p.framesSinceInfer = 0;
    const { label, confidenceProb, allScores } = raw;
    const isDemoLabel = DEMO_LABELS.has(label);

    // Ambiguity gate: reject predictions where the top-1 vs top-2 margin is
    // below threshold, or where confidence is under the per-label minimum.
    // Gated frames are treated as blank by the FSM — the raw label and scores
    // are still forwarded to the display layer for debugging.
    const secondProb = allScores.length > 1 ? allScores[1].score / 100 : 0;
    const margin = confidenceProb - secondProb;
    const perLabelMin = PER_LABEL_THRESHOLDS[label] ?? 0;
    const gated = !isDemoLabel || (label !== BLANK_LABEL && (margin < MARGIN_GATE_THRESHOLD || confidenceProb < perLabelMin));
    const effectiveLabel = gated ? BLANK_LABEL : label;
    const effectiveConf  = gated ? 0 : confidenceProb;

    const segStep = p.fsm.step({
      predictedLabel: effectiveLabel,
      confidenceProb: effectiveConf,
      isBlankLike: trackingBlankLike || (hasBlankLabel && effectiveLabel === BLANK_LABEL),
      isLowMotion: lowMotion,
    });

    if (segStep.emittedWord) resetPipeline(p);

    const liveLabel = isDemoLabel ? label : BLANK_LABEL;
    const liveConf = isDemoLabel ? Math.round(confidenceProb * 1000) / 10 : 0;
    const isCooldown = segStep.snapshot.state === 'COOLDOWN';
    const result = buildStatusPrediction(
      p, segStep.snapshot,
      isCooldown ? BLANK_LABEL : effectiveLabel,
      isCooldown ? 0 : liveConf,
      liveLabel, liveConf, allScores,
      segStep.emittedWord, motionEnergy,
    );
    p.lastPrediction = result;
    return result;
  } catch (err) {
    console.error('ONNX prediction error:', err);
    return null;
  } finally {
    p.inferenceInFlight = false;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Predict gesture for the RIGHT hand.
 * Reads coordinates from landmarks[0:63].
 * @param landmarks Extended feature vector (≥63 dims) or legacy 63-dim.
 */
export async function predict(
  landmarks: number[],
  handPresent: boolean,
  isHeld: boolean,
): Promise<SequencePrediction | null> {
  if (landmarks.length < FRAME_COORD_DIM) return null;
  return predictWithPipeline(landmarks.slice(0, FRAME_COORD_DIM), handPresent, isHeld, rightPipeline);
}

export function resetPredictionState() {
  resetPipeline(rightPipeline);
  rightPipeline.fsm.reset();
  rightPipeline.inferenceInFlight = false;
  rightPipeline.lastPrediction = null;
}
