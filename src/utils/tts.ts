import { toast } from 'sonner';
import { speakWithEspeak, stopEspeak, hasEspeakFor, isEspeakReady } from './espeakFallback';
import { speakWithPiper, stopPiper, piperHasVoice, piperVoiceReady, preWarmPiper } from './piperFallback';
import { speakWithCloud, stopCloud, cloudAvailable } from './cloudTts';

export interface SpeechPreferences {
  audioEnabled: boolean;
  useCloudVoices: boolean;
  language: string | null;
}

const speechPreferences: SpeechPreferences = {
  audioEnabled: true,
  useCloudVoices: false,
  language: null,
};

let utteranceGeneration = 0;
let cachedVoices: SpeechSynthesisVoice[] = [];
let pendingVoiceWait: { generation: number; cancel: () => void } | null = null;

function speechSynthesisOrNull(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return window.speechSynthesis;
}

function refreshVoices(): void {
  const synthesis = speechSynthesisOrNull();
  if (!synthesis) return;
  const voices = synthesis.getVoices();
  if (voices.length) cachedVoices = voices;
}

const synthesis = speechSynthesisOrNull();
if (synthesis) {
  refreshVoices();
  // Chrome may populate voices over several events, so keep the cache listener.
  synthesis.addEventListener('voiceschanged', refreshVoices);
}

function cancelSpeechResources(): void {
  pendingVoiceWait?.cancel();
  pendingVoiceWait = null;
  stopCloud();
  speechSynthesisOrNull()?.cancel();
  stopEspeak();
  stopPiper();
}

/** Stop every speech backend and invalidate every delayed continuation. */
export function stopSpeech(): void {
  utteranceGeneration++;
  cancelSpeechResources();
}

/**
 * Synchronize app-level speech preferences. A changed preference cancels the
 * current utterance so a delayed backend cannot speak with stale settings.
 */
export function syncSpeechPreferences(next: Partial<SpeechPreferences>): void {
  const changed =
    (next.audioEnabled !== undefined && next.audioEnabled !== speechPreferences.audioEnabled) ||
    (next.useCloudVoices !== undefined && next.useCloudVoices !== speechPreferences.useCloudVoices) ||
    (next.language !== undefined && next.language !== speechPreferences.language);

  if (next.audioEnabled !== undefined) speechPreferences.audioEnabled = next.audioEnabled;
  if (next.useCloudVoices !== undefined) speechPreferences.useCloudVoices = next.useCloudVoices;
  if (next.language !== undefined) speechPreferences.language = next.language;

  if (changed) stopSpeech();
}

/** Backward-compatible cloud preference setter used by AppContext. */
export function setCloudVoicesEnabled(enabled: boolean): void {
  syncSpeechPreferences({ useCloudVoices: enabled });
}

export function preWarmVoices(): void { refreshVoices(); }

const norm = (text: string) => text.toLowerCase().replace(/_/g, '-');

export function resolveVoice(lang: string): SpeechSynthesisVoice | null {
  const want = norm(lang);
  const base = want.split('-')[0];
  return (
    cachedVoices.find(voice => norm(voice.lang) === want) ??
    cachedVoices.find(voice => norm(voice.lang).split('-')[0] === base) ??
    null
  );
}

export function hasVoiceFor(lang: string): boolean {
  return resolveVoice(lang) !== null;
}

function waitForNativeVoices(generation: number): Promise<void> {
  const currentSynthesis = speechSynthesisOrNull();
  refreshVoices();
  if (!currentSynthesis || cachedVoices.length > 0) return Promise.resolve();

  return new Promise(resolve => {
    let settled = false;
    let timer = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      currentSynthesis.removeEventListener('voiceschanged', onChange);
      if (timer) window.clearTimeout(timer);
      if (pendingVoiceWait?.generation === generation) pendingVoiceWait = null;
      resolve();
    };
    const onChange = () => {
      refreshVoices();
      if (cachedVoices.length > 0) finish();
    };

    currentSynthesis.addEventListener('voiceschanged', onChange);
    timer = window.setTimeout(() => {
      refreshVoices();
      finish();
    }, 300);
    pendingVoiceWait = { generation, cancel: finish };
  });
}

