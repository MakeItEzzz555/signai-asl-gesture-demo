import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../test/fixtures';

interface FakeAudioInstance {
  src: string;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

const audioInstances: FakeAudioInstance[] = [];

function response(body: ArrayBuffer | Promise<ArrayBuffer>): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(body),
  } as Response;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('cloud speech ownership', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    audioInstances.length = 0;
    vi.stubGlobal('Audio', class FakeAudio implements FakeAudioInstance {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn();
      constructor(public src: string) { audioInstances.push(this); }
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((_: Blob) => `blob:${audioInstances.length + 1}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('ignores a delayed A response without clearing or playing newer B', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise));
    const { speakWithCloud } = await import('./cloudTts');

    const aResult = speakWithCloud('A', 'en').catch(error => error as Error);
    const bResult = speakWithCloud('B', 'en');
    const aError = await aResult;
    expect(aError).toMatchObject({ name: 'AbortError' });
    first.resolve(response(new ArrayBuffer(1)));
    await flushPromises();
    expect(audioInstances).toHaveLength(0);

    second.resolve(response(new ArrayBuffer(1)));
    await flushPromises();
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].pause).not.toHaveBeenCalled();
    audioInstances[0].onended?.();
    await expect(bResult).resolves.toBeUndefined();
  });

  it('settles and releases active playback when stopped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(new ArrayBuffer(1))));
    const { speakWithCloud, stopCloud } = await import('./cloudTts');

    const speaking = speakWithCloud('hello', 'en');
    await flushPromises();
    expect(audioInstances).toHaveLength(1);
    stopCloud();

    await expect(speaking).resolves.toBeUndefined();
    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('only disables cloud routing for the explicit not-configured response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { code: 'TTS_PROTECTION_NOT_CONFIGURED', error: 'Protection unavailable' },
      { status: 503 },
    )));
    const { cloudAvailable, speakWithCloud } = await import('./cloudTts');
    await expect(speakWithCloud('hello', 'en')).rejects.toThrow('Protection unavailable');
    expect(cloudAvailable()).toBe(true);
  });
});
