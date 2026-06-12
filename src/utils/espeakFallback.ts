/**
 * espeakFallback.ts — Offline TTS via eSpeak-NG WASM (steveseguin build 1.49.1)
 *
 * Uses steveseguin/espeakng.js: a browser-native Web Worker + WASM build that
 * outputs Float32Array PCM, played through the Web Audio API.
 *
 * Files served from /espeak/ (public/espeak/):
 *   espeakng-simple.js  — main JS API (~8 KB, injected as a script tag)
 *   espeakng.worker.js  — compiled eSpeak-NG WASM worker (~776 KB)
 *   espeakng.worker.data — all voice data (~2.5 MB, fetched by the worker)
 *
 * LICENSE NOTE: eSpeak-NG is GPL v3. See repo-level report for implications.
 */

// ─── Minimal interface for the dynamically loaded SimpleTTS ──────────────────

interface SimpleTTSInstance {
  onReady(cb: (err?: Error) => void): void;
  speak(
    text: string,
    opts: { voice?: string; rate?: number; pitch?: number },
    cb: (audioData: Float32Array | null, sampleRate?: number) => void,
  ): void;
}

// ─── Language map — app LanguageCode → eSpeak voice id ───────────────────────
//
// Verified against the actual binary (espeakng.worker.data, build 1.49.1):
//   null  = voice not present in this build (he, uk)
//   other = exact voice identifier to pass to SimpleTTS.speak()
//
// Non-obvious mappings confirmed by binary scan:
//   zh → 'zh'  (this build predates the cmn rename)
//   no → 'no'  (Norwegian Bokmål; eSpeak uses 'no', not 'nb', in 1.49.x)
const VOICE_MAP: Record<string, string | null> = {
  en: 'en', el: 'el', es: 'es', fr: 'fr', de: 'de',
  ar: 'ar', he: null, ru: 'ru', zh: 'zh', pt: 'pt',
  tr: 'tr', it: 'it', ja: 'ja', ko: 'ko', hi: 'hi',
  nl: 'nl', pl: 'pl', sv: 'sv', no: 'no', da: 'da',
  fi: 'fi', ro: 'ro', cs: 'cs', uk: null, id: 'id',
  th: 'th', vi: 'vi',
};

// ─── Singleton state ──────────────────────────────────────────────────────────

let instance: SimpleTTSInstance | null = null;
let initPromise: Promise<void> | null = null;
let initFailed = false;

let audioCtx: AudioContext | null = null;
let activeSource: AudioBufferSourceNode | null = null;

// ─── Public: language support check ──────────────────────────────────────────

/** True when this eSpeak build contains a voice for the given ISO 639-1 code. */
export function hasEspeakFor(lang: string): boolean {
  return VOICE_MAP[lang] !== null && VOICE_MAP[lang] !== undefined;
}

/** True once the worker has finished loading and is ready to synthesize. */
export function isEspeakReady(): boolean {
  return instance !== null;
}

// ─── Public: stop current playback ───────────────────────────────────────────

export function stopEspeak(): void {
  if (!activeSource) return;
  try { activeSource.stop(); } catch { /* already stopped */ }
  try { activeSource.disconnect(); } catch { /* already disconnected */ }
  activeSource = null;
}

// ─── Private: AudioContext ────────────────────────────────────────────────────

function getAudioCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

// ─── Private: lazy singleton init ────────────────────────────────────────────

async function ensureInit(): Promise<void> {
  if (instance) return;
  if (initFailed) throw new Error('eSpeak-NG init previously failed — not retrying');
  if (initPromise) return initPromise;

  initPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      initFailed = true;
      reject(new Error('eSpeak-NG requires a browser environment'));
      return;
    }

    const boot = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tts = new (window as any).SimpleTTS({
        workerPath: '/espeak/espeakng.worker.js',
      }) as SimpleTTSInstance;

      tts.onReady((err) => {
        if (err) {
          initFailed = true;
          reject(err);
        } else {
          instance = tts;
          console.log('[eSpeak] worker ready');
          resolve();
        }
      });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).SimpleTTS) {
      boot();
      return;
    }

    const script = document.createElement('script');
    script.src = '/espeak/espeakng-simple.js';
    script.onerror = () => {
      initFailed = true;
      reject(new Error('Failed to load /espeak/espeakng-simple.js'));
    };
    script.onload = boot;
    document.head.appendChild(script);
  });

  return initPromise;
}

// ─── Public: synthesize and play ─────────────────────────────────────────────

/**
 * Synthesize `text` in the given ISO 639-1 `langCode` using eSpeak-NG and
 * play it through the Web Audio API. Rejects if the language has no eSpeak
 * voice in this build — callers should check hasEspeakFor() first.
 *
 * @param opts.rate  eSpeak WPM (80–450). Default 157 ≈ native rate×0.9.
 */
export async function speakWithEspeak(
  text: string,
  langCode: string,
  opts?: { rate?: number },
): Promise<void> {
  const espeakVoice = VOICE_MAP[langCode];
  if (!espeakVoice) {
    throw new Error(`No eSpeak voice for "${langCode}" in this build`);
  }

  await ensureInit();

  return new Promise<void>((resolve, reject) => {
    stopEspeak();

    instance!.speak(
      text,
      { voice: espeakVoice, rate: opts?.rate ?? 157, pitch: 50 },
      (audioData: Float32Array | null, sampleRate?: number) => {
        if (!audioData || audioData.length === 0 || !sampleRate) {
          reject(new Error('eSpeak returned empty audio'));
          return;
        }
        try {
          const ctx = getAudioCtx();
          const buffer = ctx.createBuffer(1, audioData.length, sampleRate);
          buffer.getChannelData(0).set(audioData);

          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          src.onended = () => {
            if (activeSource === src) activeSource = null;
            resolve();
          };
          activeSource = src;
          src.start();
          console.log(`[eSpeak] ${langCode} → ${espeakVoice}, ${audioData.length} samples @ ${sampleRate} Hz`);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
    );
  });
}
