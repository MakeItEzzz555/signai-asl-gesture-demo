import { beforeEach, describe, expect, it, vi } from 'vitest';

type EspeakCallback = (audioData: Float32Array | null, sampleRate?: number) => void;

const callbacks: EspeakCallback[] = [];
const createBufferSource = vi.fn();

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('eSpeak speech ownership', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    callbacks.length = 0;
    class SimpleTTS {
      onReady(callback: (error?: Error) => void) { callback(); }
      speak(_text: string, _options: unknown, callback: EspeakCallback) {
        callbacks.push(callback);
      }
    }
    Object.defineProperty(window, 'SimpleTTS', { configurable: true, value: SimpleTTS });

    createBufferSource.mockImplementation(() => ({
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    }));
    class FakeAudioContext {
      state = 'running';
      destination = {};
      createBuffer = vi.fn(() => ({ getChannelData: () => new Float32Array(4) }));
      createBufferSource = createBufferSource;
      resume = vi.fn();
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });

  it('settles Stop during worker synthesis and ignores the late callback', async () => {
    const { speakWithEspeak, stopEspeak } = await import('./espeakFallback');
    const speaking = speakWithEspeak('hello', 'en');
    await flushPromises();
    expect(callbacks).toHaveLength(1);

    stopEspeak();
    await expect(speaking).resolves.toBeUndefined();
    callbacks[0](new Float32Array([0.1]), 22050);

    expect(createBufferSource).not.toHaveBeenCalled();
  });

  it('settles Stop while the worker is still initializing', async () => {
    let ready: ((error?: Error) => void) | null = null;
    const workerSpeak = vi.fn();
    class DelayedSimpleTTS {
      onReady(callback: (error?: Error) => void) { ready = callback; }
      speak = workerSpeak;
    }
    Object.defineProperty(window, 'SimpleTTS', { configurable: true, value: DelayedSimpleTTS });
    const { speakWithEspeak, stopEspeak } = await import('./espeakFallback');

    const speaking = speakWithEspeak('hello', 'en');
    stopEspeak();
    await expect(speaking).resolves.toBeUndefined();
    (ready as ((error?: Error) => void) | null)?.();
    await flushPromises();

    expect(workerSpeak).not.toHaveBeenCalled();
  });
});
