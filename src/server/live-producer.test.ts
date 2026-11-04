import { expect, it } from "vitest";
import { Store } from "./db";
import { createProject } from "./projects";
import { produce, producerReady } from "./producer";
// Explicit opt-in only: calls the configured model with a blank synthetic project.
it.skipIf(process.env.DEMOTIF_LIVE_MODEL_TEST !== "1")(
  "configured model accepts tools and streams a reply",
  async () => {
    expect(producerReady()).toBe(true);
    const db = new Store(":memory:");
    try {
      const p = createProject(db, "Connection check"),
        events: Record<string, unknown>[] = [];
      const result = await produce(
        db,
        p,
        "只回复“连接正常”。不要修改项目，不要生成音频。",
        AbortSignal.timeout(45000),
        (e) => events.push(e),
      );
      expect(result.commands).toEqual([]);
      expect(
        events.some(
          (e) =>
            e.type === "reply" &&
            typeof e.text === "string" &&
            e.text.length > 0,
        ),
      ).toBe(true);
    } finally {
      db.db.close();
    }
  },
  50000,
);
