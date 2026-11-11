import { expect, it, vi } from 'vitest';
import { binaries, S3BinaryStore, verify } from './storage';
it('verifies and streams immutable bytes, HEAD, suffix ranges and conditionals', async () => {
  const store = binaries(), ref = await store.put(Uint8Array.from([1,2,3,4,5]), 'audio/wav');
  expect(await store.read(ref)).toEqual(Uint8Array.from([1,2,3,4,5]));
  const response = await store.response(new Request('http://local', { headers: { range: 'bytes=-2' } }), ref);
  expect(response.status).toBe(206); expect(response.headers.get('content-range')).toBe('bytes 3-4/5');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([4,5]));
  expect((await store.response(new Request('http://local', { method: 'HEAD' }), ref)).headers.get('content-length')).toBe('5');
  expect((await store.response(new Request('http://local', { headers: { 'if-none-match': `"${ref.sha256}"` } }), ref)).status).toBe(304);
  for (const range of ['bytes=-0', 'bytes=7-', 'bytes=3-1', 'bytes=1-2,3-4']) expect((await store.response(new Request('http://local', { headers: { range } }), ref)).status).toBe(416);
  expect(() => verify(Uint8Array.of(0), ref)).toThrow('integrity');
  await expect(store.read({...ref, key: '../foreign'})).rejects.toThrow('reference');
});
it('redacts SDK errors and never publishes unverified uploads', async () => {
  const store = new S3BinaryStore({ endpoint: 'https://storage.test', bucket: 'test', region: 'test', prefix: 'tests/', accessKeyId: 'private', secretAccessKey: 'private' });
  vi.spyOn(store.client, 'send').mockRejectedValue(Error('private credential upstream failure'));
  await expect(store.put(Uint8Array.of(1), 'audio/wav')).rejects.toThrow('Object storage is unavailable');
});
it('passes cancellation to every SDK operation', async () => {
  const store = binaries() as S3BinaryStore, controller = new AbortController();
  const ref = await store.put(Uint8Array.of(1), 'audio/wav', controller.signal);
  const send = vi.mocked(store.client.send);
  expect(send.mock.calls.every(call => (call[1] as {abortSignal?: AbortSignal})?.abortSignal === controller.signal)).toBe(true);
  await store.response(new Request('http://local',{signal:controller.signal}),ref);
  expect((send.mock.calls.at(-1)![1] as {abortSignal:AbortSignal}).abortSignal).toBeInstanceOf(AbortSignal);
});
