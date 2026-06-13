/**
 * api/tts.ts — Serverless proxy for Google Cloud Text-to-Speech
 *
 * Deployed as a Vercel/Netlify serverless function at /api/tts.
 * The browser never talks to Google directly; this endpoint injects the API
 * key from the server environment variable GOOGLE_TTS_API_KEY.
 *
 * Request:  POST /api/tts
 *           Content-Type: application/json
 *           { text: string, languageCode: string, voiceName: string }
 *
 * Response: 200 audio/mpeg  — raw MP3 bytes
 *           400             — missing or invalid fields
 *           503             — GOOGLE_TTS_API_KEY not set in environment
 *           502             — Google TTS API returned an error
 *
 * Deployment:
 *   Vercel  — set GOOGLE_TTS_API_KEY in Project → Settings → Environment Variables
 *   Netlify — set in Site settings → Environment variables
 *   Local   — add GOOGLE_TTS_API_KEY=<key> to .env.local and run `vercel dev`
 *             OR the Vite dev-server middleware in vite.config.ts picks it up
 *             automatically when you run `npm run dev`
 */

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

// Vercel Node.js runtime handler (req: IncomingMessage, res: ServerResponse)
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const apiKey = process.env['GOOGLE_TTS_API_KEY'];
  if (!apiKey) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'TTS proxy not configured' }));
    return;
  }

  // Read and parse request body from stream
  let body: { text?: string; languageCode?: string; voiceName?: string };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid request body' }));
    return;
  }

  const { text, languageCode, voiceName } = body;
  if (!text?.trim() || !languageCode || !voiceName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing fields: text, languageCode, voiceName' }));
    return;
  }

  let googleRes: Response;
  try {
    googleRes = await fetch(`${GOOGLE_TTS_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: text.trim() },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });
  } catch (err) {
    console.error('[TTS proxy] Google TTS fetch failed:', err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to reach TTS provider' }));
    return;
  }

  if (!googleRes.ok) {
    const detail = await googleRes.text().catch(() => '');
    console.error('[TTS proxy] Google TTS error:', googleRes.status, detail);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `TTS provider returned ${googleRes.status}` }));
    return;
  }

  const data = await googleRes.json() as { audioContent: string };
  const audioBuf = Buffer.from(data.audioContent, 'base64');

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Content-Length': audioBuf.length.toString(),
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(audioBuf);
}
