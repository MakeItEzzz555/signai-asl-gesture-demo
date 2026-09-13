import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createMemoryQuota, createTtsHandler } from './server/tts/handler';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'dev-api-tts',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use('/api/tts', createTtsHandler({
            apiKey: env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_TTS_API_KEY,
            quota: createMemoryQuota(),
            clientKey: req => req.socket.remoteAddress ?? 'local',
          }));
        },
      },
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 3000 },
  };
});
