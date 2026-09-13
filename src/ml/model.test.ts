import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../test/fixtures';
import type { GestureSample } from '../contexts/AppContext';

const samples: GestureSample[] = ['A', 'B'].flatMap((label, group) =>
  Array.from({ length: 5 }, (_, index) => ({
    label,
    timestamp: group * 10 + index,
    landmarks: Array(63).fill(group + index / 10),
  })),
);

describe('custom model operation ownership', () => {
  beforeEach(() => vi.resetModules());

  it('cancels a stale training result and never publishes its candidate', async () => {
    const completion = deferred<unknown>();
    const candidate = { model: {}, labels: ['A', 'B'] };
    const dispose = vi.fn();
    const trainCandidate = vi.fn(async () => completion.promise);
    vi.doMock('./modelEngine', () => ({
      trainCandidate,
      dispose,
      load: vi.fn(),
      save: vi.fn(),
      predict: vi.fn(),
    }));
    const model = await import('./model');
    const training = model.startTraining(samples, { epochs: 1, batchSize: 2, learningRate: 0.01, validationSplit: 0.2 }, 7);
    await vi.waitFor(() => expect(trainCandidate).toHaveBeenCalledTimes(1));
    expect(await model.loadModel()).toBe(false);
    model.disposeModel();
    completion.resolve({
      candidate,
      metrics: { accuracy: 1, precision: {}, recall: {}, f1Score: {}, perClassAccuracy: {}, confusionMatrix: [[1, 0], [0, 1]], labels: ['A', 'B'] },
    });
    await expect(training).rejects.toMatchObject({ name: 'AbortError' });
    expect(dispose).toHaveBeenCalledWith(candidate);
    expect(model.getModelSnapshot()).toMatchObject({ ready: false, busy: false, status: 'cancelled', metrics: null });
  });
});
