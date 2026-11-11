import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { handle } from './api';

/** Raw Node response preserves audio framing that App Route sendResponse strips. */
export async function serveAPI(incoming: IncomingMessage, outgoing: ServerResponse, dispatch = handle) {
  const controller = new AbortController();
  const abort = () => { if (!outgoing.writableFinished) controller.abort(); };
  incoming.once('aborted', abort); outgoing.once('close', abort);
  try {
    const headers = new Headers();
    for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
    const request = new Request(new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`), {
      method: incoming.method, headers, signal: controller.signal,
      ...(!['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? {body: Readable.toWeb(incoming), duplex: 'half'} : {}),
    } as RequestInit);
    const response = await dispatch(request);
    outgoing.statusCode = response.status;
    if (response.headers.has('accept-ranges') || response.headers.get('content-type')?.startsWith('text/event-stream')) {
      const cache = response.headers.get('cache-control') ?? 'no-cache';
      if (!cache.includes('no-transform')) response.headers.set('cache-control', `${cache}, no-transform`);
    }
    for (const [name, value] of response.headers) if (!['connection','transfer-encoding','set-cookie'].includes(name)) outgoing.setHeader(name, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader('set-cookie', cookies);
    if (incoming.method === 'HEAD' || !response.body) {
      await response.body?.cancel(); outgoing.end();
    } else await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), outgoing);
  } catch {
    if (!outgoing.headersSent && !outgoing.destroyed) {
      outgoing.statusCode = 502; outgoing.setHeader('content-type','application/json');
      outgoing.removeHeader('content-length'); outgoing.end(JSON.stringify({code:'stream_failed',message:'The request stream could not be completed.'}));
    } else outgoing.destroy();
  } finally { incoming.off('aborted',abort); outgoing.off('close',abort); }
}
