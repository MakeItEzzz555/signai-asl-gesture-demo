/**
 * cloudTts.ts — Cloud TTS via Google Cloud Text-to-Speech (Tier 1)
 *
 * The browser calls /api/tts (a serverless proxy) — never Google directly.
 * The API key lives in GOOGLE_TTS_API_KEY on the server; it is never
 * exposed to the client or bundled into the build.
 *
 * VOICE MAP
 * Keyed by ISO 639-1 code.  For each language we select the highest-quality
 * available voice tier: Neural2 > WaveNet > Standard.
 *
 *   el-GR uses Chirp3-HD — the only quality option Google offers for Greek.
 *   ar uses ar-XA (Google's internal code for Modern Standard Arabic;
 *       ar-SA is not a supported Google TTS locale).
 *   Norwegian uses nb-NO (Bokmål), matching LANGUAGE_BCP47.
 *
 * Voice names can be verified and updated in the Google Cloud console:
 *   https://cloud.google.com/text-to-speech/docs/list-voices-and-types
 *
 * AVAILABILITY
 * cloudAvailable() returns true by default (optimistic).  After a 503
 * "not configured" response it returns false permanently for the session —
 * subsequent calls route directly to Piper/eSpeak without a network round-trip.
 * Other errors (transient network failures) do not disable the cloud path.
 *
 * CANCELLATION
 * stopCloud() aborts any in-flight fetch and pauses any playing audio.
 * Call it before every new utterance (tts.ts does this automatically).
 */

// ─── Voice map (ISO 639-1 → Google TTS voice) ────────────────────────────────

interface CloudVoice {
  languageCode: string;
  voiceName: string;
}

const CLOUD_VOICE_MAP: Record<string, CloudVoice> = {
  en: { languageCode: 'en-US', voiceName: 'en-US-Neural2-F' },
  el: { languageCode: 'el-GR', voiceName: 'el-GR-Chirp3-HD-Aoede' }, // Chirp3-HD; only quality option for Greek
  es: { languageCode: 'es-ES', voiceName: 'es-ES-Neural2-A' },
  fr: { languageCode: 'fr-FR', voiceName: 'fr-FR-Neural2-A' },
  de: { languageCode: 'de-DE', voiceName: 'de-DE-Neural2-A' },
  ar: { languageCode: 'ar-XA', voiceName: 'ar-XA-Wavenet-B' },  // Google uses ar-XA, not ar-SA
  ru: { languageCode: 'ru-RU', voiceName: 'ru-RU-Wavenet-A' },
  zh: { languageCode: 'zh-CN', voiceName: 'zh-CN-Neural2-A' },
  pt: { languageCode: 'pt-PT', voiceName: 'pt-PT-Wavenet-A' },
  tr: { languageCode: 'tr-TR', voiceName: 'tr-TR-Standard-A' },
  it: { languageCode: 'it-IT', voiceName: 'it-IT-Neural2-A' },
  ja: { languageCode: 'ja-JP', voiceName: 'ja-JP-Neural2-B' },
  ko: { languageCode: 'ko-KR', voiceName: 'ko-KR-Neural2-A' },
  hi: { languageCode: 'hi-IN', voiceName: 'hi-IN-Neural2-A' },
  nl: { languageCode: 'nl-NL', voiceName: 'nl-NL-Wavenet-A' },
  pl: { languageCode: 'pl-PL', voiceName: 'pl-PL-Wavenet-A' },
  sv: { languageCode: 'sv-SE', voiceName: 'sv-SE-Wavenet-A' },
  no: { languageCode: 'nb-NO', voiceName: 'nb-NO-Neural2-F' },
  da: { languageCode: 'da-DK', voiceName: 'da-DK-Neural2-F' },
  fi: { languageCode: 'fi-FI', voiceName: 'fi-FI-Standard-A' },
  ro: { languageCode: 'ro-RO', voiceName: 'ro-RO-Standard-A' },
  cs: { languageCode: 'cs-CZ', voiceName: 'cs-CZ-Wavenet-A' },
  uk: { languageCode: 'uk-UA', voiceName: 'uk-UA-Standard-A' },
  id: { languageCode: 'id-ID', voiceName: 'id-ID-Wavenet-A' },
  th: { languageCode: 'th-TH', voiceName: 'th-TH-Neural2-C' },
  vi: { languageCode: 'vi-VN', voiceName: 'vi-VN-Wavenet-A' },
};

// ─── Module state ─────────────────────────────────────────────────────────────

type CloudState = 'unknown' | 'available' | 'unavailable';
let cloudState: CloudState = 'unknown';

let activeController: AbortController | null = null;
let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;

// ─── Public — availability ────────────────────────────────────────────────────

/**
 * False only after a 503 "proxy not configured" response — i.e. the server
 * env key is definitely absent.  Returns true otherwise (optimistic).
 */
export function cloudAvailable(): boolean {
  return cloudState !== 'unavailable';
}

// ─── Public — playback control ────────────────────────────────────────────────

/** Abort any in-flight fetch and stop any cloud audio currently playing. */
export function stopCloud(): void {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio = null;
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

// ─── Public — synthesis ───────────────────────────────────────────────────────

/**
 * Synthesize `text` via Google Cloud TTS and play it.
 * Throws on failure (including AbortError on deliberate cancellation).
 * Callers should catch AbortError separately and not fall back on cancel.
 */
export async function speakWithCloud(
  text: string,
  langCode: string,
): Promise<void> {
  const voice = CLOUD_VOICE_MAP[langCode];
  if (!voice) throw new Error(`[Cloud] No voice configured for "${langCode}"`);

  const controller = new AbortController();
  activeController = controller;
  const { signal } = controller;

  let response: Response;
  try {
    response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        languageCode: voice.languageCode,
        voiceName: voice.voiceName,
      }),
      signal,
    });
  } catch (err) {
    activeController = null;
    throw err; // includes AbortError
  }

  activeController = null;

  if (response.status === 503) {
    cloudState = 'unavailable';
    console.warn('[Cloud] TTS proxy not configured — GOOGLE_TTS_API_KEY not set on server');
    throw new Error('Cloud TTS not configured');
  }

  if (!response.ok) {
    throw new Error(`[Cloud] TTS error ${response.status}`);
  }

  cloudState = 'available';

  const buffer = await response.arrayBuffer();
  if (signal.aborted) return;

  const blob = new Blob([buffer], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);

  stopCloud(); // clean up any previous audio

  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(url);
    activeAudio = audio;
    activeObjectUrl = url;

    audio.onended = () => {
      if (activeAudio === audio) activeAudio = null;
      URL.revokeObjectURL(url);
      if (activeObjectUrl === url) activeObjectUrl = null;
      console.log(`[Cloud] ${langCode} → ${voice.voiceName} done`);
      resolve();
    };

    audio.onerror = () => {
      if (activeAudio === audio) activeAudio = null;
      URL.revokeObjectURL(url);
      if (activeObjectUrl === url) activeObjectUrl = null;
      reject(new Error('[Cloud] Audio playback error'));
    };

    console.log(`[Cloud] ${langCode} → ${voice.voiceName}`);
    audio.play().catch(err => {
      if (activeAudio === audio) activeAudio = null;
      URL.revokeObjectURL(url);
      if (activeObjectUrl === url) activeObjectUrl = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
