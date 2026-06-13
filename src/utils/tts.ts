import { toast } from 'sonner';
import { speakWithEspeak, stopEspeak, hasEspeakFor, isEspeakReady } from './espeakFallback';
import { speakWithPiper, stopPiper, piperHasVoice, piperVoiceReady, preWarmPiper } from './piperFallback';

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

// ─── speak() — tier order: native → Piper neural → eSpeak-NG → onMissing ────

export function speak(
  text: string,
  lang: string,
  onMissing?: (lang: string) => void,
): void {
  if (!text || !('speechSynthesis' in window)) return;

  const run = () => {
    // Stop all engines before starting a new utterance to prevent overlap.
    window.speechSynthesis.cancel();
    stopEspeak();
    stopPiper();

    refreshVoices();
    const voice = resolveVoice(lang);

    if (!voice) {
      const base = lang.split('-')[0];

      // Tier 2: Piper neural voice (natural-sounding, ONNX/VITS, client-side)
      if (piperHasVoice(base)) {
        if (piperVoiceReady(base)) {
          // Model cached — synthesise immediately.
          void speakWithPiper(text, base, { rate: 0.9 }).catch((err: unknown) => {
            console.error('[TTS] Piper error for', base, ':', err instanceof Error ? err.message : err);
          });
        } else {
          // Model still downloading.  Ensure the download is running, then
          // bridge THIS utterance through eSpeak for instant (if robotic) audio.
          // Once the download completes, piperVoiceReady() will be true and
          // subsequent words will use Piper automatically.
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
          // Note: uk has no eSpeak support — first cold word will be silent.
          // Pre-warming on language selection is the primary mitigation.
        }
        return;
      }

      // Tier 3: eSpeak-NG offline fallback (robotic but universal)
      if (hasEspeakFor(base)) {
        maybeShowLoadingHint();
        void speakWithEspeak(text, base).then(() => {
          toast.dismiss('espeak-loading');
          console.log(`[TTS] ${lang} → eSpeak-NG (${base})`);
        }).catch((err: unknown) => {
          console.error('[TTS] eSpeak error for', base, ':', err instanceof Error ? err.message : err);
        });
      } else {
        // Tier 4: no voice at all — notify caller
        console.warn(`[TTS] no native, Piper, or eSpeak voice for ${lang}`);
        onMissing?.(lang);
      }
      return;
    }

    // Tier 1: native browser voice (primary — best quality, instant)
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
