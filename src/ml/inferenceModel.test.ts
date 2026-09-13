import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ort from 'onnxruntime-web/wasm';
import { deferred } from '../test/fixtures';

const runs: Array<ReturnType<typeof deferred<Record<string, { data: Float32Array; dispose(): void }>>>> = [];
const capturedInputs: Float32Array[] = [];

vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: {} },
  Tensor: class Tensor {
    constructor(_type: string, public data: Float32Array, public dims: number[]) {}
  },
  InferenceSession: {
    create: vi.fn(async () => ({
      inputNames: ['input'],
      outputNames: ['output'],
      run: vi.fn(async (feeds: Record<string, { data: Float32Array }>) => {
        capturedInputs.push(new Float32Array(feeds.input.data));
        const run = deferred<Record<string, { data: Float32Array; dispose(): void }>>();
        runs.push(run);
        return run.promise;
      }),
    })),
  },
}));

describe('inference generation ownership', () => {
  beforeEach(() => {
    runs.length = 0;
    capturedInputs.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ labels: ['hello', 'blank'] }),
    })));
  });

  it('discards stale completion, preserves immutable inputs, and keeps the new task locked', async () => {
    const model = await import('./inferenceModel');
    const firstLoad = model.loadModel();
    const concurrentLoad = model.loadModel();
    await expect(Promise.all([firstLoad, concurrentLoad])).resolves.toEqual([true, true]);
    expect(vi.mocked(ort.InferenceSession.create)).toHaveBeenCalledTimes(1);
    model.resetPredictionState();

    const frame = (value: number) => Array.from({ length: 63 }, () => value);
    for (let i = 0; i < 29; i++) await model.predict(frame(i), true, false);
    const stale = model.predict(frame(29), true, false);
    expect(runs).toHaveLength(1);

    for (let i = 30; i < 35; i++) await model.predict(frame(i), true, false);
    expect(runs).toHaveLength(1);

    model.resetPredictionState();
    for (let i = 100; i < 129; i++) await model.predict(frame(i), true, false);
    const current = model.predict(frame(129), true, false);
    expect(runs).toHaveLength(2);
    expect(capturedInputs[0][0]).toBe(0);
    expect(capturedInputs[0][29 * 126]).toBe(29);
    expect(capturedInputs[1][0]).toBe(100);
    expect(capturedInputs[1][29 * 126]).toBe(129);

    runs[0].resolve({ output: { data: new Float32Array([10, 0]), dispose() {} } });
    await expect(stale).resolves.toBeNull();

    await model.predict(frame(130), true, false);
    expect(runs).toHaveLength(2);

    runs[1].resolve({ output: { data: new Float32Array([10, 0]), dispose() {} } });
    await expect(current).resolves.toMatchObject({ liveLabel: 'hello' });
  });
});
