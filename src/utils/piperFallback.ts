/**
 * piperFallback.ts — Neural TTS via Piper VITS/ONNX (Tier 2 in speak())
 *
 * Uses @mintplex-labs/piper-tts-web (fork of @diffusion-studio/vits-web).
 * predict() returns a WAV Blob; we decode it with decodeAudioData and play
 * through the Web Audio API — fully client-side, no server.
 *
 * Models are fetched from the Hugging Face CDN on first use and cached in
 * the Origin Private File System (OPFS) so subsequent loads are instant.
 * ONNX Runtime WASM (v1.18.0) and piper-phonemize WASM are loaded from
 * their respective public CDNs by the library's internal worker thread.
 *
 * COLD-START FLOW
 * On language selection: preWarmPiper(lang) fires immediately, starting
 * the ~63 MB model download in the background.  While it downloads,
 * piperVoiceReady(lang) returns false and tts.ts bridges through eSpeak
 * for instant (if robotic) audio.  Once the download completes,
 * piperVoiceReady returns true and subsequent words use Piper.
 *
 * CANCELLATION SEMANTICS
 * stopPiper() stops audio playback and invalidates pending *synthesis*
 * (predict/decode), but does NOT abort any in-progress model download.
 * The session-init Promise always runs to completion and caches its
 * result in OPFS — piperGeneration only guards the post-session synthesis
 * stage, not the download stage.
 *
 * MEMORY BOUNDING
 * Only one TtsSession is kept in memory at a time (the library enforces
 * this via an internal singleton).  Switching languages resets the
 * singleton and loads the new language's model from OPFS (fast) or the
 * network (first use only).  Models stay in OPFS across sessions.
 *
 * SINGLETON FIX
 * TtsSession.create() reuses its internal _instance when called a second
 * time, only updating the voiceId string — NOT the ONNX model or the
 * model config (which contains the espeak.voice used for phonemization).
 * Before creating a session for a new language we reset _instance to null
 * so the constructor runs a full init(): correct model + correct espeak
 * phoneme language (es→es, el→el, etc.).  Sessions are serialized (one
 * create at a time) to avoid concurrent calls on the singleton.
 *
 * VOICE CATALOG — verified against VoiceId type in package@1.0.4
 * Preferred quality: medium → low → x_low (medium not available for el/it).
 *
 * Supported (22 of 27):
 *   en, es, fr, de, ar, ru, zh, pt, nl, pl, sv, no, da, fi, ro, cs,
 *   uk, vi  → medium (~63 MB each)
 *   tr       → medium (~63 MB) — switched to fettah; dfki had phoneme issues
 *   el       → low    (~30 MB) — medium absent from catalog
 *   it       → x_low (~10 MB) — medium absent from catalog
 *
 * Unsupported → fall through to eSpeak tier (5 of 27):
 *   ja, ko, hi, id, th
 *
 * No voice at all → onMissing (1 of 27):
 *   he  (neither Piper nor eSpeak supports Hebrew in this build)
 *
 * DIALECT NOTES
 *   pt → pt_PT-tugão-medium (European Portuguese).  LANGUAGE_BCP47 maps
 *        pt→'pt-PT'; voice, locale, and translations are now consistent.
 *   tr → tr_TR-fettah-medium replaces tr_TR-dfki-medium.  The DFKI voice
 *        (from a German research lab) produced noticeably stiffer phoneme
 *        boundaries on Turkish consonant clusters; fettah is more natural.
 *   ar → ar_JO-kareem-medium (Jordanian Arabic).  No ar_SA Piper voice
 *        exists; Jordanian Arabic is mutually intelligible.
 *
 * LICENSE NOTE: @mintplex-labs/piper-tts-web is MIT.  However, the bundled
 * piper-phonemize WASM uses espeak-ng for phonemisation, which is GPL v3.
 * The GPL surface therefore persists even with this Piper tier.
 * A maintainer decision is required before distributing this app under a
 * non-GPL-compatible licence.
 */

import { TtsSession, type VoiceId, type Progress } from '@mintplex-labs/piper-tts-web';
import { toast } from 'sonner';
import { LANGUAGES } from '@/i18n/translations';

// ─── Voice map (ISO 639-1 → Piper voiceId) ───────────────────────────────────
// Languages absent from this object fall through to eSpeak (or onMissing).

