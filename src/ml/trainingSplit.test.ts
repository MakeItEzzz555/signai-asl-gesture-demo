import { describe, expect, it } from 'vitest';
import { encodeTrainingSamples, splitTrainingSamples } from './trainingSplit';
import type { GestureSample } from '../contexts/AppContext';

const sample = (label: string, id: number): GestureSample => ({
  label, timestamp: label.charCodeAt(0) * 100 + id,
  landmarks: Array.from({ length: 63 }, (_, index) => index + id / 100),
});

describe('training holdout contract', () => {
  it('stratifies physical samples deterministically before augmentation', () => {
    const samples = ['A', 'B', 'C'].flatMap(label => Array.from({ length: 10 }, (_, id) => sample(label, id)));
    const first = splitTrainingSamples(samples, 0.2, 42);
    const second = splitTrainingSamples(samples, 0.2, 42);
    expect(first.validation.map(value => value.timestamp)).toEqual(second.validation.map(value => value.timestamp));
    expect(first.labelNames).toEqual(['A', 'B', 'C']);
    expect(first.validation).toHaveLength(6);
    expect(new Set(first.train.map(value => value.timestamp))).not.toContain(first.validation[0].timestamp);
    expect(encodeTrainingSamples(first.train, first.labelNames, true).features).toHaveLength(48);
    expect(encodeTrainingSamples(first.validation, first.labelNames, false).features).toHaveLength(6);
  });

  it('requires every class in both fitting and holdout sets', () => {
    const samples = [...Array.from({ length: 9 }, (_, id) => sample('A', id)), sample('B', 0)];
    expect(() => splitTrainingSamples(samples, 0.2)).toThrow('at least 2 samples');
  });
});
