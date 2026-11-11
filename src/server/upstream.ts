import { ApiError } from './errors';

const hop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'];
function forwarded(input: Headers) {
  const headers = new Headers(input);
  for (const name of (headers.get('connection') ?? '').split(',')) if (name.trim()) headers.delete(name.trim());
  for (const name of hop) headers.delete(name);
  return headers;
}

/** Executes before runtime(): a frontend proxy never becomes another SQLite owner. */
export async function proxyAPI(request: Request, endpoint: string, send = fetch): Promise<Response> {
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new ApiError(503, 'upstream_configuration', 'Invalid backend API configuration');
  const incoming = new URL(request.url);
  const target = new URL(base.href.replace(/\/$/, '') + incoming.pathname.replace(/^\/api/, '') + incoming.search);
  const headers = forwarded(request.headers);
  if (headers.has('x-demotif-proxy'))
    throw new ApiError(502, 'upstream_loop', 'Backend API proxy loop');
  headers.set('x-demotif-proxy', '1');
  headers.set('accept-encoding', 'identity');
  try {
    const response = await send(target, {
      method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      duplex: 'half', signal: request.signal, redirect: 'manual', cache: 'no-store',
    } as RequestInit);
    const output = forwarded(response.headers);
    // fetch decodes encodings automatically; never forward a stale encoding header.
    output.delete('content-encoding');
    if (!response.headers.has('content-encoding') && response.headers.has('content-length'))
      output.set('content-length', response.headers.get('content-length')!);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: output });
  } catch {
    throw new ApiError(502, 'upstream_unavailable', 'Cannot reach the shared Demotif backend.');
  }
}
