import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Load .env / .env.local (all vars, not just VITE_* prefixed) for the dev middleware.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      tailwindcss(),

      // Dev-only: serve /api/tts inline so `npm run dev` works without vercel CLI.
      // Reads GOOGLE_TTS_API_KEY from .env.local (or the system environment).
      // In production, api/tts.ts is deployed as a Vercel/Netlify serverless function.
      {
        name: 'dev-api-tts',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use('/api/tts', async (req: any, res: any) => {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end('{"error":"Method not allowed"}');
              return;
            }

            const apiKey: string = env['GOOGLE_TTS_API_KEY'] || process.env['GOOGLE_TTS_API_KEY'] || '';
            if (!apiKey) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end('{"error":"TTS proxy not configured"}');
              return;
            }

            let body: { text?: string; languageCode?: string; voiceName?: string };
            try {
              const chunks: Buffer[] = [];
              for await (const chunk of req) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              }
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end('{"error":"Invalid request body"}');
              return;
            }

            const { text, languageCode, voiceName } = body;
            if (!text?.trim() || !languageCode || !voiceName) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end('{"error":"Missing fields"}');
              return;
            }

            try {
              const r = await fetch(
                `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    input: { text: text.trim() },
                    voice: { languageCode, name: voiceName },
                    audioConfig: { audioEncoding: 'MP3' },
                  }),
                },
              );
              if (!r.ok) {
                const detail = await r.text().catch(() => '');
                console.error('[dev-api-tts] Google error:', r.status, detail);
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(`{"error":"TTS provider returned ${r.status}"}`);
                return;
              }
              const data = await r.json() as { audioContent: string };
              const buf = Buffer.from(data.audioContent, 'base64');
              res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Content-Length': String(buf.length),
                'Cache-Control': 'public, max-age=3600',
              });
              res.end(buf);
            } catch (err) {
              console.error('[dev-api-tts] fetch failed:', err);
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end('{"error":"Failed to reach TTS provider"}');
            }
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 3000,
    },
  };
});
