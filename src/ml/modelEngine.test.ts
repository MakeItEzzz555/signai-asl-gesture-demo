import { describe, expect, it } from 'vitest';
import * as tf from '@tensorflow/tfjs';
import { computeMetrics } from './modelEngine';

describe('custom model evaluation', () => {
  it('uses validation predictions and prototype-safe label maps', async () => {
    await tf.setBackend('cpu');
    await tf.ready();
    const output = tf.tensor2d([[0.9, 0.1], [0.2, 0.8], [0.7, 0.3]]);
    const candidate = {
      labels: ['__proto__', 'constructor'],
      model: { predict: () => output } as unknown as tf.LayersModel,
    };
    const metrics = computeMetrics(candidate, [Array(63).fill(0), Array(63).fill(1), Array(63).fill(2)], [0, 1, 1]);
    expect(metrics.confusionMatrix).toEqual([[1, 0], [1, 1]]);
    expect(metrics.accuracy).toBeCloseTo(2 / 3);
    expect(Object.getPrototypeOf(metrics.precision)).toBeNull();
    expect(metrics.precision.__proto__).toBeCloseTo(0.5);
    output.dispose();
  });
});
