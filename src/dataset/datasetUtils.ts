import type { GestureSample, Dataset } from '../contexts/AppContext';
import {
  LANGUAGES,
  normalizeGestureLabel,
  type CustomTranslations,
  type LanguageCode,
} from '../i18n/translations';
import { FEATURE_DIM_HAND, FEATURE_DIM_EXTENDED, toHandOnlyFeatures } from '../utils/landmarks';

export function oneHotEncode(labels: string[], labelNames: string[]): number[][] {
  return labels.map(label => {
    const vec = new Array(labelNames.length).fill(0);
    const idx = labelNames.indexOf(label);
    if (idx >= 0) vec[idx] = 1;
    return vec;
  });
}

export const FACE_INTERACTIVE_GESTURES = new Set([
  'think', 'know', 'father', 'mother', 'eat',
  'drink', 'sleep', 'hot', 'beautiful', 'old',
  'eat / speak', 'see / look', 'smell', 'listen',
]);

function canonicalLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[_-]+/g, ' ');
}

export function isFaceInteractiveGesture(label: string): boolean {
  return FACE_INTERACTIVE_GESTURES.has(canonicalLabel(label));
}

function mirrorHand63(hand63: number[]): number[] {
  const out = [...hand63];
  for (let i = 0; i < out.length; i += 3) {
    out[i] = -out[i]; // x-axis
  }
  return out;
}

function mirrorFeatures(features: number[]): number[] {
  return mirrorHand63(toHandOnlyFeatures(features));
}

export function splitDataset(
  samples: GestureSample[],
  validationSplit: number
): { train: GestureSample[]; val: GestureSample[] } {
  const shuffled = [...samples].sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(shuffled.length * (1 - validationSplit));
  return {
    train: shuffled.slice(0, splitIdx),
    val: shuffled.slice(splitIdx),
  };
}

export function prepareTensors(
  samples: GestureSample[],
  labelNames: string[]
): {
  features: number[][];
  labels: number[][];
  labelIndices: number[];
} {
  const features: number[][] = [];
  const labelStrings: string[] = [];

  for (const s of samples) {
    if (isFaceInteractiveGesture(s.label)) continue;

    const handOnly = toHandOnlyFeatures(s.landmarks);
    features.push(handOnly);
    labelStrings.push(s.label);

    features.push(mirrorFeatures(handOnly));
    labelStrings.push(s.label);
  }

  const labels = oneHotEncode(labelStrings, labelNames);
  const labelIndices = labelStrings.map(l => labelNames.indexOf(l));
  return { features, labels, labelIndices };
}

export interface DatasetExportBundle {
  version: 2;
  samples: GestureSample[];
  customTranslations?: CustomTranslations;
}

export interface ParsedDatasetImport {
  samples: GestureSample[];
  customTranslations: CustomTranslations;
  convertedToHandOnlyCount: number;
}

function hasCustomTranslations(customTranslations?: CustomTranslations): boolean {
  return Boolean(customTranslations && Object.keys(customTranslations).length > 0);
}

export function exportDatasetJSON(
  samples: GestureSample[],
  customTranslations?: CustomTranslations
): string {
  const handOnlySamples = samples.map(sample => ({
    ...sample,
    landmarks: toHandOnlyFeatures(sample.landmarks),
  }));

  if (!hasCustomTranslations(customTranslations)) {
    return JSON.stringify(handOnlySamples, null, 2);
  }

  const bundle: DatasetExportBundle = {
    version: 2,
    samples: handOnlySamples,
    customTranslations,
  };
  return JSON.stringify(bundle, null, 2);
}

export function downloadDataset(
  samples: GestureSample[],
  filename = 'sign-language-dataset.json',
  customTranslations?: CustomTranslations
): void {
  const json = exportDatasetJSON(samples, customTranslations);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseSampleArray(data: unknown): { samples: GestureSample[]; convertedToHandOnlyCount: number } {
  if (!Array.isArray(data)) throw new Error('Dataset samples must be a JSON array');

  let convertedToHandOnlyCount = 0;
  const samples = data.map((item: unknown, i: number) => {
    const obj = item as Record<string, unknown>;
    if (typeof obj.label !== 'string') throw new Error(`Sample ${i}: missing "label" string`);
    if (!Array.isArray(obj.landmarks)) throw new Error(`Sample ${i}: missing "landmarks" array`);
    if (obj.landmarks.length !== FEATURE_DIM_HAND && obj.landmarks.length !== FEATURE_DIM_EXTENDED) {
      throw new Error(`Sample ${i}: landmarks must have ${FEATURE_DIM_HAND} (hand-only) or ${FEATURE_DIM_EXTENDED} (legacy extended) values, got ${obj.landmarks.length}`);
    }
    if (obj.landmarks.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new Error(`Sample ${i}: landmarks contain non-finite values (NaN or Infinity)`);
    }
    if (obj.landmarks.length === FEATURE_DIM_EXTENDED) {
      convertedToHandOnlyCount += 1;
    }
    return {
      label: obj.label as string,
      landmarks: toHandOnlyFeatures(obj.landmarks as number[]),
      timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : Date.now(),
    };
  });

  return { samples, convertedToHandOnlyCount };
}

function parseCustomTranslations(data: unknown): CustomTranslations {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};

  const validLanguages = new Set<LanguageCode>(LANGUAGES.map(l => l.code));
  const translations: CustomTranslations = {};

  for (const [label, entries] of Object.entries(data as Record<string, unknown>)) {
    const labelKey = normalizeGestureLabel(label);
    if (!labelKey || !entries || typeof entries !== 'object' || Array.isArray(entries)) continue;

    for (const [lang, value] of Object.entries(entries as Record<string, unknown>)) {
      if (!validLanguages.has(lang as LanguageCode) || typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      translations[labelKey] = {
        ...translations[labelKey],
        [lang]: trimmed,
      };
    }
  }

  return translations;
}

export function parseImportedDatasetBundle(json: string): ParsedDatasetImport {
  const data = JSON.parse(json);
  if (Array.isArray(data)) {
    const parsed = parseSampleArray(data);
    return {
      samples: parsed.samples,
      customTranslations: {},
      convertedToHandOnlyCount: parsed.convertedToHandOnlyCount,
    };
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Dataset must be a JSON array or object');
  }

  const obj = data as Record<string, unknown>;
  const parsed = parseSampleArray(obj.samples);
  return {
    samples: parsed.samples,
    customTranslations: parseCustomTranslations(obj.customTranslations),
    convertedToHandOnlyCount: parsed.convertedToHandOnlyCount,
  };
}

export function parseImportedDataset(json: string): GestureSample[] {
  return parseImportedDatasetBundle(json).samples;
}

export function getSampleCounts(dataset: Dataset): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of dataset.labels) counts[label] = 0;
  for (const sample of dataset.samples) counts[sample.label] = (counts[sample.label] || 0) + 1;
  return counts;
}

