import type { IncomingMessage, ServerResponse } from 'node:http';
import { CLOUD_VOICE_MAP } from '../../shared/ttsVoices';

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
type Body = { text?: unknown; languageCode?: unknown; voiceName?: unknown };
type QuotaResult = { allowed: boolean; retryAfterSeconds?: number };
export type QuotaCheck = (key: string, units: number) => Promise<QuotaResult> | QuotaResult;
export interface TtsHandlerOptions {
  apiKey?: string; production?: boolean; quota?: QuotaCheck;
  clientKey?: (req: IncomingMessage) => string;
  fetchImpl?: typeof fetch; timeoutMs?: number;
}

const json = (res: ServerResponse, status: number, code: string, message: string, extra: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify({ code, error: message }));
};

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<Body> {
  if (req.body !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > 16 * 1024) throw new Error('BODY_TOO_LARGE');
    return req.body as Body;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 16 * 1024) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Body;
}

export function createMemoryQuota(limit = 30): QuotaCheck {
  const windows = new Map<string, { start: number; count: number }>();
  return (key, units) => {
    const now = Date.now(), entry = windows.get(key);
    if (!entry || now - entry.start >= 60_000) { windows.set(key, { start: now, count: units }); return { allowed: units <= limit }; }
    entry.count += units;
    return entry.count <= limit ? { allowed: true } : { allowed: false, retryAfterSeconds: Math.ceil((entry.start + 60_000 - now) / 1000) };
  };
}

export function createTtsHandler(options: TtsHandlerOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') return json(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', { Allow: 'POST' });
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'))
      return json(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    const apiKey = options.apiKey ?? process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey) return json(res, 503, 'TTS_NOT_CONFIGURED', 'TTS proxy not configured');
    if (options.production && (!options.quota || !options.clientKey)) return json(res, 503, 'TTS_PROTECTION_NOT_CONFIGURED', 'TTS protection is not configured');
    let body: Body;
    try { body = await readBody(req); }
    catch (error) {
      const tooLarge = error instanceof Error && error.message === 'BODY_TOO_LARGE';
      return json(res, tooLarge ? 413 : 400, tooLarge ? 'BODY_TOO_LARGE' : 'INVALID_JSON', 'Invalid request body');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json(res, 400, 'INVALID_REQUEST', 'Request body must be a JSON object');
    const { text, languageCode, voiceName } = body;
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text.trim(), 'utf8') > 4096 || typeof languageCode !== 'string' || typeof voiceName !== 'string')
      return json(res, 400, 'INVALID_REQUEST', 'Invalid text or voice fields');
    if (!Object.values(CLOUD_VOICE_MAP).some(voice => voice.languageCode === languageCode && voice.voiceName === voiceName))
      return json(res, 400, 'VOICE_NOT_ALLOWED', 'Unsupported language and voice combination');

    const key = options.clientKey?.(req) ?? req.socket.remoteAddress ?? 'local';
    const consumeQuota = async () => options.quota?.(key, 1) ?? { allowed: true };
    const firstQuota = await consumeQuota();
    if (!firstQuota.allowed) return json(res, 429, 'RATE_LIMITED', 'Too many TTS requests', { 'Retry-After': String(firstQuota.retryAfterSeconds ?? 60) });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    const call = (name?: string) => fetchImpl(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ input: { text: text.trim() }, voice: name ? { languageCode, name } : { languageCode }, audioConfig: { audioEncoding: 'MP3' } }),
    });
    try {
      let upstream = await call(voiceName);
      if (upstream.status === 400) {
        const retryQuota = await consumeQuota();
        if (!retryQuota.allowed) return json(res, 429, 'RATE_LIMITED', 'Too many TTS requests', { 'Retry-After': String(retryQuota.retryAfterSeconds ?? 60) });
        upstream = await call();
      }
      if (!upstream.ok) return json(res, 502, 'TTS_PROVIDER_ERROR', `TTS provider returned ${upstream.status}`);
      const payload = await upstream.json() as { audioContent?: unknown };
      if (typeof payload.audioContent !== 'string') return json(res, 502, 'TTS_PROVIDER_RESPONSE_INVALID', 'Invalid TTS provider response');
      const audio = Buffer.from(payload.audioContent, 'base64');
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'private, no-store' });
      res.end(audio);
    } catch {
      return json(res, 502, controller.signal.aborted ? 'TTS_PROVIDER_TIMEOUT' : 'TTS_PROVIDER_UNAVAILABLE', controller.signal.aborted ? 'TTS provider timed out' : 'Failed to reach TTS provider');
    } finally { clearTimeout(timeout); }
  };
}
