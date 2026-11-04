import { afterEach, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { Store } from "./db";
import { config } from "./config";
import {
  audioPayload,
  audioRequestSchema,
  ensureAudio,
  publicAddress,
  publicJob,
} from "./audio-jobs";
import { createProject, now } from "./projects";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
afterEach(() => vi.clearAllMocks());
it("preserves the Python audio job identity instead of submitting a duplicate", async () => {
  const db = new Store(":memory:"),
    old = config.audioURL;
  try {
    config.audioURL = "https://audio.example/v1";
    const p = createProject(db, "P", {}, false, null, false);
    db.run("UPDATE projects SET id='p' WHERE id=?", p.id);
    const id =
        "a0a62bba9aeeceac1ebba5800f17daa5a93e61456874150a2bcc9635b11b9fc8",
      request = audioRequestSchema.parse({ mode: "music", prompt: "A beat" });
    db.run(
      "INSERT INTO audio_jobs VALUES (?,?,?,?,?,?,?,?)",
      id,
      "p",
      "interrupted",
      JSON.stringify(request),
      "upstream-paid-id",
      "[]",
      "Unknown result",
      now(),
    );
    const job = await ensureAudio(db, "p", { mode: "music", prompt: "A beat" });
    expect(job.id).toBe(id);
    expect(publicJob(job).can_resume).toBe(true);
    expect(db.all("SELECT * FROM audio_jobs")).toHaveLength(1);
  } finally {
    db.db.close();
    config.audioURL = old;
  }
});
it("validates mode-specific generation/analysis limits and provider payloads", () => {
  expect(() =>
    audioRequestSchema.parse({
      mode: "music",
      prompt: "x",
      duration_seconds: 10.5,
    }),
  ).toThrow();
  expect(() =>
    audioRequestSchema.parse({
      mode: "music",
      prompt: "x",
      instrumental: false,
    }),
  ).toThrow();
  expect(() =>
    audioRequestSchema.parse({
      mode: "sound",
      prompt: "x",
      duration_seconds: 16,
    }),
  ).toThrow();
  expect(() =>
    audioRequestSchema.parse({
      mode: "transcribe",
      source_id: "s",
      min_pitch: 90,
      max_pitch: 30,
    }),
  ).toThrow();
  const [ability, payload] = audioPayload(
    audioRequestSchema.parse({
      mode: "sound",
      prompt: "Click",
      duration_seconds: 0.5,
    }),
  );
  expect(ability).toBe("302ai-elevenlabs-sound-effects-v2");
  expect(payload).toMatchObject({ audio_option: { duration: 500 } });
});
it("denies private, mapped and mixed DNS results and non-HTTPS URLs", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.4",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ]) {
    vi.mocked(lookup).mockResolvedValue([
      { address, family: address.includes(":") ? 6 : 4 },
    ] as never);
    await expect(
      publicAddress("https://media.example/a.wav"),
    ).rejects.toThrow();
  }
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "192.168.0.1", family: 4 },
  ] as never);
  await expect(publicAddress("https://media.example/a")).rejects.toThrow();
  await expect(publicAddress("http://media.example/a")).rejects.toThrow();
  await expect(
    publicAddress("https://user:password@media.example/a"),
  ).rejects.toThrow();
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as never);
  expect(await publicAddress("https://media.example/a")).toEqual({
    address: "8.8.8.8",
    family: 4,
  });
});
