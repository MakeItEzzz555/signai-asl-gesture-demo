import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createTtsHandler } from './handler';

let server: Server | undefined;
afterEach(() => new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve()));

async function serve(handler: ReturnType<typeof createTtsHandler>) {
  server = createServer(handler);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `http://127.0.0.1:${address.port}`;
}

const validBody = { text: 'hello', languageCode: 'en-US', voiceName: 'en-US-Neural2-F' };

describe('paid TTS proxy boundary', () => {
  it.each(['null', '[]', '42'])('returns a bounded 400 for non-object JSON: %s', async body => {
    const upstream = vi.fn();
    const url = await serve(createTtsHandler({ apiKey: 'secret', quota: () => ({ allowed: true }), fetchImpl: upstream }));
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('bounds request size and rate-limit errors before provider billing', async () => {
    const upstream = vi.fn();
    let url = await serve(createTtsHandler({ apiKey: 'secret', quota: () => ({ allowed: true }), fetchImpl: upstream }));
    let response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validBody, padding: 'x'.repeat(17 * 1024) }) });
    expect(response.status).toBe(413);
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = undefined;
    url = await serve(createTtsHandler({ apiKey: 'secret', quota: () => ({ allowed: false, retryAfterSeconds: 7 }), fetchImpl: upstream }));
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validBody) });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('aborts a provider call at the configured deadline', async () => {
    const upstream = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const url = await serve(createTtsHandler({ apiKey: 'secret', quota: () => ({ allowed: true }), fetchImpl: upstream, timeoutMs: 5 }));
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validBody) });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'TTS_PROVIDER_TIMEOUT' });
  });

  it('fails closed in production without shared quota protection', async () => {
    const upstream = vi.fn();
    const url = await serve(createTtsHandler({ apiKey: 'secret', production: true, fetchImpl: upstream }));
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validBody) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'TTS_PROTECTION_NOT_CONFIGURED' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects unapproved voice combinations before billing upstream', async () => {
    const upstream = vi.fn();
    const url = await serve(createTtsHandler({ apiKey: 'secret', quota: () => ({ allowed: true }), fetchImpl: upstream }));
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validBody, voiceName: 'attacker-choice' }) });
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('returns private audio and retries one stale provider voice response', async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response('bad voice', { status: 400 }))
      .mockResolvedValueOnce(Response.json({ audioContent: Buffer.from('mp3').toString('base64') }));
    const url = await serve(createTtsHandler({ apiKey: 'secret', quota: () => ({ allowed: true }), fetchImpl: upstream }));
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validBody) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('mp3');
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