let espeakLoadingToastShown = false;

function maybeShowLoadingHint(): void {
  if (isEspeakReady() || espeakLoadingToastShown) return;
  espeakLoadingToastShown = true;
  toast.info('Loading offline speech engine for the first time (~2.5 MB)…', {
    duration: 5000,
    id: 'espeak-loading',
  });
}

function ownsUtterance(generation: number): boolean {
  return generation === utteranceGeneration && speechPreferences.audioEnabled;
}

async function speakEspeak(
  text: string,
  lang: string,
  base: string,
  generation: number,
  bridge = false,
): Promise<void> {
  if (!ownsUtterance(generation)) return;
  maybeShowLoadingHint();
  await speakWithEspeak(text, base);
  if (!ownsUtterance(generation)) return;
  toast.dismiss('espeak-loading');
  console.log(`[TTS] ${lang} → eSpeak-NG${bridge ? ' (Piper loading, bridge)' : ''} (${base})`);
}

async function runLocal(
  text: string,
  lang: string,
  onMissing: ((lang: string) => void) | undefined,
  generation: number,
): Promise<void> {
  await waitForNativeVoices(generation);
  if (!ownsUtterance(generation)) return;

  const nativeSynthesis = speechSynthesisOrNull();
  const voice = resolveVoice(lang);
  if (nativeSynthesis && voice) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    console.log(`[TTS] ${lang} → ${voice.name} (${voice.lang})`);
    nativeSynthesis.speak(utterance);
    return;
  }

  const base = lang.split('-')[0];
  if (piperHasVoice(base)) {
    if (!piperVoiceReady(base) && hasEspeakFor(base)) {
      // Keep download initiation inside the selected speech path and bridge
      // the cold start with the small local engine.
      void preWarmPiper(base);
      await speakEspeak(text, lang, base, generation, true);
      return;
    }

    try {
      await speakWithPiper(text, base, { rate: 0.9 });
      return;
    } catch (error) {
      if (!ownsUtterance(generation)) return;
      console.error('[TTS] Piper error for', base, ':', error instanceof Error ? error.message : error);
      if (hasEspeakFor(base)) {
        await speakEspeak(text, lang, base, generation);
        return;
      }
    }
  } else if (hasEspeakFor(base)) {
    await speakEspeak(text, lang, base, generation);
    return;
  }

  if (ownsUtterance(generation)) {
    console.warn(`[TTS] no local voice for ${lang}`);
    onMissing?.(lang);
  }
}

async function routeUtterance(
  text: string,
  lang: string,
  onMissing: ((lang: string) => void) | undefined,
  generation: number,
): Promise<void> {
  const base = lang.split('-')[0];
  if (speechPreferences.useCloudVoices && cloudAvailable()) {
    try {
      await speakWithCloud(text, base);
      return;
    } catch (error) {
      if (!ownsUtterance(generation)) return;
      if (error instanceof Error && error.name === 'AbortError') return;
      console.warn('[TTS] Cloud failed, falling back to local:', error instanceof Error ? error.message : String(error));
    }
  }

  if (ownsUtterance(generation)) {
    await runLocal(text, lang, onMissing, generation);
  }
}

// Tier order: cloud → native → Piper neural → eSpeak → onMissing.
export function speak(
  text: string,
  lang: string,
  onMissing?: (lang: string) => void,
): void {
  if (!text || !speechPreferences.audioEnabled || typeof window === 'undefined') return;

  const generation = ++utteranceGeneration;
  cancelSpeechResources();
  void routeUtterance(text, lang, onMissing, generation).catch(error => {
    if (ownsUtterance(generation)) {
      console.error('[TTS] Speech failed:', error instanceof Error ? error.message : error);
    }
  });
}
