import {
  createReadStream,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { Readable } from "node:stream";
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
export function storeAsset(
  db: Store,
  projectId: string,
  name: string,
  type: string,
  data: Uint8Array,
  kind = "sample",
  key?: string,
  id = newId(),
): AssetRow {
  const suffix = /^\.[a-z0-9]{1,10}$/i.test(extname(name))
    ? extname(name).toLowerCase()
    : "";
  const storageKey = key ?? `${projectId}/${id}${suffix}`,
    path = safePath(config.media, storageKey);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  db.run(
    "INSERT INTO assets (id,project_id,kind,filename,content_type,size_bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)",
    id,
    projectId,
    kind,
    basename(name),
    type,
    data.length,
    storageKey,
    now(),
  );
  return db.get<AssetRow>("SELECT * FROM assets WHERE id=?", id)!;
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
