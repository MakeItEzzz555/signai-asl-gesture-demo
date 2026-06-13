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
 * VOICE CATALOG — verified against VoiceId type in package@1.0.4
 * Preferred quality: medium → low → x_low (medium not available for el/it).
 *
 * Supported (22 of 27):
 *   en, es, fr, de, ar, ru, zh, pt, tr, nl, pl, sv, no, da, fi, ro, cs,
 *   uk, vi  → medium (~63 MB each)
 *   el       → low    (~30 MB)   — medium absent from catalog
 *   it       → x_low (~10 MB)   — medium absent from catalog
 *
 * Unsupported → fall through to eSpeak tier (5 of 27):
 *   ja, ko, hi, id, th
 *
 * No voice at all → onMissing (1 of 27):
 *   he  (neither Piper nor eSpeak supports Hebrew in this build)
 *
 * LICENSE NOTE: @mintplex-labs/piper-tts-web is MIT.  However, the bundled
 * piper-phonemize WASM uses espeak-ng for phonemisation, which is GPL v3.
 * The GPL surface therefore persists even with this Piper tier — it is
 * embedded in the WASM artifact rather than in a separate binary.
 * The eSpeak-NG WASM fallback also remains GPL v3.
 * A maintainer decision is required before distributing this app under a
 * non-GPL-compatible licence.  Removing eSpeak entirely (once every
 * language is covered by Piper) would not eliminate the GPL exposure
 * because it is embedded inside the piper-phonemize WASM.
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
  ar: 'ar_JO-kareem-medium',
  ru: 'ru_RU-irina-medium',
  zh: 'zh_CN-huayan-medium',
  pt: 'pt_PT-tugão-medium',
  tr: 'tr_TR-dfki-medium',
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

// Incremented by stopPiper() and on every new speakWithPiper() call so
// any in-flight synthesis that was superseded silently exits.
let piperGeneration = 0;

const sessions   = new Map<string, TtsSession>();
const sessionInits = new Map<string, Promise<TtsSession>>();

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
  if (voiceId.endsWith('-medium')) return '~63 MB';
  if (voiceId.endsWith('-low'))    return '~30 MB';
  return '~10 MB'; // x_low / high
}

// ─── Public exports ───────────────────────────────────────────────────────────

/** True when a Piper neural voice exists for the given ISO 639-1 code. */
export function piperHasVoice(langCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(PIPER_VOICE_MAP, langCode);
}

/**
 * Stop any Piper audio currently playing and invalidate any in-flight
 * synthesis (its result will be discarded when it eventually resolves).
 * Call before every new utterance to prevent cross-engine overlap.
 */
export function stopPiper(): void {
  piperGeneration++;
  if (!activeSource) return;
  try { activeSource.stop(); }       catch { /* already stopped */ }
  try { activeSource.disconnect(); } catch { /* already disconnected */ }
  activeSource = null;
}

// ─── Session management ───────────────────────────────────────────────────────

async function getSession(langCode: string): Promise<TtsSession> {
  const voiceId = PIPER_VOICE_MAP[langCode];
  if (!voiceId) throw new Error(`[Piper] No voice for "${langCode}"`);

  const cached = sessions.get(langCode);
  if (cached) return cached;

  const existing = sessionInits.get(langCode);
  if (existing) return existing;

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
      sessions.set(langCode, session);
      sessionInits.delete(langCode);
      if (downloading) toast.dismiss(`piper-dl-${langCode}`);
      console.log(`[Piper] ${langCode} → ${voiceId} session ready`);
      return session;
    })
    .catch(err => {
      sessionInits.delete(langCode);
      if (downloading) toast.dismiss(`piper-dl-${langCode}`);
      throw err;
    });

  sessionInits.set(langCode, promise);
  return promise;
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

/**
 * Synthesize `text` using the Piper neural voice for `langCode` and play it
 * via the Web Audio API.  Resolves when playback ends or the call is
 * superseded by a newer stopPiper() / speakWithPiper() call.
 *
 * @param opts.rate  Web Audio playbackRate (1.0 = normal).  Default 0.9.
 */
export async function speakWithPiper(
  text: string,
  langCode: string,
  opts?: { rate?: number },
): Promise<void> {
  // Tag this call; if generation changes before we start audio, bail out.
  const gen = ++piperGeneration;

  const session = await getSession(langCode);
  if (piperGeneration !== gen) return;

  const blob = await session.predict(text);
  if (piperGeneration !== gen) return;

  const arrayBuffer = await blob.arrayBuffer();
  if (piperGeneration !== gen) return;

  const ctx = getAudioCtx();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  if (piperGeneration !== gen) return;

  // Stop any audio that arrived between our last check and now (synchronous
  // from here — no more awaits before src.start(), so no further race).
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
      `[Piper] ${langCode} → ${PIPER_VOICE_MAP[langCode]}, ` +
      `${audioBuffer.duration.toFixed(2)}s`,
    );
  });
}
