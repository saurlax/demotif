import {
  createReadStream,
  existsSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  basename,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { Readable } from "node:stream";
import { binaries, type BinaryRef } from './storage';
import { materialize } from './storage-cache';
import { ApiError, missing } from "./errors";
import { config } from "./config";
import { newId } from "@/shared/schema";
import { now, type AssetRow } from "./projects";
import type { Store } from "./db";

export function safePath(root: string, key: string) {
  const base = resolve(root),
    target = resolve(base, key);
  const within = (parent: string, p: string) => {
    const r = relative(parent, p);
    return !r.startsWith("..") && !isAbsolute(r);
  };
  if (!within(base, target))
    throw new ApiError(400, "invalid_key", "Invalid storage key");
  if (existsSync(target) && !within(realpathSync(base), realpathSync(target)))
    throw new ApiError(400, "invalid_key", "Invalid storage key");
  return target;
}
export async function boundedBody(request: Request, max = config.maxUpload) {
  if (Number(request.headers.get("content-length") ?? 0) > max)
    throw new ApiError(413, "file_too_large", "Upload exceeds the size limit");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new ApiError(
          413,
          "file_too_large",
          "Upload exceeds the size limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
export function assetRef(asset: AssetRow): BinaryRef {
  const key = asset.storage_key.replace(/^s3:/, '');
  return { key, ...(key.startsWith('objects/') ? {sha256:key.slice(8)} : {md5:key.split('/').at(-1)}), size: asset.size_bytes, type: asset.content_type };
}
export async function prepareAsset(projectId: string, name: string, type: string, data: Uint8Array,
  kind = 'sample', id = newId(), signal?: AbortSignal): Promise<AssetRow> {
  const ref = await binaries().put(data, type, signal);
  return { id, project_id: projectId, kind, filename: basename(name), content_type: type,
    size_bytes: ref.size, storage_key: `s3:${ref.key}`, created_at: now() };
}
export function publishAsset(db: Store, asset: AssetRow): AssetRow {
  db.run('INSERT INTO assets (id,project_id,kind,filename,content_type,size_bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)',
    asset.id, asset.project_id, asset.kind, asset.filename, asset.content_type, asset.size_bytes, asset.storage_key, asset.created_at);
  return asset;
}
export async function storeAsset(db: Store, projectId: string, name: string, type: string, data: Uint8Array, kind = 'sample') {
  const prepared = await prepareAsset(projectId, name, type, data, kind);
  return db.tx(() => publishAsset(db, prepared));
}
export async function assetResponse(request: Request, asset: AssetRow) {
  if (!asset.storage_key.startsWith('s3:')) return fileResponse(request, safePath(config.media, asset.storage_key), asset.content_type, asset.filename);
  const response = await binaries().response(request, assetRef(asset));
  response.headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(asset.filename).replaceAll("'", '%27')}`);
  return response;
}
export async function materializeAsset(asset: AssetRow, signal?: AbortSignal) {
  if (!asset.storage_key.startsWith('s3:')) return safePath(config.media, asset.storage_key);
  return materialize(assetRef(asset), signal);
}
export function fileResponse(
  request: Request,
  path: string,
  type: string,
  filename?: string,
) {
  if (!existsSync(path)) missing("Asset content is missing from local storage");
  const stat = statSync(path),
    size = stat.size,
    headers = new Headers({
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      ETag: `"${size}-${stat.mtimeMs}"`,
    });
  if (filename)
    headers.set(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(filename).replaceAll("'", "%27")}`,
    );
  if (request.headers.get("if-none-match") === headers.get("etag"))
    return new Response(null, { status: 304, headers });
  let start = 0,
    end = size - 1,
    status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start > end || start >= size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (request.method === "HEAD" || !size)
    return new Response(null, { status, headers });
  const stream = createReadStream(path, { start, end });
  request.signal.addEventListener("abort", () => stream.destroy(), {
    once: true,
  });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status,
    headers,
  });
}
