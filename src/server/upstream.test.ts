import { expect, it, vi } from 'vitest';
import { proxyAPI } from './upstream';
it('streams bodies, query, ranges and SSE without buffering or a local fallback', async () => {
  const send = vi.fn(async (_url: unknown, init: RequestInit) => {
    expect(await new Response(init.body).text()).toBe('audio');
    expect(new Headers(init.headers).get('range')).toBe('bytes=1-2');
    expect(new Headers(init.headers).has('host')).toBe(false);
    return new Response('data: accepted\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const request = new Request('http://local/api/projects/id?after=3', { method: 'POST', body: 'audio', headers: { range: 'bytes=1-2', host: 'local' } });
  const result = await proxyAPI(request, 'https://backend.test/api', send as typeof fetch);
  expect(String(send.mock.calls[0][0])).toBe('https://backend.test/api/projects/id?after=3');
  expect(result.headers.get('content-type')).toBe('text/event-stream');
  expect(await result.text()).toBe('data: accepted\n\n');
});
it('preserves partial responses and hides upstream failures', async () => {
  const request = new Request('http://local/api/x');
  const result = await proxyAPI(request, 'https://backend.test/api', (async () => new Response('ab', { status: 206, headers: { 'content-range': 'bytes 1-2/4', 'content-length': '2' } })) as typeof fetch);
  expect(result.status).toBe(206); expect(result.headers.get('content-length')).toBe('2');
  await expect(proxyAPI(request, 'https://backend.test/api', (async () => { throw Error('secret'); }) as typeof fetch)).rejects.toThrow('Cannot reach');
});
it('rejects loops before issuing a network call', async () => {
  const send = vi.fn();
  await expect(proxyAPI(new Request('http://local/api/x', { headers: { 'x-demotif-proxy': '1' } }), 'http://backend/api', send)).rejects.toThrow('loop');
  expect(send).not.toHaveBeenCalled();
});
