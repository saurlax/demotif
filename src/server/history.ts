import { isDeepStrictEqual } from "node:util";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Delta {
  op: "set" | "insert" | "remove" | "move";
  path: string[];
  value?: Json;
  entity_id?: string;
  index?: number;
}
const equal = isDeepStrictEqual;
const object = (v: Json): v is Record<string, Json> =>
  v !== null && !Array.isArray(v) && typeof v === "object";
const entities = (v: Json[]): v is (Record<string, Json> & { id: string })[] =>
  v.every((x) => object(x) && typeof x.id === "string") &&
  new Set(v.map((x) => (x as { id: string }).id)).size === v.length;
export function changes(before: Json, after: Json): Delta[] {
  const result: Delta[] = [];
  function walk(old: Json, next: Json, path: string[]) {
    if (equal(old, next)) return;
    if (
      object(old) &&
      object(next) &&
      equal(Object.keys(old).sort(), Object.keys(next).sort())
    ) {
      for (const key of Object.keys(old))
        walk(old[key], next[key], [...path, key]);
    } else if (
      Array.isArray(old) &&
      Array.isArray(next) &&
      entities(old) &&
      entities(next)
    ) {
      const current = old.map((x) => x.id),
        wanted = new Set(next.map((x) => x.id)),
        byId = new Map(old.map((x) => [x.id, x]));
      for (const id of [...current].reverse())
        if (!wanted.has(id)) {
          result.push({ op: "remove", path, entity_id: id });
          current.splice(current.indexOf(id), 1);
        }
      next.forEach((item, index) => {
        const at = current.indexOf(item.id);
        if (at < 0) {
          result.push({ op: "insert", path, value: item, index });
          current.splice(index, 0, item.id);
        } else {
          if (at !== index) {
            result.push({ op: "move", path, entity_id: item.id, index });
            current.splice(at, 1);
            current.splice(index, 0, item.id);
          }
          walk(byId.get(item.id)!, item, [...path, item.id]);
        }
      });
    } else result.push({ op: "set", path, value: next });
  }
  walk(before, after, []);
  return result;
}
export function restore(state: Json, deltas: Delta[]): Json {
  let copy = structuredClone(state);
  function resolve(path: string[]): Json {
    let t = copy;
    for (const p of path)
      t = Array.isArray(t)
        ? t.find((x) => object(x) && x.id === p)!
        : (t as Record<string, Json>)[p];
    return t;
  }
  for (const d of deltas) {
    if (d.op === "set") {
      if (!d.path.length) copy = structuredClone(d.value ?? null);
      else
        (resolve(d.path.slice(0, -1)) as Record<string, Json>)[d.path.at(-1)!] =
          structuredClone(d.value ?? null);
    } else {
      const list = resolve(d.path) as Json[];
      if (d.op === "insert")
        list.splice(d.index!, 0, structuredClone(d.value ?? null));
      else {
        const index = list.findIndex((x) => object(x) && x.id === d.entity_id);
        if (index < 0) throw new Error("Invalid historical delta");
        const [item] = list.splice(index, 1);
        if (d.op === "move") list.splice(d.index!, 0, item);
      }
    }
  }
  return copy;
}
