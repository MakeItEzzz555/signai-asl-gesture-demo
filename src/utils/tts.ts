import { toast } from 'sonner';
import { speakWithEspeak, stopEspeak, hasEspeakFor, isEspeakReady } from './espeakFallback';
import { speakWithPiper, stopPiper, piperHasVoice, piperVoiceReady, preWarmPiper } from './piperFallback';
import { speakWithCloud, stopCloud, cloudAvailable } from './cloudTts';

// ─── Cloud voices preference (set by AppContext on every useCloudTts change) ──

let useCloudVoices = false;

export function setCloudVoicesEnabled(enabled: boolean): void {
  useCloudVoices = enabled;
}

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

// ─── eSpeak loading toast (shown at most once per session) ───────────────────

let espeakLoadingToastShown = false;

function maybeShowLoadingHint(): void {
  if (isEspeakReady() || espeakLoadingToastShown) return;
  espeakLoadingToastShown = true;
  toast.info('Loading offline speech engine for the first time (~2.5 MB)…', {
    duration: 5000,
    id: 'espeak-loading',
  });
}

// ─── speak() — tier order: cloud → native → Piper neural → eSpeak → onMissing

export function speak(
  text: string,
  lang: string,
  onMissing?: (lang: string) => void,
): void {
  if (!text || !('speechSynthesis' in window)) return;

  const run = () => {
    // Stop every engine before starting a new utterance to prevent overlap.
    // stopCloud() aborts in-flight fetch but does NOT affect Piper downloads.
    stopCloud();
    window.speechSynthesis.cancel();
    stopEspeak();
    stopPiper();

    const base = lang.split('-')[0];

    // Tier 1: Cloud TTS — Google-quality neural voices for all 26 languages.
    // Falls through to local tiers on any error; AbortError (deliberate cancel)
    // is swallowed silently.
    if (useCloudVoices && cloudAvailable()) {
      void speakWithCloud(text, base)
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.warn('[TTS] Cloud failed, falling back to local:', err instanceof Error ? err.message : String(err));
          runLocal();
        });
      return;
    }

    runLocal();
  };

  const runLocal = () => {
    refreshVoices();
    const voice = resolveVoice(lang);

    if (!voice) {
      const base = lang.split('-')[0];

      // Tier 2: Piper neural voice (natural-sounding, ONNX/VITS, client-side)
      if (piperHasVoice(base)) {
        if (piperVoiceReady(base)) {
          void speakWithPiper(text, base, { rate: 0.9 }).catch((err: unknown) => {
            console.error('[TTS] Piper error for', base, ':', err instanceof Error ? err.message : err);
          });
        } else {
          // Model still downloading.  Kick off the download, bridge with eSpeak.
          void preWarmPiper(base).catch(() => {});
          if (hasEspeakFor(base)) {
            maybeShowLoadingHint();
            void speakWithEspeak(text, base).then(() => {
              toast.dismiss('espeak-loading');
              console.log(`[TTS] ${lang} → eSpeak-NG (Piper loading, bridge) (${base})`);
            }).catch((err: unknown) => {
              console.error('[TTS] eSpeak bridge error for', base, ':', err instanceof Error ? err.message : err);
            });
          }
        }
        return;
      }

      // Tier 3: eSpeak-NG offline fallback
      if (hasEspeakFor(base)) {
        maybeShowLoadingHint();
        void speakWithEspeak(text, base).then(() => {
          toast.dismiss('espeak-loading');
          console.log(`[TTS] ${lang} → eSpeak-NG (${base})`);
        }).catch((err: unknown) => {
          console.error('[TTS] eSpeak error for', base, ':', err instanceof Error ? err.message : err);
        });
      } else {
        // Tier 4: no local voice — notify caller
        console.warn(`[TTS] no local voice for ${lang}`);
        onMissing?.(lang);
      }
      return;
    }

    // Tier 2 (native): browser has a native voice for this locale — use it.
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
