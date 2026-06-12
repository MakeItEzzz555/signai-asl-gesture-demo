import { toast } from 'sonner';
import { speakWithEspeak, stopEspeak, hasEspeakFor, isEspeakReady } from './espeakFallback';

// ─── Native voice cache ───────────────────────────────────────────────────────

let cachedVoices: SpeechSynthesisVoice[] = [];

function refreshVoices(): void {
  if (!('speechSynthesis' in window)) return;
  const v = window.speechSynthesis.getVoices();
  if (v.length) cachedVoices = v;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
  // No { once: true } — Chrome streams voices across several events
  window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function preWarmVoices(): void { refreshVoices(); }

const norm = (t: string) => t.toLowerCase().replace(/_/g, '-');

export function resolveVoice(lang: string): SpeechSynthesisVoice | null {
  const want = norm(lang);
  const base = want.split('-')[0];
  return (
    cachedVoices.find(v => norm(v.lang) === want) ??
    cachedVoices.find(v => norm(v.lang).split('-')[0] === base) ??
    null
  );
}

export function hasVoiceFor(lang: string): boolean {
  return resolveVoice(lang) !== null;
}

// ─── eSpeak loading toast (shown at most once per session) ────────────────────

let espeakLoadingToastShown = false;

function maybeShowLoadingHint(): void {
  if (isEspeakReady() || espeakLoadingToastShown) return;
  espeakLoadingToastShown = true;
  toast.info('Loading offline speech engine for the first time (~2.5 MB)…', {
    duration: 5000,
    id: 'espeak-loading',
  });
}

// ─── speak() — tier order: native → eSpeak-NG → onMissing ────────────────────

export function speak(
  text: string,
  lang: string,
  onMissing?: (lang: string) => void,
): void {
  if (!text || !('speechSynthesis' in window)) return;

  const run = () => {
    window.speechSynthesis.cancel();
    stopEspeak();

    refreshVoices();
    const voice = resolveVoice(lang);

    if (!voice) {
      // Tier 2: eSpeak-NG offline fallback
      const base = lang.split('-')[0];
      if (hasEspeakFor(base)) {
        maybeShowLoadingHint();
        void speakWithEspeak(text, base).then(() => {
          // Dismiss the loading hint once audio actually starts playing
          toast.dismiss('espeak-loading');
          console.log(`[TTS] ${lang} → eSpeak-NG (${base})`);
        }).catch((err: unknown) => {
          console.error('[TTS] eSpeak error for', base, ':', err instanceof Error ? err.message : err);
        });
      } else {
        // Tier 3: no voice at all — notify caller
        console.warn(`[TTS] no native or eSpeak voice for ${lang}`);
        onMissing?.(lang);
      }
      return;
    }

    // Tier 1: native browser voice (primary — best quality)
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.9;
    u.pitch = 1;
    u.volume = 1;
    console.log(`[TTS] ${lang} → ${voice.name} (${voice.lang})`);
    window.speechSynthesis.speak(u);
  };

  if (cachedVoices.length === 0) {
    // Defer until voices stream in; fall through after 300 ms regardless
    const onChange = () => {
      refreshVoices();
      if (cachedVoices.length) {
        window.speechSynthesis.removeEventListener('voiceschanged', onChange);
        run();
      }
    };
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    setTimeout(onChange, 300);
  } else {
    run();
  }
}
