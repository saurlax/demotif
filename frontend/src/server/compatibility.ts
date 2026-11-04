import { createHash } from "node:crypto";
// Keep persisted Python request fingerprints recoverable after changing runtimes.
const floatKeys = new Set([
  "tempo",
  "start_beat",
  "length_beats",
  "offset",
  "source_duration",
  "gain",
  "fade_in",
  "fade_out",
  "envelope_offset",
  "envelope_duration",
  "at_beat",
  "duration",
  "start",
  "velocity",
  "highpass",
  "lowpass",
  "drive",
  "reverb",
  "delay",
  "sidechain",
  "pan",
  "threshold",
  "ratio",
  "compAttack",
  "compRelease",
  "chorus",
  "phaser",
  "tremolo",
  "autopan",
  "bitcrusher",
  "lowShelf",
  "highShelf",
  "softClip",
  "width",
  "air",
  "multiband",
  "level",
  "transpose",
  "detune",
  "spread",
  "attack",
  "decay",
  "sustain",
  "release",
  "cutoff",
  "resonance",
  "filterDrive",
  "keytrack",
  "loopStart",
  "loopEnd",
  "time",
  "value",
  "duration_seconds",
]);
const quoted = (s: string) =>
  JSON.stringify(s).replace(
    /[\u007f-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
export function pythonJSON(value: unknown, key = ""): string {
  if (value === null) return "null";
  if (typeof value === "string") return quoted(value);
  if (typeof value === "number")
    return Number.isInteger(value) && floatKeys.has(key)
      ? value.toFixed(1)
      : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value))
    return "[" + value.map((v) => pythonJSON(v)).join(", ") + "]";
  if (typeof value === "object")
    return (
      "{" +
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => quoted(k) + ": " + pythonJSON(v, k))
        .join(", ") +
      "}"
    );
  throw new Error("Unsupported JSON value");
}
export const sha256Text = (s: string) =>
  createHash("sha256").update(s).digest("hex");