const PIPER_VOICE_MAP: Record<string, VoiceId> = {
  en: 'en_US-hfc_female-medium',
  el: 'el_GR-rapunzelina-low',      // medium not in catalog
  es: 'es_ES-davefx-medium',
  fr: 'fr_FR-siwis-medium',
  de: 'de_DE-thorsten-medium',
  ar: 'ar_JO-kareem-medium',        // no ar_SA in catalog; JO is mutually intelligible
  ru: 'ru_RU-irina-medium',
  zh: 'zh_CN-huayan-medium',
  pt: 'pt_PT-tugão-medium',         // European Portuguese — matches LANGUAGE_BCP47 pt-PT
  tr: 'tr_TR-fettah-medium',        // was tr_TR-dfki-medium; see DIALECT NOTES
  it: 'it_IT-riccardo-x_low',       // medium not in catalog
  nl: 'nl_NL-mls-medium',
  pl: 'pl_PL-gosia-medium',
  sv: 'sv_SE-nst-medium',
  no: 'no_NO-talesyntese-medium',
  da: 'da_DK-talesyntese-medium',
  fi: 'fi_FI-harri-medium',
  ro: 'ro_RO-mihai-medium',
  cs: 'cs_CZ-jirka-medium',
  uk: 'uk_UA-ukrainian_tts-medium',
  vi: 'vi_VN-vais1000-medium',
  // he: no Piper voice; no eSpeak voice either → onMissing(lang)
  // ja, ko, hi, id, th: no Piper voice → eSpeak tier
};

// ─── Module state ─────────────────────────────────────────────────────────────

// Incremented by stopPiper() and on every speakWithPiper() entry.
// Guards the POST-SESSION synthesis chain only — never the session download.
let piperGeneration = 0;

// The single in-memory TtsSession (library enforces singleton internally).
let activeSession: TtsSession | null = null;

// ISO 639-1 code of the language whose model is currently loaded.
let activeLangCode: string | null = null;

// In-flight TtsSession.create() — at most one at a time to avoid concurrent
// calls on the library's singleton.  Always runs to completion (OPFS cache).
let pendingInit: { lang: string; promise: Promise<TtsSession> } | null = null;

let activeSource: AudioBufferSourceNode | null = null;
let audioCtx: AudioContext | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAudioCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function nativeName(code: string): string {
  return LANGUAGES.find(l => l.code === code)?.nativeName ?? code;
}

function sizeHint(voiceId: VoiceId): string {
  if ((voiceId as string).endsWith('-medium')) return '~63 MB';
  if ((voiceId as string).endsWith('-low'))    return '~30 MB';
  return '~10 MB'; // x_low
}

// ─── Public — language checks ─────────────────────────────────────────────────

/** True when a Piper neural voice exists for the given ISO 639-1 code. */
export function piperHasVoice(langCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(PIPER_VOICE_MAP, langCode);
}

/**
 * True when the TtsSession for `langCode` is the currently-loaded model —
 * i.e. speakWithPiper() will proceed without waiting on a download or reload.
 * Returns false while the initial model download is still in progress, or
 * when a different language's model is currently active in the singleton.
 */
export function piperVoiceReady(langCode: string): boolean {
  return activeLangCode === langCode && activeSession !== null;
}

// ─── Public — playback control ────────────────────────────────────────────────

/**
 * Stop any Piper audio currently playing and invalidate any pending synthesis
 * (predict/decode/play) so stale results are silently discarded.
 *
 * This does NOT interrupt an in-progress model download — the pendingInit
 * Promise always runs to completion so the result is cached in OPFS.
 */
export function stopPiper(): void {
  piperGeneration++;
  if (!activeSource) return;
  try { activeSource.stop(); }       catch { /* already stopped */ }
  try { activeSource.disconnect(); } catch { /* already disconnected */ }
  activeSource = null;
}

// ─── Public — pre-warming ─────────────────────────────────────────────────────

/**
 * Start (or wait for) the TtsSession init for `langCode` without synthesising
 * any text.  Call this whenever the target language changes so the model is
 * ready before the user signs their first word.
 *
 * Idempotent: re-calling for the same language is a no-op once loaded.
 * Does NOT touch piperGeneration, so it never interferes with pending audio.
 */
export async function preWarmPiper(langCode: string): Promise<void> {
  if (!piperHasVoice(langCode)) return;
  try {
    await getSession(langCode);
  } catch (err) {
    console.error(`[Piper] preWarm "${langCode}" failed:`, err instanceof Error ? err.message : err);
  }
}

// ─── Private — session management ────────────────────────────────────────────

/**
 * Return the TtsSession for `langCode`, creating it if necessary.
 *
 * KEY INVARIANT: only one TtsSession.create() runs at a time (serialized via
 * pendingInit) because the library uses an internal singleton (_instance).
 * Before starting a new create we reset _instance = null so the constructor
 * runs a full init() — loading the correct ONNX model AND the correct espeak
 * phoneme language for that voice — instead of reusing the previous language's
 * model config.
 */
