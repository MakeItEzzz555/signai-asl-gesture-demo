/**
 * landmarks.ts — Hand + Face Landmark Normalization & Feature Engineering
 *
 * MediaPipe Hands provides 21 3D landmarks per hand (up to 2 hands).
 * MediaPipe FaceMesh provides 468 3D landmarks for the face.
 *
 * Feature vector layout (156 dimensions total):
 *   [0:63]   = right hand  — 21 landmarks × 3 (xyz), wrist-relative normalized
 *   [63:126] = left hand   — 21 landmarks × 3 (xyz), wrist-relative normalized (zeros if absent)
 *   [126:156]= face        — 10 key landmarks × 3 (xyz), nose-relative normalized (zeros if absent)
 *
 * Hand normalization pipeline:
 * 1. Translation: subtract wrist (landmark 0)
 * 2. Scale: divide by max absolute value → [-1, 1]
 * 3. Flatten to 63-element float vector
 *
 * Face normalization pipeline:
 * 1. Select 10 anatomically meaningful landmarks from the 468-point mesh
 * 2. Translation: subtract nose tip (first key landmark)
 * 3. Scale: divide by max absolute value → [-1, 1]
 * 4. Flatten to 30-element float vector
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

// ── Feature dimension constants ─────────────────────────────────────────────
export const FEATURE_DIM_HAND = 63;       // 21 landmarks × 3
export const FEATURE_DIM_FACE = 30;       // 10 key landmarks × 3
export const FEATURE_DIM_EXTENDED = 156;  // right hand + left hand + face

/**
 * 10 key face mesh landmark indices from MediaPipe's 468-point model.
 *
 * Selected to cover:
 *  0 → nose tip      (1)   — reference/origin after translation
 *  1 → forehead      (10)  — THINK, KNOW, FATHER gestures
 *  2 → left temple   (127) — THINK gesture (pointing to temple)
 *  3 → right temple  (356) — THINK gesture (other side)
 *  4 → left eye      (33)  — eye-region gestures
 *  5 → right eye     (263) — eye-region gestures
 *  6 → left mouth    (61)  — EAT, DRINK, HOT gestures
 *  7 → right mouth   (291) — EAT, DRINK, HOT gestures
 *  8 → chin          (152) — MOTHER, OLD gestures
 *  9 → nose bridge   (168) — additional nose reference
 */
export const FACE_KEY_INDICES = [1, 10, 127, 356, 33, 263, 61, 291, 152, 168] as const;

/**
 * Normalize 21 MediaPipe hand landmarks into a 63-element feature vector.
 * @param landmarks Array of 21 {x, y, z} landmark objects
 * @returns 63-element normalized array, or null if input is invalid
 */
export function normalizeLandmarks(landmarks: Landmark[]): number[] | null {
  if (!landmarks || landmarks.length !== 21) return null;

  // Step 1: Translation — center on wrist (landmark 0)
  const wrist = landmarks[0];
  const translated = landmarks.map(lm => ({
    x: lm.x - wrist.x,
    y: lm.y - wrist.y,
    z: lm.z - wrist.z,
  }));

  // Step 2: Scale — divide by max absolute value
  let maxAbs = 0;
  for (const lm of translated) {
    maxAbs = Math.max(maxAbs, Math.abs(lm.x), Math.abs(lm.y), Math.abs(lm.z));
  }
  if (maxAbs === 0) return null;

  // Step 3: Flatten
  const flat: number[] = [];
  for (const lm of translated) {
    flat.push(lm.x / maxAbs, lm.y / maxAbs, lm.z / maxAbs);
  }
  return flat;
}

/**
 * Normalize 10 key face landmarks from the full 468-point Face Mesh into
 * a 30-element feature vector.
 *
 * @param allLandmarks Full 468-landmark array from MediaPipe FaceMesh
 * @param keyIndices   Indices to extract (defaults to FACE_KEY_INDICES)
 * @returns 30-element normalized array, or null if landmarks are invalid
 */