// Standard neutral face: 10 key points relative to nose tip, 30 values total.
// Order: nose_tip, forehead, left_temple, right_temple, left_eye, right_eye,
//        left_mouth, right_mouth, chin, nose_bridge
const NEUTRAL_FACE: number[] = [
  0, 0, 0,        // nose_tip
  0, -0.8, 0,     // forehead
  -0.7, -0.4, 0,  // left_temple
  0.7, -0.4, 0,   // right_temple
  -0.35, -0.3, 0, // left_eye
  0.35, -0.3, 0,  // right_eye
  -0.25, 0.25, 0, // left_mouth
  0.25, 0.25, 0,  // right_mouth
  0, 0.6, 0,      // chin
  0, -0.2, 0,     // nose_bridge
];

// 63 zeros for absent hand
const ZERO_HAND: number[] = new Array(63).fill(0);

// Gesture seeds: 156-dim [right_hand(63) | left_hand(63) | face(30)]
// Right hand: 21 landmarks × [x,y,z], wrist at origin, normalized to [-1,1]
// Left hand: same layout, zeros if absent
// Face: 10 key points × [x,y,z], nose-relative
const gestureSeeds: Record<string, number[]> = {
  // --- Group A: Single-hand, left=zeros, face=neutral ---

  // Hello: open palm, fingers spread upward, slight lateral spread
  'Hello': [
    // right hand — open palm, 5 fingers spread wide
    0, 0, 0,          // wrist
    0.1, 0.35, 0.05,  // thumb CMC
    0.2, 0.55, 0.05,  // thumb MCP
    0.3, 0.72, 0.05,  // thumb IP
    0.38, 0.88, 0.05, // thumb tip
    0.1, 0.45, 0.02,  // index MCP
    0.12, 0.68, 0.02, // index PIP
    0.12, 0.85, 0.02, // index DIP
    0.12, 1.0, 0.02,  // index tip
    0.02, 0.45, 0,    // middle MCP
    0.02, 0.7, 0,     // middle PIP
    0.02, 0.88, 0,    // middle DIP
    0.02, 1.0, 0,     // middle tip
    -0.08, 0.43, 0,   // ring MCP
    -0.08, 0.66, 0,   // ring PIP
    -0.08, 0.83, 0,   // ring DIP
    -0.08, 0.96, 0,   // ring tip
    -0.18, 0.38, 0,   // pinky MCP
    -0.18, 0.58, 0,   // pinky PIP
    -0.18, 0.72, 0,   // pinky DIP
    -0.18, 0.85, 0,   // pinky tip
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Yes: closed fist, thumb visible on side
  'Yes': [
    0, 0, 0,
    0.22, 0.18, 0.1,
    0.35, 0.32, 0.12,
    0.4, 0.48, 0.12,
    0.44, 0.62, 0.1,  // thumb tip extended
    0.12, 0.3, 0.05,
    0.14, 0.42, -0.05, // index curled
    0.14, 0.35, -0.12,
    0.12, 0.28, -0.15, // index tip curled back
    0.02, 0.3, 0.05,
    0.02, 0.42, -0.05,
    0.02, 0.35, -0.12,
    0.02, 0.28, -0.15,
    -0.08, 0.28, 0.05,
    -0.08, 0.4, -0.05,
    -0.08, 0.33, -0.12,
    -0.08, 0.26, -0.15,
    -0.17, 0.24, 0.05,
    -0.17, 0.35, -0.04,
    -0.17, 0.29, -0.1,
    -0.17, 0.22, -0.13,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // No: index + middle extended, others curled, wagging side to side
  'No': [
    0, 0, 0,
    0.22, 0.18, 0.1,
    0.3, 0.3, 0.1,
    0.32, 0.42, 0.06,
    0.3, 0.52, 0.02,  // thumb tip slightly visible
    0.12, 0.35, 0.02,
    0.15, 0.58, 0.02, // index PIP
    0.15, 0.78, 0.02, // index DIP
    0.15, 0.95, 0.02, // index tip extended
    0.02, 0.35, 0.02,
    0.04, 0.58, 0.02, // middle PIP
    0.04, 0.78, 0.02, // middle DIP
    0.04, 0.95, 0.02, // middle tip extended
    -0.08, 0.3, 0.02,
    -0.08, 0.4, -0.06, // ring curled
    -0.08, 0.33, -0.12,
    -0.08, 0.26, -0.14,
    -0.17, 0.25, 0.02,
    -0.17, 0.34, -0.04,
    -0.17, 0.28, -0.1,
    -0.17, 0.22, -0.13,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Good: thumb up, fist closed
  'Good': [
    0, 0, 0,
    0.2, 0.15, 0.08,
    0.28, 0.35, 0.1,
    0.3, 0.55, 0.1,
    0.28, 0.75, 0.08, // thumb tip pointing up
    0.12, 0.28, 0.04,
    0.14, 0.38, -0.06,
    0.14, 0.31, -0.13,
    0.12, 0.24, -0.16,
    0.02, 0.28, 0.04,
    0.02, 0.38, -0.06,
    0.02, 0.31, -0.13,
    0.02, 0.24, -0.16,
    -0.08, 0.26, 0.04,
    -0.08, 0.36, -0.06,
    -0.08, 0.29, -0.12,
    -0.08, 0.22, -0.15,
    -0.17, 0.22, 0.04,
    -0.17, 0.3, -0.04,
    -0.17, 0.24, -0.1,
    -0.17, 0.18, -0.13,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Bad: thumb down, fist closed
  'Bad': [
    0, 0, 0,
    0.2, 0.15, 0.08,
    0.28, -0.05, 0.1,
    0.3, -0.25, 0.1,
    0.28, -0.45, 0.08, // thumb tip pointing down
    0.12, 0.28, 0.04,
    0.14, 0.38, -0.06,
    0.14, 0.31, -0.13,
    0.12, 0.24, -0.16,
    0.02, 0.28, 0.04,
    0.02, 0.38, -0.06,
    0.02, 0.31, -0.13,
    0.02, 0.24, -0.16,
    -0.08, 0.26, 0.04,
    -0.08, 0.36, -0.06,
    -0.08, 0.29, -0.12,
    -0.08, 0.22, -0.15,
    -0.17, 0.22, 0.04,
    -0.17, 0.3, -0.04,
    -0.17, 0.24, -0.1,
    -0.17, 0.18, -0.13,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Stop: flat open palm facing out, fingers together extended up
  'Stop': [
    0, 0, 0,
    0.08, 0.32, 0.02,
    0.14, 0.52, 0.02,
    0.18, 0.68, 0.02,
    0.2, 0.82, 0.02,  // thumb tip
    0.08, 0.42, 0,
    0.08, 0.65, 0,
    0.08, 0.83, 0,
    0.08, 0.98, 0,    // index tip
    0, 0.42, 0,
    0, 0.66, 0,
    0, 0.84, 0,
    0, 1.0, 0,        // middle tip
    -0.08, 0.4, 0,
    -0.08, 0.64, 0,
    -0.08, 0.82, 0,
    -0.08, 0.97, 0,   // ring tip
    -0.16, 0.36, 0,
    -0.16, 0.56, 0,
    -0.16, 0.7, 0,
    -0.16, 0.84, 0,   // pinky tip
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Help: right fist + left flat palm (bimanual); right=fist, left=open palm
  'Help': [
    // right hand — closed fist
    0, 0, 0,
    0.2, 0.18, 0.08,
    0.3, 0.32, 0.1,
    0.32, 0.44, 0.06,
    0.3, 0.54, 0.02,
    0.12, 0.28, 0.04,
    0.14, 0.38, -0.06,
    0.14, 0.31, -0.13,
    0.12, 0.24, -0.16,
    0.02, 0.28, 0.04,
    0.02, 0.38, -0.06,
    0.02, 0.31, -0.13,
    0.02, 0.24, -0.16,
    -0.08, 0.26, 0.04,
    -0.08, 0.36, -0.06,
    -0.08, 0.29, -0.12,
    -0.08, 0.22, -0.15,
    -0.17, 0.22, 0.04,
    -0.17, 0.3, -0.04,
    -0.17, 0.24, -0.1,
    -0.17, 0.18, -0.13,
    // left hand — flat palm open, fingers extended
    0, 0, 0,
    -0.08, 0.32, 0.02,
    -0.14, 0.52, 0.02,
    -0.18, 0.68, 0.02,
    -0.2, 0.82, 0.02,
    -0.08, 0.42, 0,
    -0.08, 0.65, 0,
    -0.08, 0.83, 0,
    -0.08, 0.98, 0,
    0, 0.42, 0,
    0, 0.66, 0,
    0, 0.84, 0,
    0, 1.0, 0,
    0.08, 0.4, 0,
    0.08, 0.64, 0,
    0.08, 0.82, 0,
    0.08, 0.97, 0,
    0.16, 0.36, 0,
    0.16, 0.56, 0,
    0.16, 0.7, 0,
    0.16, 0.84, 0,
    ...NEUTRAL_FACE,
  ],

  // Please: flat hand on chest, palm inward, fingers slightly curled
  'Please': [
    0, 0, 0,
    0.1, 0.28, 0.08,
    0.18, 0.46, 0.1,
    0.2, 0.62, 0.08,
    0.2, 0.76, 0.06,
    0.08, 0.38, 0.06,
    0.08, 0.58, 0.04,
    0.08, 0.72, 0.02,
    0.08, 0.84, 0,
    0, 0.38, 0.06,
    0, 0.6, 0.04,
    0, 0.74, 0.02,
    0, 0.86, 0,
    -0.08, 0.36, 0.06,
    -0.08, 0.56, 0.04,
    -0.08, 0.7, 0.02,
    -0.08, 0.82, 0,
    -0.16, 0.3, 0.06,
    -0.16, 0.48, 0.04,
    -0.16, 0.6, 0.02,
    -0.16, 0.72, 0,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Thank You: flat hand at chin then moves forward; chin-height, palm facing self
  'Thank You': [
    0, 0, 0,
    0.08, 0.3, 0.1,
    0.14, 0.48, 0.12,
    0.16, 0.64, 0.1,
    0.16, 0.78, 0.08,
    0.08, 0.4, 0.08,
    0.08, 0.62, 0.06,
    0.08, 0.78, 0.04,
    0.08, 0.92, 0.02,
    0, 0.4, 0.08,
    0, 0.64, 0.06,
    0, 0.8, 0.04,
    0, 0.94, 0.02,
    -0.08, 0.38, 0.08,
    -0.08, 0.6, 0.06,
    -0.08, 0.76, 0.04,
    -0.08, 0.9, 0.02,
    -0.16, 0.32, 0.08,
    -0.16, 0.52, 0.06,
    -0.16, 0.66, 0.04,
    -0.16, 0.78, 0.02,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // I Understand: index finger pointing up at side of head
  'I Understand': [
    0, 0, 0,
    0.2, 0.18, 0.08,
    0.3, 0.28, 0.08,
    0.32, 0.38, 0.06,
    0.3, 0.48, 0.04,
    0.12, 0.32, 0.04,
    0.14, 0.55, 0.02, // index PIP
    0.14, 0.75, 0.02, // index DIP
    0.14, 0.92, 0.02, // index tip pointing up
    0.02, 0.3, 0.04,
    0.02, 0.4, -0.06,
    0.02, 0.33, -0.12,
    0.02, 0.26, -0.15,
    -0.08, 0.28, 0.04,
    -0.08, 0.38, -0.06,
    -0.08, 0.31, -0.12,
    -0.08, 0.24, -0.15,
    -0.17, 0.22, 0.04,
    -0.17, 0.3, -0.04,
    -0.17, 0.24, -0.1,
    -0.17, 0.18, -0.13,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // --- Group B: Face-interaction, face=neutral ---

  // Think: index finger pointing to right temple
  'Think': [
    0, 0, 0,
    0.2, 0.18, 0.08,
    0.3, 0.28, 0.08,
    0.32, 0.38, 0.06,
    0.3, 0.48, 0.04,
    0.12, 0.32, 0.04,
    0.15, 0.55, 0.02,
    0.15, 0.75, 0.02,
    0.15, 0.92, 0.02, // index tip toward temple
    0.02, 0.3, 0.04,
    0.02, 0.4, -0.06,
    0.02, 0.33, -0.12,
    0.02, 0.26, -0.15,
    -0.08, 0.28, 0.04,
    -0.08, 0.38, -0.06,
    -0.08, 0.31, -0.12,
    -0.08, 0.24, -0.15,
    -0.17, 0.22, 0.04,
    -0.17, 0.3, -0.04,
    -0.17, 0.24, -0.1,
    -0.17, 0.18, -0.13,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Know: fingers together flat, tapping forehead
  'Know': [
    0, 0, 0,
    0.08, 0.28, 0.1,
    0.14, 0.46, 0.12,
    0.16, 0.62, 0.1,
    0.16, 0.76, 0.08,
    0.08, 0.38, 0.08,
    0.1, 0.6, 0.06,
    0.1, 0.76, 0.04,
    0.1, 0.9, 0.02,
    0.02, 0.38, 0.08,
    0.02, 0.62, 0.06,
    0.02, 0.78, 0.04,
    0.02, 0.92, 0.02,
    -0.06, 0.36, 0.08,
    -0.06, 0.58, 0.06,
    -0.06, 0.74, 0.04,
    -0.06, 0.88, 0.02,
    -0.14, 0.3, 0.08,
    -0.14, 0.5, 0.06,
    -0.14, 0.64, 0.04,
    -0.14, 0.76, 0.02,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Father: thumb extended at forehead height, 4 fingers spread
  'Father': [
    0, 0, 0,
    0.06, 0.28, 0.1,
    0.1, 0.5, 0.12,
    0.12, 0.7, 0.12,
    0.12, 0.88, 0.1,  // thumb tip up toward forehead
    0.1, 0.38, 0.06,
    0.12, 0.62, 0.04,
    0.12, 0.8, 0.02,
    0.12, 0.96, 0,
    0.02, 0.38, 0.04,
    0.02, 0.62, 0.02,
    0.02, 0.8, 0,
    0.02, 0.96, -0.02,
    -0.08, 0.36, 0.04,
    -0.08, 0.58, 0.02,
    -0.08, 0.76, 0,
    -0.08, 0.92, -0.02,
    -0.17, 0.3, 0.04,
    -0.17, 0.5, 0.02,
    -0.17, 0.66, 0,
    -0.17, 0.8, -0.02,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Mother: thumb extended at chin height, 4 fingers spread
  'Mother': [
    0, 0, 0,
    0.06, 0.18, 0.1,
    0.1, 0.32, 0.12,
    0.12, 0.46, 0.12,
    0.12, 0.6, 0.1,   // thumb tip at chin level
    0.1, 0.3, 0.06,
    0.12, 0.52, 0.04,
    0.12, 0.68, 0.02,
    0.12, 0.82, 0,
    0.02, 0.3, 0.04,
    0.02, 0.52, 0.02,
    0.02, 0.68, 0,
    0.02, 0.82, -0.02,
    -0.08, 0.28, 0.04,
    -0.08, 0.48, 0.02,
    -0.08, 0.64, 0,
    -0.08, 0.78, -0.02,
    -0.17, 0.22, 0.04,
    -0.17, 0.4, 0.02,
    -0.17, 0.54, 0,
    -0.17, 0.66, -0.02,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Eat: flat-O hand (all fingertips touching thumb tip) toward mouth
  'Eat': [
    0, 0, 0,
    0.12, 0.22, 0.12,
    0.2, 0.38, 0.14,
    0.22, 0.52, 0.12,
    0.2, 0.62, 0.1,   // thumb tip
    0.1, 0.34, 0.1,
    0.12, 0.52, 0.08,
    0.16, 0.6, 0.08,
    0.2, 0.64, 0.1,   // index tip touching thumb
    0.02, 0.34, 0.1,
    0.02, 0.52, 0.08,
    0.06, 0.6, 0.08,
    0.18, 0.64, 0.1,  // middle tip touching thumb
    -0.06, 0.32, 0.1,
    -0.06, 0.5, 0.08,
    -0.02, 0.58, 0.08,
    0.16, 0.62, 0.1,  // ring tip touching thumb
    -0.15, 0.26, 0.1,
    -0.15, 0.42, 0.08,
    -0.1, 0.5, 0.08,
    0.14, 0.6, 0.1,   // pinky tip touching thumb
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Drink: C-hand shape curved like holding a cup, tilted toward face
  'Drink': [
    0, 0, 0,
    0.16, 0.2, 0.12,
    0.26, 0.36, 0.14,
    0.3, 0.52, 0.12,
    0.3, 0.66, 0.1,   // thumb tip, C-curve
    0.1, 0.36, 0.1,
    0.14, 0.56, 0.08,
    0.14, 0.7, 0.06,
    0.12, 0.82, 0.04, // index tip
    0.02, 0.36, 0.1,
    0.04, 0.58, 0.08,
    0.04, 0.72, 0.06,
    0.02, 0.84, 0.04,
    -0.07, 0.34, 0.1,
    -0.06, 0.56, 0.08,
    -0.06, 0.7, 0.06,
    -0.08, 0.82, 0.04,
    -0.16, 0.28, 0.1,
    -0.14, 0.46, 0.08,
    -0.14, 0.58, 0.06,
    -0.16, 0.68, 0.04,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Sleep: open hand fingers together, placed at cheek, palm to cheek
  'Sleep': [
    0, 0, 0,
    0.08, 0.26, 0.1,
    0.14, 0.44, 0.12,
    0.16, 0.6, 0.1,
    0.16, 0.74, 0.08,
    0.08, 0.36, 0.08,
    0.1, 0.58, 0.06,
    0.1, 0.74, 0.04,
    0.1, 0.88, 0.02,
    0.02, 0.36, 0.08,
    0.02, 0.6, 0.06,
    0.02, 0.76, 0.04,
    0.02, 0.9, 0.02,
    -0.06, 0.34, 0.08,
    -0.06, 0.56, 0.06,
    -0.06, 0.72, 0.04,
    -0.06, 0.86, 0.02,
    -0.14, 0.28, 0.08,
    -0.14, 0.48, 0.06,
    -0.14, 0.62, 0.04,
    -0.14, 0.74, 0.02,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Hot: claw hand, all fingers curled, palm facing face, near mouth
  'Hot': [
    0, 0, 0,
    0.16, 0.2, 0.12,
    0.26, 0.34, 0.14,
    0.3, 0.46, 0.12,
    0.28, 0.56, 0.08,
    0.1, 0.32, 0.1,
    0.16, 0.48, 0.04,
    0.16, 0.42, -0.04,
    0.12, 0.34, -0.1,  // index curled
    0.02, 0.32, 0.1,
    0.06, 0.5, 0.04,
    0.06, 0.44, -0.04,
    0.02, 0.36, -0.1,
    -0.08, 0.3, 0.1,
    -0.04, 0.48, 0.04,
    -0.04, 0.42, -0.04,
    -0.08, 0.34, -0.1,
    -0.17, 0.25, 0.1,
    -0.14, 0.4, 0.04,
    -0.14, 0.35, -0.04,
    -0.17, 0.28, -0.08,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Beautiful: open hand, fingers spread wide, palm faces self, circling face
  'Beautiful': [
    0, 0, 0,
    0.1, 0.3, 0.06,
    0.2, 0.5, 0.08,
    0.28, 0.68, 0.08,
    0.34, 0.84, 0.06,
    0.1, 0.42, 0.04,
    0.12, 0.66, 0.04,
    0.12, 0.84, 0.02,
    0.12, 1.0, 0,
    0.02, 0.42, 0.02,
    0.02, 0.68, 0.02,
    0.02, 0.86, 0,
    0.02, 1.0, -0.02,
    -0.08, 0.4, 0.02,
    -0.08, 0.64, 0.02,
    -0.08, 0.82, 0,
    -0.08, 0.96, -0.02,
    -0.18, 0.34, 0.02,
    -0.18, 0.56, 0.02,
    -0.18, 0.72, 0,
    -0.18, 0.84, -0.02,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Old: fist at chin, vertical
  'Old': [
    0, 0, 0,
    0.18, 0.18, 0.1,
    0.28, 0.32, 0.12,
    0.3, 0.44, 0.08,
    0.28, 0.54, 0.04,
    0.12, 0.28, 0.06,
    0.14, 0.38, -0.04,
    0.14, 0.31, -0.1,
    0.12, 0.24, -0.13,
    0.02, 0.28, 0.06,
    0.02, 0.38, -0.04,
    0.02, 0.31, -0.1,
    0.02, 0.24, -0.13,
    -0.08, 0.26, 0.06,
    -0.08, 0.36, -0.04,
    -0.08, 0.29, -0.1,
    -0.08, 0.22, -0.13,
    -0.17, 0.22, 0.06,
    -0.17, 0.3, -0.03,
    -0.17, 0.24, -0.08,
    -0.17, 0.18, -0.11,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // --- Group C: Bimanual ---

  // More: both hands flat-O, tapping together
  'More': [
    // right hand flat-O
    0, 0, 0,
    0.12, 0.22, 0.12,
    0.2, 0.38, 0.14,
    0.22, 0.52, 0.12,
    0.2, 0.62, 0.1,
    0.1, 0.34, 0.1,
    0.12, 0.52, 0.08,
    0.16, 0.6, 0.08,
    0.2, 0.64, 0.1,
    0.02, 0.34, 0.1,
    0.02, 0.52, 0.08,
    0.06, 0.6, 0.08,
    0.18, 0.64, 0.1,
    -0.06, 0.32, 0.1,
    -0.06, 0.5, 0.08,
    -0.02, 0.58, 0.08,
    0.16, 0.62, 0.1,
    -0.15, 0.26, 0.1,
    -0.15, 0.42, 0.08,
    -0.1, 0.5, 0.08,
    0.14, 0.6, 0.1,
    // left hand flat-O (mirror)
    0, 0, 0,
    -0.12, 0.22, 0.12,
    -0.2, 0.38, 0.14,
    -0.22, 0.52, 0.12,
    -0.2, 0.62, 0.1,
    -0.1, 0.34, 0.1,
    -0.12, 0.52, 0.08,
    -0.16, 0.6, 0.08,
    -0.2, 0.64, 0.1,
    -0.02, 0.34, 0.1,
    -0.02, 0.52, 0.08,
    -0.06, 0.6, 0.08,
    -0.18, 0.64, 0.1,
    0.06, 0.32, 0.1,
    0.06, 0.5, 0.08,
    0.02, 0.58, 0.08,
    -0.16, 0.62, 0.1,
    0.15, 0.26, 0.1,
    0.15, 0.42, 0.08,
    0.1, 0.5, 0.08,
    -0.14, 0.6, 0.1,
    ...NEUTRAL_FACE,
  ],

  // Done: both hands open, palms facing self
  'Done': [
    // right hand open palm
    0, 0, 0,
    0.1, 0.32, 0.06,
    0.18, 0.52, 0.08,
    0.22, 0.7, 0.08,
    0.24, 0.86, 0.06,
    0.08, 0.42, 0.04,
    0.08, 0.66, 0.02,
    0.08, 0.84, 0,
    0.08, 1.0, -0.02,
    0, 0.42, 0.04,
    0, 0.68, 0.02,
    0, 0.86, 0,
    0, 1.0, -0.02,
    -0.08, 0.4, 0.04,
    -0.08, 0.64, 0.02,
    -0.08, 0.82, 0,
    -0.08, 0.96, -0.02,
    -0.16, 0.34, 0.04,
    -0.16, 0.56, 0.02,
    -0.16, 0.7, 0,
    -0.16, 0.82, -0.02,
    // left hand open palm (mirror)
    0, 0, 0,
    -0.1, 0.32, 0.06,
    -0.18, 0.52, 0.08,
    -0.22, 0.7, 0.08,
    -0.24, 0.86, 0.06,
    -0.08, 0.42, 0.04,
    -0.08, 0.66, 0.02,
    -0.08, 0.84, 0,
    -0.08, 1.0, -0.02,
    0, 0.42, 0.04,
    0, 0.68, 0.02,
    0, 0.86, 0,
    0, 1.0, -0.02,
    0.08, 0.4, 0.04,
    0.08, 0.64, 0.02,
    0.08, 0.82, 0,
    0.08, 0.96, -0.02,
    0.16, 0.34, 0.04,
    0.16, 0.56, 0.02,
    0.16, 0.7, 0,
    0.16, 0.82, -0.02,
    ...NEUTRAL_FACE,
  ],

  // Friend: both index fingers hook/link together
  'Friend': [
    // right hand — index extended hook, others curled
    0, 0, 0,
    0.2, 0.18, 0.08,
    0.3, 0.28, 0.08,
    0.32, 0.38, 0.06,
    0.3, 0.48, 0.04,
    0.12, 0.32, 0.04,
    0.18, 0.52, 0.02,
    0.2, 0.68, -0.02,  // index tip hooked
    0.16, 0.76, -0.06,
    0.02, 0.3, 0.04,
    0.02, 0.4, -0.06,
    0.02, 0.33, -0.12,
    0.02, 0.26, -0.15,
    -0.08, 0.28, 0.04,
    -0.08, 0.38, -0.06,
    -0.08, 0.31, -0.12,
    -0.08, 0.24, -0.15,
    -0.17, 0.22, 0.04,
    -0.17, 0.3, -0.04,
    -0.17, 0.24, -0.1,
    -0.17, 0.18, -0.13,
    // left hand — index extended hook (mirror), others curled
    0, 0, 0,
    -0.2, 0.18, 0.08,
    -0.3, 0.28, 0.08,
    -0.32, 0.38, 0.06,
    -0.3, 0.48, 0.04,
    -0.12, 0.32, 0.04,
    -0.18, 0.52, 0.02,
    -0.2, 0.68, -0.02,
    -0.16, 0.76, -0.06,
    -0.02, 0.3, 0.04,
    -0.02, 0.4, -0.06,
    -0.02, 0.33, -0.12,
    -0.02, 0.26, -0.15,
    0.08, 0.28, 0.04,
    0.08, 0.38, -0.06,
    0.08, 0.31, -0.12,
    0.08, 0.24, -0.15,
    0.17, 0.22, 0.04,
    0.17, 0.3, -0.04,
    0.17, 0.24, -0.1,
    0.17, 0.18, -0.13,
    ...NEUTRAL_FACE,
  ],

  // Love: both arms crossed on chest, both hands flat near body center
  'Love': [
    // right hand flat on chest
    0, 0, 0,
    0.08, 0.28, 0.12,
    0.14, 0.46, 0.14,
    0.16, 0.62, 0.12,
    0.16, 0.76, 0.1,
    0.08, 0.38, 0.1,
    0.08, 0.6, 0.08,
    0.08, 0.76, 0.06,
    0.08, 0.9, 0.04,
    0, 0.38, 0.1,
    0, 0.62, 0.08,
    0, 0.78, 0.06,
    0, 0.92, 0.04,
    -0.08, 0.36, 0.1,
    -0.08, 0.58, 0.08,
    -0.08, 0.74, 0.06,
    -0.08, 0.88, 0.04,
    -0.16, 0.3, 0.1,
    -0.16, 0.5, 0.08,
    -0.16, 0.64, 0.06,
    -0.16, 0.76, 0.04,
    // left hand flat on chest crossed over
    0, 0, 0,
    -0.08, 0.28, 0.1,
    -0.14, 0.46, 0.12,
    -0.16, 0.62, 0.1,
    -0.16, 0.76, 0.08,
    -0.08, 0.38, 0.08,
    -0.08, 0.6, 0.06,
    -0.08, 0.76, 0.04,
    -0.08, 0.9, 0.02,
    0, 0.38, 0.08,
    0, 0.62, 0.06,
    0, 0.78, 0.04,
    0, 0.92, 0.02,
    0.08, 0.36, 0.08,
    0.08, 0.58, 0.06,
    0.08, 0.74, 0.04,
    0.08, 0.88, 0.02,
    0.16, 0.3, 0.08,
    0.16, 0.5, 0.06,
    0.16, 0.64, 0.04,
    0.16, 0.76, 0.02,
    ...NEUTRAL_FACE,
  ],

  // Name: H-hand on top of H-hand (index+middle extended horizontal)
  'Name': [
    // right hand H-shape: index + middle extended horizontally
    0, 0, 0,
    0.18, 0.18, 0.08,
    0.28, 0.28, 0.08,
    0.3, 0.38, 0.06,
    0.28, 0.48, 0.04,
    0.12, 0.32, 0.04,
    0.2, 0.48, 0.02,
    0.3, 0.54, 0.02,
    0.4, 0.56, 0.02,  // index tip pointing right
    0.02, 0.32, 0.04,
    0.08, 0.5, 0.02,
    0.18, 0.56, 0.02,
    0.28, 0.58, 0.02, // middle tip pointing right
    -0.08, 0.3, 0.04,
    -0.08, 0.4, -0.06,
    -0.08, 0.33, -0.12,
    -0.08, 0.26, -0.15,
    -0.17, 0.24, 0.04,
    -0.17, 0.32, -0.04,
    -0.17, 0.26, -0.1,
    -0.17, 0.2, -0.13,
    // left hand H-shape below right (mirrored, slightly lower)
    0, -0.3, 0,
    -0.18, -0.12, 0.08,
    -0.28, -0.02, 0.08,
    -0.3, 0.08, 0.06,
    -0.28, 0.18, 0.04,
    -0.12, 0.02, 0.04,
    -0.2, 0.18, 0.02,
    -0.3, 0.24, 0.02,
    -0.4, 0.26, 0.02,
    -0.02, 0.02, 0.04,
    -0.08, 0.2, 0.02,
    -0.18, 0.26, 0.02,
    -0.28, 0.28, 0.02,
    0.08, 0, 0.04,
    0.08, 0.1, -0.06,
    0.08, 0.03, -0.12,
    0.08, -0.04, -0.15,
    0.17, -0.06, 0.04,
    0.17, 0.02, -0.04,
    0.17, -0.04, -0.1,
    0.17, -0.1, -0.13,
    ...NEUTRAL_FACE,
  ],

  // --- Group D: Spatial ---

  // Where: index finger extended, wagging (pointing, side to side)
  'Where': [
    0, 0, 0,
    0.2, 0.18, 0.08,
    0.3, 0.28, 0.08,
    0.32, 0.38, 0.06,
    0.3, 0.48, 0.04,
    0.12, 0.32, 0.04,
    0.15, 0.55, 0.02,
    0.15, 0.75, 0.02,
    0.15, 0.92, 0.02, // index tip
    0.02, 0.3, 0.04,
    0.02, 0.4, -0.06,
    0.02, 0.33, -0.12,
    0.02, 0.26, -0.15,
    -0.08, 0.28, 0.04,
    -0.08, 0.38, -0.06,
    -0.08, 0.31, -0.12,
    -0.08, 0.24, -0.15,
    -0.17, 0.22, 0.04,
    -0.17, 0.3, -0.04,
    -0.17, 0.24, -0.1,
    -0.17, 0.18, -0.13,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // What: open hand palm up, fingers spread
  'What': [
    0, 0, 0,
    0.1, 0.28, -0.06,
    0.18, 0.46, -0.08,
    0.22, 0.62, -0.08,
    0.24, 0.76, -0.06, // thumb tip
    0.08, 0.38, -0.04,
    0.08, 0.62, -0.04,
    0.08, 0.8, -0.02,
    0.08, 0.96, 0,
    0, 0.38, -0.04,
    0, 0.64, -0.04,
    0, 0.82, -0.02,
    0, 0.98, 0,
    -0.08, 0.36, -0.04,
    -0.08, 0.6, -0.04,
    -0.08, 0.78, -0.02,
    -0.08, 0.94, 0,
    -0.16, 0.3, -0.04,
    -0.16, 0.52, -0.04,
    -0.16, 0.68, -0.02,
    -0.16, 0.82, 0,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Sorry: closed fist, circular motion on chest
  'Sorry': [
    0, 0, 0,
    0.18, 0.18, 0.1,
    0.28, 0.32, 0.12,
    0.3, 0.44, 0.08,
    0.28, 0.54, 0.04,
    0.12, 0.28, 0.06,
    0.14, 0.38, -0.04,
    0.14, 0.31, -0.1,
    0.12, 0.24, -0.13,
    0.02, 0.28, 0.06,
    0.02, 0.38, -0.04,
    0.02, 0.31, -0.1,
    0.02, 0.24, -0.13,
    -0.08, 0.26, 0.06,
    -0.08, 0.36, -0.04,
    -0.08, 0.29, -0.1,
    -0.08, 0.22, -0.13,
    -0.17, 0.22, 0.06,
    -0.17, 0.3, -0.03,
    -0.17, 0.24, -0.08,
    -0.17, 0.18, -0.11,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],

  // Pain: both index fingers pointing at each other from opposite sides (bimanual)
  'Pain': [
    // right hand index pointing left
    0, 0, 0,
    0.2, 0.18, 0.08,
    0.3, 0.28, 0.08,
    0.32, 0.38, 0.06,
    0.3, 0.48, 0.04,
    0.12, 0.32, 0.04,
    0.04, 0.5, 0.02,
    -0.06, 0.58, 0.02,
    -0.16, 0.62, 0.02, // index tip pointing left
    0.02, 0.3, 0.04,
    0.02, 0.4, -0.06,
    0.02, 0.33, -0.12,
    0.02, 0.26, -0.15,
    -0.08, 0.28, 0.04,
    -0.08, 0.38, -0.06,
    -0.08, 0.31, -0.12,
    -0.08, 0.24, -0.15,
    -0.17, 0.22, 0.04,
    -0.17, 0.3, -0.04,
    -0.17, 0.24, -0.1,
    -0.17, 0.18, -0.13,
    // left hand index pointing right
    0, 0, 0,
    -0.2, 0.18, 0.08,
    -0.3, 0.28, 0.08,
    -0.32, 0.38, 0.06,
    -0.3, 0.48, 0.04,
    -0.12, 0.32, 0.04,
    -0.04, 0.5, 0.02,
    0.06, 0.58, 0.02,
    0.16, 0.62, 0.02, // index tip pointing right
    -0.02, 0.3, 0.04,
    -0.02, 0.4, -0.06,
    -0.02, 0.33, -0.12,
    -0.02, 0.26, -0.15,
    0.08, 0.28, 0.04,
    0.08, 0.38, -0.06,
    0.08, 0.31, -0.12,
    0.08, 0.24, -0.15,
    0.17, 0.22, 0.04,
    0.17, 0.3, -0.04,
    0.17, 0.24, -0.1,
    0.17, 0.18, -0.13,
    ...NEUTRAL_FACE,
  ],

  // Work: fist tapping on forearm, single hand fist
  'Work': [
    0, 0, 0,
    0.18, 0.18, 0.1,
    0.28, 0.3, 0.12,
    0.3, 0.42, 0.08,
    0.28, 0.52, 0.04,
    0.12, 0.28, 0.06,
    0.14, 0.38, -0.04,
    0.14, 0.31, -0.1,
    0.12, 0.24, -0.13,
    0.02, 0.28, 0.06,
    0.02, 0.38, -0.04,
    0.02, 0.31, -0.1,
    0.02, 0.24, -0.13,
    -0.08, 0.26, 0.06,
    -0.08, 0.36, -0.04,
    -0.08, 0.29, -0.1,
    -0.08, 0.22, -0.13,
    -0.17, 0.22, 0.06,
    -0.17, 0.3, -0.03,
    -0.17, 0.24, -0.08,
    -0.17, 0.18, -0.11,
    ...ZERO_HAND,
    ...NEUTRAL_FACE,
  ],
};

export function generateDemoDataset(
  gestures: string[],
  samplesPerGesture = 30
): GestureSample[] {
  const samples: GestureSample[] = [];
  const noise = () => (Math.random() - 0.5) * 0.06;

  for (const gesture of gestures) {
    const seed = gestureSeeds[gesture];
    if (!seed) continue;

    for (let i = 0; i < samplesPerGesture; i++) {
      const landmarks = toHandOnlyFeatures(seed.map(v => v + noise()));
      samples.push({
        label: gesture,
        landmarks,
        timestamp: Date.now() - Math.random() * 86400000,
      });
    }
  }

  return samples;
}
