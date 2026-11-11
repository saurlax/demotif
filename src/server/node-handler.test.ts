import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { serveAPI } from './node-handler';
let server: Server | undefined;
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; } });
it('preserves real Node HTTP HEAD lengths and streamed byte ranges', async () => {
  server = createServer((req,res) => void serveAPI(req,res, async request => {
    expect(request.signal).toBeInstanceOf(AbortSignal);
    return new Response(request.method === 'HEAD' ? null : Uint8Array.of(2,3), {status:206,headers:{'Content-Length':'2','Content-Type':'audio/wav','Content-Range':'bytes 1-2/4'}});
  }));
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}/api/test`;
  const head = await fetch(url,{method:'HEAD'}); expect(head.headers.get('content-length')).toBe('2'); expect(await head.text()).toBe('');
  const get = await fetch(url); expect(get.status).toBe(206); expect(get.headers.get('content-range')).toBe('bytes 1-2/4'); expect([...new Uint8Array(await get.arrayBuffer())]).toEqual([2,3]);
});
it('streams request bodies without a framework body parser', async () => {
  server = createServer((req,res) => void serveAPI(req,res, async request => new Response(await request.arrayBuffer())));
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const response = await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/test`,{method:'POST',body:Uint8Array.of(1,2,3)});
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1,2,3]);
});
it('cancels the upstream stream when a live SSE client disconnects', async () => {
  let cancelled = false, aborted = false;
  let finished!: () => void;
  const stopped = new Promise<void>(resolve => { finished = resolve; });
  server = createServer((req,res) => void serveAPI(req,res, async request => {
    request.signal.addEventListener('abort', () => { aborted = true; });
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: ready\n\n')); }, cancel() { cancelled = true; finished(); } }), {headers:{'Content-Type':'text/event-stream'}});
  }));
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const controller = new AbortController();
  await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/events`,{signal:controller.signal});
  controller.abort();
  await stopped;
  expect(aborted).toBe(true); expect(cancelled).toBe(true);
});
