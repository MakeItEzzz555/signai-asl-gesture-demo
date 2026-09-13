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
 *   el-GR uses el-GR-Wavenet-A — WaveNet is confirmed for Greek; Chirp3-HD
 *       speaker names are not reliably available for el-GR.
 *   ar uses ar-XA (Google's internal code for Modern Standard Arabic;
 *       ar-SA is not a supported Google TTS locale).
 *   Norwegian uses nb-NO (Bokmål), matching LANGUAGE_BCP47.
 *
 * SAFETY NET
 * The /api/tts proxy retries with voiceName omitted (locale-default) if
 * Google returns 400 for a named voice.  This means a stale name here
 * degrades gracefully to Google's default for that locale — never to local.
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

import { CLOUD_VOICE_MAP } from '../../shared/ttsVoices';

// ─── Module state ─────────────────────────────────────────────────────────────

type CloudState = 'unknown' | 'available' | 'unavailable';
let cloudState: CloudState = 'unknown';

interface CloudOperation {
  controller: AbortController | null;
  audio: HTMLAudioElement | null;
  objectUrl: string | null;
  cancel: (() => void) | null;
}

let activeOperation: CloudOperation | null = null;

function abortError(): Error {
  const error = new Error('Cloud speech cancelled');
  error.name = 'AbortError';
  return error;
}

function releaseOperation(operation: CloudOperation, stopAudio: boolean): void {
  if (stopAudio && operation.audio) {
    operation.audio.onended = null;
    operation.audio.onerror = null;
    operation.audio.pause();
    operation.audio.src = '';
  }
  operation.audio = null;
  if (operation.objectUrl) {
    URL.revokeObjectURL(operation.objectUrl);
    operation.objectUrl = null;
  }
  if (activeOperation === operation) activeOperation = null;
}

function awaitOwned<T>(operation: CloudOperation, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    operation.cancel = () => reject(abortError());
    promise.then(resolve, reject);
  });
}

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
  const operation = activeOperation;
  if (!operation) return;
  activeOperation = null;
  operation.controller?.abort();
  operation.controller = null;
  const cancel = operation.cancel;
  operation.cancel = null;
  releaseOperation(operation, true);
  cancel?.();
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

  stopCloud();
  const controller = new AbortController();
  const operation: CloudOperation = {
    controller,
    audio: null,
    objectUrl: null,
    cancel: null,
  };
  activeOperation = operation;
  const { signal } = controller;

  let response: Response;
  try {
    response = await awaitOwned(operation, fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        languageCode: voice.languageCode,
        voiceName: voice.voiceName,
      }),
      signal,
    }));
  } catch (err) {
    if (activeOperation === operation) activeOperation = null;
    operation.controller = null;
    throw err; // includes AbortError
  }

  operation.controller = null;
  operation.cancel = null;
  if (activeOperation !== operation || signal.aborted) throw abortError();

  if (response.status === 503) {
    const error = await response.clone().json().catch(() => null) as { code?: unknown; error?: unknown } | null;
    if (error?.code === 'TTS_NOT_CONFIGURED' || error?.error === 'TTS proxy not configured') cloudState = 'unavailable';
    releaseOperation(operation, false);
    throw new Error(typeof error?.error === 'string' ? error.error : 'Cloud TTS temporarily unavailable');
  }

  if (!response.ok) {
    releaseOperation(operation, false);
    throw new Error(`[Cloud] TTS error ${response.status}`);
  }

  cloudState = 'available';

  let buffer: ArrayBuffer;
  try {
    buffer = await awaitOwned(operation, response.arrayBuffer());
  } catch (error) {
    releaseOperation(operation, false);
    throw error;
  }
  operation.cancel = null;
  if (activeOperation !== operation || signal.aborted) throw abortError();

  const blob = new Blob([buffer], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  operation.objectUrl = url;

  return new Promise<void>((resolve, reject) => {
    let audio: HTMLAudioElement;
    try {
      audio = new Audio(url);
    } catch (error) {
      releaseOperation(operation, false);
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    operation.audio = audio;
    // Once audio exists, cancellation stops it and resolves playback.
    operation.cancel = resolve;

    audio.onended = () => {
      if (activeOperation !== operation) return;
      operation.cancel = null;
      releaseOperation(operation, false);
      console.log(`[Cloud] ${langCode} → ${voice.voiceName} done`);
      resolve();
    };

    audio.onerror = () => {
      if (activeOperation !== operation) return;
      operation.cancel = null;
      releaseOperation(operation, false);
      reject(new Error('[Cloud] Audio playback error'));
    };

    console.log(`[Cloud] ${langCode} → ${voice.voiceName}`);
    audio.play().catch(err => {
      if (activeOperation !== operation) return;
      operation.cancel = null;
      releaseOperation(operation, false);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