export function normalizeFaceLandmarks(
  allLandmarks: Landmark[],
  keyIndices: readonly number[] = FACE_KEY_INDICES,
): number[] | null {
  if (!allLandmarks || allLandmarks.length < 468) return null;

  const keyLandmarks = keyIndices.map(i => allLandmarks[i]);

  // Step 1: Translate relative to nose tip (first key landmark = index 1)
  const nose = keyLandmarks[0];
  const translated = keyLandmarks.map(lm => ({
    x: lm.x - nose.x,
    y: lm.y - nose.y,
    z: lm.z - nose.z,
  }));

  // Step 2: Scale
  let maxAbs = 0;
  for (const lm of translated) {
    maxAbs = Math.max(maxAbs, Math.abs(lm.x), Math.abs(lm.y), Math.abs(lm.z));
  }
  if (maxAbs === 0) return null;

  // Step 3: Flatten to 30 values
  const flat: number[] = [];
  for (const lm of translated) {
    flat.push(lm.x / maxAbs, lm.y / maxAbs, lm.z / maxAbs);
  }
  return flat;
}

/**
 * Build the extended 156-dim feature vector from right hand, left hand, and face.
 *
 * Layout:
 *   [0:63]    right hand (zeros if absent)
 *   [63:126]  left hand  (zeros if absent)
 *   [126:156] face       (zeros if absent)
 */
export function buildExtendedFeatures(
  rightHandFeatures: number[] | null,
  leftHandFeatures: number[] | null,
  faceFeatures: number[] | null,
): number[] {
  const right = rightHandFeatures ?? new Array(FEATURE_DIM_HAND).fill(0);
  const left  = leftHandFeatures  ?? new Array(FEATURE_DIM_HAND).fill(0);
  const face  = faceFeatures      ?? new Array(FEATURE_DIM_FACE).fill(0);
  return [...right, ...left, ...face];
}

// ── Drawing utilities ────────────────────────────────────────────────────────

/**
 * MediaPipe hand landmark connection pairs for skeleton overlay.
 */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [9, 10], [10, 11], [11, 12],           // Middle
  [13, 14], [14, 15], [15, 16],          // Ring
  [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
  [5, 9], [9, 13], [13, 17],             // Palm
];

/**
 * Draw a single hand's landmark skeleton on the canvas.
 * @param ctx   2D rendering context
 * @param landmarks  21 landmarks (image-space 0–1)
 * @param width  Canvas width in pixels
 * @param height Canvas height in pixels
 * @param color  Stroke/fill color
 */
export function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  color = '#00E5FF',
): void {
  if (!landmarks || landmarks.length !== 21) return;

  // Connections
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.8;
  for (const [a, b] of HAND_CONNECTIONS) {
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    ctx.beginPath();
    ctx.moveTo(lmA.x * width, lmA.y * height);
    ctx.lineTo(lmB.x * width, lmB.y * height);
    ctx.stroke();
  }

  // Dots
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    const px = lm.x * width;
    const py = lm.y * height;

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = i === 0 ? '#FF6B6B' : color;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

/**
 * Draw both hands and key face landmarks on the canvas.
 * Clears the canvas first.
 *
 * @param ctx       2D rendering context
 * @param right     Right-hand landmarks (or null)
 * @param left      Left-hand landmarks (or null)
 * @param faceFull  Full 468-point face landmarks (or null)
 * @param width     Canvas width in pixels
 * @param height    Canvas height in pixels
 */
export function drawMultiLandmarks(
  ctx: CanvasRenderingContext2D,
  right: Landmark[] | null,
  left: Landmark[] | null,
  faceFull: Landmark[] | null,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  if (right) drawLandmarks(ctx, right, width, height, '#00E5FF');   // cyan — right hand
  if (left)  drawLandmarks(ctx, left,  width, height, '#FF6B6B');   // red  — left hand

  if (faceFull && faceFull.length >= 468) {
    const keyPoints = FACE_KEY_INDICES.map(i => faceFull[i]);
    ctx.fillStyle = '#A78BFA'; // purple — face
    ctx.globalAlpha = 0.85;
    for (const pt of keyPoints) {
      ctx.beginPath();
      ctx.arc(pt.x * width, pt.y * height, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
