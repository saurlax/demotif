import {isLoopbackStorage} from '@/shared/storage-endpoint';
import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config';
import { ApiError } from './errors';

export interface BinaryRef { key: string; sha256?: string; md5?: string; size: number; type: string }
export interface BinaryStore {
  put(bytes: Uint8Array, type: string, signal?: AbortSignal): Promise<BinaryRef>;
  read(ref: BinaryRef, signal?: AbortSignal): Promise<Uint8Array>;
  response(request: Request, ref: BinaryRef): Promise<Response>;
  finalize?(staging: string, ref: BinaryRef): Promise<void>;
}
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function verify(bytes: Uint8Array, ref: BinaryRef) {
  if (bytes.length !== ref.size || (ref.sha256 ? sha256(bytes) !== ref.sha256 : !ref.md5 || createHash('md5').update(bytes).digest('hex') !== ref.md5))
    throw new ApiError(502, 'object_integrity', 'Stored audio failed its integrity check.');
}
const unavailable = () => new ApiError(503, 'storage_unavailable', 'Object storage is unavailable.');

export class S3BinaryStore implements BinaryStore {
  readonly client: S3Client;
  readonly bucket: string;
  readonly prefix: string;
  constructor(options: typeof config.s3) {
    const endpoint = new URL(options.endpoint);
    if ((endpoint.protocol !== 'https:' && !(endpoint.protocol==='http:'&&isLoopbackStorage(endpoint.href))) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash)
      throw new Error('Invalid object storage endpoint');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\/$/.test(options.prefix) || options.prefix.includes('//'))
      throw new Error('Invalid object storage prefix');
    this.bucket = options.bucket;
    this.prefix = options.prefix;
    if (endpoint.hostname.startsWith(`${options.bucket}.`)) endpoint.hostname = endpoint.hostname.slice(options.bucket.length + 1);
    this.client = new S3Client({
      endpoint: endpoint.href, region: options.region,
      forcePathStyle: isLoopbackStorage(endpoint.href),
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  private key(ref: BinaryRef) {
    const valid = ref.sha256 ? /^[a-f0-9]{64}$/.test(ref.sha256) && ref.key === `objects/${ref.sha256}`
      : !!ref.md5 && /^[a-f0-9]{32}$/.test(ref.md5) && new RegExp(`^uploads/[a-f0-9]{32}/${ref.md5}$`).test(ref.key);
    if (!valid || !Number.isSafeInteger(ref.size) || ref.size < 0)
      throw new ApiError(500, 'invalid_object', 'Invalid stored object reference.');
    return this.prefix + ref.key;
  }
  async finalize(staging: string, ref: BinaryRef) {
    if (!/^incoming\/[a-f0-9]{32}$/.test(staging) || !ref.md5) throw unavailable();
    const key = this.key(ref);
    try {
      const source = await this.client.send(new HeadObjectCommand({Bucket:this.bucket,Key:this.prefix+staging}));
      if (source.ContentLength !== ref.size || source.ETag?.replaceAll('"','') !== ref.md5) throw new ApiError(422,'upload_integrity','Uploaded audio checksum or length does not match.');
      await this.client.send(new CopyObjectCommand({Bucket:this.bucket,Key:key,CopySource:`${this.bucket}/${this.prefix}${staging}`,CopySourceIfMatch:source.ETag,MetadataDirective:'REPLACE',Metadata:{md5:ref.md5},ContentType:ref.type}));
      const copied = await this.client.send(new HeadObjectCommand({Bucket:this.bucket,Key:key}));
      if (copied.ContentLength !== ref.size || copied.ETag?.replaceAll('"','') !== ref.md5) throw unavailable();
    } catch(e) { if(e instanceof ApiError) throw e; throw unavailable(); }
  }
  async put(bytes: Uint8Array, type: string, signal?: AbortSignal): Promise<BinaryRef> {
    const digest = sha256(bytes), ref = { key: `objects/${digest}`, sha256: digest, size: bytes.length, type };
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(ref), Body: bytes,
        ContentType: type, Metadata: { sha256: digest } }), { abortSignal: signal });
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(ref) }), { abortSignal: signal });
      if (head.ContentLength !== ref.size || head.Metadata?.sha256 !== digest) throw unavailable();
      // Verify actual bytes, rather than treating an ETag or echoed metadata as a digest.
      await this.read(ref, signal);
      return ref;
    } catch { throw unavailable(); }
  }
  async read(ref: BinaryRef, signal?: AbortSignal): Promise<Uint8Array> {
    const key = this.key(ref);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal });
      if (!result.Body) throw unavailable();
      const bytes = await result.Body.transformToByteArray(); verify(bytes, ref); return bytes;
    } catch (e) { if (e instanceof ApiError) throw e; throw unavailable(); }
  }
  async response(request: Request, ref: BinaryRef): Promise<Response> {
    const key = this.key(ref), etag = `"${ref.sha256 ?? ref.md5}"`;
    const headers = new Headers({ 'Content-Type': ref.type, 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': 'private, max-age=3600' });
    if ((request.headers.get('if-none-match') ?? '').split(',').map(s => s.trim().replace(/^W\//, '')).some(s => s === etag || s === '*'))
      return new Response(null, { status: 304, headers });
    let start = 0, end = ref.size - 1, status = 200;
    const range = request.headers.get('if-range') && request.headers.get('if-range') !== etag ? null : request.headers.get('range');
    if (range && request.method !== 'HEAD') {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m && (m[1] || m[2])) {
        start = m[1] ? Number(m[1]) : Math.max(0, ref.size - Number(m[2]));
        end = m[1] && m[2] ? Math.min(Number(m[2]), end) : end;
      }
      if (!m || !(m[1] || m[2]) || (!m[1] && Number(m[2]) === 0) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= ref.size) {
        headers.set('Content-Range', `bytes */${ref.size}`); return new Response(null, { status: 416, headers });
      }
      status = 206; headers.set('Content-Range', `bytes ${start}-${end}/${ref.size}`);
    }
    headers.set('Content-Length', String(Math.max(0, end - start + 1)));
    if (request.method === 'HEAD' || ref.size === 0) return new Response(null, { status, headers });
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(status === 206 ? { Range: `bytes=${start}-${end}` } : {}) }), { abortSignal: request.signal });
      if (!result.Body || result.ContentLength !== end - start + 1) {
        if (result.Body && 'destroy' in result.Body) result.Body.destroy();
        throw unavailable();
      }
      return new Response(result.Body.transformToWebStream(), { status, headers });
    } catch { throw unavailable(); }
  }
}
let current: BinaryStore | undefined;
export function binaries(): BinaryStore {
  if (!current) {
    if (!config.s3.endpoint || !config.s3.bucket || !config.s3.accessKeyId || !config.s3.secretAccessKey)
      throw new ApiError(503, 'storage_unconfigured', 'Object storage is not configured.');
    current = new S3BinaryStore(config.s3);
  }
  return current;
}
