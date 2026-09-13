import type { GestureSample } from '../contexts/AppContext';
import { isFaceInteractiveGesture } from '../dataset/datasetUtils';
import { toHandOnlyFeatures } from '../utils/landmarks';

export interface TrainingPartition {
  labelNames: string[];
  train: GestureSample[];
  validation: GestureSample[];
  seed: number;
}

/** Split physical samples first. This is sample-level validation, not signer isolation. */
export function splitTrainingSamples(samples: GestureSample[], fraction: number, seed = 20260912): TrainingPartition {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) throw new Error('Validation split must be between 0 and 1');
  const groups = new Map<string, GestureSample[]>();
  for (const sample of samples) {
    if (isFaceInteractiveGesture(sample.label)) continue;
    const group = groups.get(sample.label) ?? [];
    group.push(sample);
    groups.set(sample.label, group);
  }
  if (groups.size < 2 || [...groups.values()].reduce((n, group) => n + group.length, 0) < 10) {
    throw new Error('Need at least 10 samples across 2 gesture classes');
  }
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const train: GestureSample[] = [], validation: GestureSample[] = [];
  const labelNames = [...groups.keys()].sort();
  for (const label of labelNames) {
    const group = [...groups.get(label)!];
    if (group.length < 2) throw new Error(`Record at least 2 samples for "${label}" so it can appear in training and validation`);
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    const count = Math.max(1, Math.min(group.length - 1, Math.round(group.length * fraction)));
    validation.push(...group.slice(0, count));
    train.push(...group.slice(count));
  }
  return { train, validation, labelNames, seed };
}

export function encodeTrainingSamples(samples: GestureSample[], labelNames: string[], augment: boolean) {
  const features: number[][] = [], labels: number[][] = [], labelIndices: number[] = [];
  for (const sample of samples) {
    const index = labelNames.indexOf(sample.label);
    if (index < 0) throw new Error(`Unknown class "${sample.label}"`);
    const hand = toHandOnlyFeatures(sample.landmarks);
    const rows = augment ? [hand, hand.map((v, i) => i % 3 === 0 ? -v : v)] : [hand];
    for (const row of rows) {
      features.push(row);
      labels.push(labelNames.map((_, i) => Number(i === index)));
      labelIndices.push(index);
    }
  }
  return { features, labels, labelIndices };
}
