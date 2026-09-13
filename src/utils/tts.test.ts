import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../test/fixtures';

const backends = vi.hoisted(() => ({
  speakCloud: vi.fn(),
  stopCloud: vi.fn(),
  cloudAvailable: vi.fn(() => true),
  speakEspeak: vi.fn(async () => undefined),
  stopEspeak: vi.fn(),
  hasEspeak: vi.fn(() => false),
  espeakReady: vi.fn(() => true),
  speakPiper: vi.fn(async () => undefined),
  stopPiper: vi.fn(),
  hasPiper: vi.fn(() => false),
  piperReady: vi.fn(() => false),
  preWarmPiper: vi.fn(async () => undefined),
}));

vi.mock('sonner', () => ({ toast: { info: vi.fn(), dismiss: vi.fn() } }));
vi.mock('./cloudTts', () => ({
  speakWithCloud: backends.speakCloud,
  stopCloud: backends.stopCloud,
  cloudAvailable: backends.cloudAvailable,
}));
vi.mock('./espeakFallback', () => ({
  speakWithEspeak: backends.speakEspeak,
  stopEspeak: backends.stopEspeak,
  hasEspeakFor: backends.hasEspeak,
  isEspeakReady: backends.espeakReady,
}));
vi.mock('./piperFallback', () => ({
  speakWithPiper: backends.speakPiper,
  stopPiper: backends.stopPiper,
  piperHasVoice: backends.hasPiper,
  piperVoiceReady: backends.piperReady,
  preWarmPiper: backends.preWarmPiper,
}));

interface SynthesisFixture {
  synthesis: SpeechSynthesis;
  setVoices: (voices: SpeechSynthesisVoice[]) => void;
  emitVoicesChanged: () => void;
}

function installSpeechSynthesis(initialVoices: SpeechSynthesisVoice[] = []): SynthesisFixture {
  let voices = initialVoices;
  const listeners = new Set<EventListener>();
  const synthesis = {
    getVoices: vi.fn(() => voices),
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'voiceschanged') listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'voiceschanged') listeners.delete(listener);
    }),
  } as unknown as SpeechSynthesis;
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis });
  class Utterance {
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    constructor(public text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  return {
    synthesis,
    setVoices: next => { voices = next; },
    emitVoicesChanged: () => listeners.forEach(listener => listener(new Event('voiceschanged'))),
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('speech utterance ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    backends.cloudAvailable.mockReturnValue(true);
    backends.hasEspeak.mockReturnValue(false);
    backends.espeakReady.mockReturnValue(true);
    backends.hasPiper.mockReturnValue(false);
    backends.piperReady.mockReturnValue(false);
    backends.speakEspeak.mockResolvedValue(undefined);
    backends.speakPiper.mockResolvedValue(undefined);
    backends.preWarmPiper.mockResolvedValue(undefined);
  });

  it('bounds empty native voice discovery and runs fallback exactly once', async () => {
    const voices = installSpeechSynthesis();
    const onMissing = vi.fn();
    const { speak } = await import('./tts');

    speak('hello', 'zz-ZZ', onMissing);
    await vi.advanceTimersByTimeAsync(300);
    voices.emitVoicesChanged();
    await flushPromises();

    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(voices.synthesis.speak).not.toHaveBeenCalled();
  });

  it('does not run twice when the voices event wins the timeout race', async () => {
    const voices = installSpeechSynthesis();
    const nativeVoice = { lang: 'en-US', name: 'Test English' } as SpeechSynthesisVoice;
    const { speak } = await import('./tts');

    speak('hello', 'en-US');
    voices.setVoices([nativeVoice]);
    voices.emitVoicesChanged();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(300);

    expect(voices.synthesis.speak).toHaveBeenCalledTimes(1);
  });

  it('uses a supported local backend when speechSynthesis is absent', async () => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
    backends.hasEspeak.mockReturnValue(true);
    const { speak } = await import('./tts');

    speak('γειά', 'el-GR');
    await flushPromises();

    expect(backends.speakEspeak).toHaveBeenCalledWith('γειά', 'el');
  });

  it('never starts stale local fallback when cloud A rejects after B starts', async () => {
    installSpeechSynthesis();
    const first = deferred<void>();
    const second = deferred<void>();
    backends.speakCloud
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    backends.hasEspeak.mockReturnValue(true);
    const { speak, syncSpeechPreferences } = await import('./tts');
    syncSpeechPreferences({ useCloudVoices: true });

    speak('A', 'en-US');
    await flushPromises();
    speak('B', 'en-US');
    await flushPromises();
    first.reject(new Error('late A failure'));
    await flushPromises();

    expect(backends.speakCloud).toHaveBeenCalledTimes(2);
    expect(backends.speakEspeak).not.toHaveBeenCalled();
    second.resolve();
    await flushPromises();
  });

  it('Stop and preference changes settle native waits without replaying work', async () => {
    const voices = installSpeechSynthesis();
    const onMissing = vi.fn();
    const { speak, stopSpeech, syncSpeechPreferences } = await import('./tts');

    speak('first', 'zz-ZZ', onMissing);
    stopSpeech();
    stopSpeech();
    syncSpeechPreferences({ language: 'el', audioEnabled: false });
    voices.emitVoicesChanged();
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(onMissing).not.toHaveBeenCalled();
    expect(backends.stopCloud).toHaveBeenCalled();
    expect(backends.stopEspeak).toHaveBeenCalled();
    expect(backends.stopPiper).toHaveBeenCalled();
  });
});