async function getSession(langCode: string): Promise<TtsSession> {
  const voiceId = PIPER_VOICE_MAP[langCode];
  if (!voiceId) throw new Error(`[Piper] No voice for "${langCode}"`);

  // Already the active model?
  if (activeLangCode === langCode && activeSession) return activeSession;

  // Already loading for this exact language?
  if (pendingInit?.lang === langCode) return pendingInit.promise;

  // Serialize: wait for any in-flight init to complete before resetting the
  // library singleton. The completing init caches its model in OPFS even if
  // it's for a different language — nothing is wasted.
  if (pendingInit) {
    try { await pendingInit.promise; } catch { /* ignore; errors handled below */ }
    // Re-check after the await — a concurrent caller might have loaded our lang.
    if (activeLangCode === langCode && activeSession) return activeSession;
    if (pendingInit?.lang === langCode) return pendingInit.promise;
  }

  // Reset the library's internal singleton so TtsSession.create() runs a
  // fresh init(): loads the correct ONNX model + espeak phoneme language
  // for `voiceId` instead of reusing the previously-active language's model.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (TtsSession as any)._instance = null;
  activeSession = null;
  activeLangCode = langCode;

  const name  = nativeName(langCode);
  const label = sizeHint(voiceId);
  let   downloading = false;

  const promise = TtsSession.create({
    voiceId,
    progress(p: Progress) {
      const pct = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
      const msg = downloading
        ? `Downloading ${name} voice… ${pct}%`
        : `Downloading ${name} voice… ${label}`;
      downloading = true;
      toast.loading(msg, { id: `piper-dl-${langCode}`, duration: Infinity });
    },
  })
    .then(session => {
      // Only install if we're still the pending init (language hasn't changed).
      if (pendingInit?.lang === langCode) {
        activeSession = session;
        pendingInit = null;
      }
      if (downloading) toast.dismiss(`piper-dl-${langCode}`);
      console.log(
        `[Piper] ${langCode} → ${voiceId} session ready` +
        ` (espeak phonemizer: ${voiceId.split('-')[0]})`,
      );
      return session;
    })
    .catch(err => {
      if (pendingInit?.lang === langCode) {
        pendingInit = null;
        activeSession = null;
      }
      if (downloading) toast.dismiss(`piper-dl-${langCode}`);
      throw err;
    });

  pendingInit = { lang: langCode, promise };
  return promise;
}

// ─── Public — synthesis ───────────────────────────────────────────────────────

/**
 * Synthesize `text` using the Piper neural voice for `langCode` and play it
 * via the Web Audio API.  Resolves when playback ends, or exits silently if
 * this call is superseded by a newer stopPiper() or speakWithPiper() call.
 *
 * The model download (getSession) is NOT gated by piperGeneration — it always
 * runs to completion so the result is available for the next call.
 * Generation checks only apply to the predict/decode/play stages that follow.
 *
 * @param opts.rate  Web Audio playbackRate (1.0 = normal).  Default 0.9.
 */
export async function speakWithPiper(
  text: string,
  langCode: string,
  opts?: { rate?: number },
): Promise<void> {
  // Tag this synthesis call.  If generation changes before we start audio,
  // the post-session work is silently abandoned (but the session itself is
  // not affected — it stays active for the next call).
  const gen = ++piperGeneration;

  // getSession serializes language switches and resets the library singleton
  // so the correct model + phonemizer is loaded.  Always runs to completion.
  const session = await getSession(langCode);

  // From here on: bail if superseded.
  if (piperGeneration !== gen) return;

  const blob = await session.predict(text);
  if (piperGeneration !== gen) return;

  const arrayBuffer = await blob.arrayBuffer();
  if (piperGeneration !== gen) return;

  const ctx = getAudioCtx();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  if (piperGeneration !== gen) return;

  // Stop any audio that arrived between our last check and now.
  // (Synchronous from here — no more awaits before src.start().)
  if (activeSource) {
    try { activeSource.stop(); }       catch { /* already stopped */ }
    try { activeSource.disconnect(); } catch { /* already disconnected */ }
    activeSource = null;
  }

  return new Promise<void>(resolve => {
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.playbackRate.value = opts?.rate ?? 0.9;
    src.connect(ctx.destination);
    src.onended = () => {
      if (activeSource === src) activeSource = null;
      resolve();
    };
    activeSource = src;
    src.start();
    console.log(
      `[Piper] speaking ${langCode} → ${PIPER_VOICE_MAP[langCode]}, ` +
      `${audioBuffer.duration.toFixed(2)}s`,
    );
  });
}
