import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../test/fixtures';

const piper = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@mintplex-labs/piper-tts-web', () => ({
  TtsSession: { create: piper.create, _instance: null },
}));
vi.mock('sonner', () => ({ toast: { loading: vi.fn(), dismiss: vi.fn() } }));

interface FakeSource {
  buffer: AudioBuffer | null;
  playbackRate: { value: number };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}

const sources: FakeSource[] = [];

const audioBlob = () => ({
  arrayBuffer: async () => new ArrayBuffer(1),
}) as Blob;

async function flushPromises(count = 6) {
  for (let index = 0; index < count; index++) await Promise.resolve();
}

describe('Piper speech ownership', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sources.length = 0;
    class FakeAudioContext {
      state = 'running';
      destination = {};
      resume = vi.fn();
      decodeAudioData = vi.fn(async () => ({ duration: 0.1 }) as AudioBuffer);
      createBufferSource = vi.fn(() => {
        const source: FakeSource = {
          buffer: null,
          playbackRate: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null,
        };
        sources.push(source);
        return source;
      });
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });

  it('serializes rapid EN→EL→EN work and only synthesizes the final utterance', async () => {
    const predict = vi.fn(async () => audioBlob());
    piper.create.mockResolvedValue({ predict });
    const { speakWithPiper } = await import('./piperFallback');

    const first = speakWithPiper('A', 'en');
    const second = speakWithPiper('B', 'el');
    const third = speakWithPiper('C', 'en');
    await flushPromises(30);

    expect(piper.create).toHaveBeenCalledTimes(1);
    expect(piper.create.mock.calls[0][0].voiceId).toBe('en_US-hfc_female-medium');
    expect(predict).toHaveBeenCalledTimes(1);
    expect(predict).toHaveBeenCalledWith('C');
    expect(sources).toHaveLength(1);
    sources[0].onended?.();

    await expect(Promise.all([first, second, third])).resolves.toEqual([undefined, undefined, undefined]);
  });

  it('settles Stop during prediction and never starts late audio', async () => {
    const prediction = deferred<Blob>();
    const predict = vi.fn(() => prediction.promise);
    piper.create.mockResolvedValue({ predict });
    const { speakWithPiper, stopPiper } = await import('./piperFallback');

    const speaking = speakWithPiper('hello', 'en');
    await flushPromises();
    expect(predict).toHaveBeenCalledTimes(1);
    stopPiper();
    await expect(speaking).resolves.toBeUndefined();
    prediction.resolve(audioBlob());
    await flushPromises();
    expect(sources).toHaveLength(0);
  });

  it('settles active playback when stopped', async () => {
    piper.create.mockResolvedValue({
      predict: vi.fn(async () => audioBlob()),
    });
    const { speakWithPiper, stopPiper } = await import('./piperFallback');

    const speaking = speakWithPiper('hello', 'en');
    await flushPromises(12);
    expect(sources).toHaveLength(1);
    stopPiper();

    await expect(speaking).resolves.toBeUndefined();
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
  });
});
