import { DatabaseSync, backup, type SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { config, databaseDirectory } from "./config";
import { changes, restore, type Json } from "./history";
import { newId } from "@/shared/schema";

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(databaseDirectory, { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL,document JSON NOT NULL,is_draft BOOLEAN NOT NULL DEFAULT 0,draft_base_id TEXT,draft_base_version INTEGER,draft_example_id TEXT,draft_checkpoint JSON,created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),version INTEGER NOT NULL,name TEXT NOT NULL,summary TEXT NOT NULL,document JSON NOT NULL,created_at DATETIME NOT NULL,UNIQUE(project_id,version));
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,filename TEXT NOT NULL,content_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,storage_key TEXT NOT NULL,created_at DATETIME NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),version INTEGER NOT NULL,summary TEXT NOT NULL,forward JSON NOT NULL,inverse JSON NOT NULL,baseline BOOLEAN NOT NULL DEFAULT 0,undo_of TEXT UNIQUE REFERENCES operations(id),created_at DATETIME NOT NULL,UNIQUE(project_id,version));
      CREATE TABLE IF NOT EXISTS command_receipts (project_id TEXT NOT NULL REFERENCES projects(id),request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(project_id,request_id));
      CREATE TABLE IF NOT EXISTS producer_runs (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),base_version INTEGER NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,commands JSON NOT NULL,state JSON,applied BOOLEAN NOT NULL,created_at DATETIME NOT NULL);
      CREATE TABLE IF NOT EXISTS producer_events (run_id TEXT NOT NULL REFERENCES producer_runs(id),seq INTEGER NOT NULL,payload JSON NOT NULL,PRIMARY KEY(run_id,seq));
      CREATE UNIQUE INDEX IF NOT EXISTS uq_active_producer_run ON producer_runs(project_id) WHERE status='running';
      CREATE TABLE IF NOT EXISTS audio_jobs (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),status TEXT NOT NULL,request JSON NOT NULL,upstream_id TEXT,results JSON NOT NULL,error TEXT,created_at DATETIME NOT NULL);
    `);
    const columns = this.all<{ name: string }>(
      "PRAGMA table_info(projects)",
    ).map((c) => c.name);
    const additions: Record<string, string> = {
      is_draft: "BOOLEAN NOT NULL DEFAULT 0",
      draft_base_id: "TEXT",
      draft_base_version: "INTEGER",
      draft_example_id: "TEXT",
      draft_checkpoint: "JSON",
    };
    for (const [key, type] of Object.entries(additions))
      if (!columns.includes(key))
        this.db.exec(`ALTER TABLE projects ADD COLUMN ${key} ${type}`);
    this.tx(() => {
      for (const p of this.all<{
        id: string;
        name: string;
        version: number;
        document: string;
      }>(
        "SELECT * FROM projects WHERE NOT EXISTS (SELECT 1 FROM operations WHERE project_id=projects.id)",
      )) {
        const revisions = this.all<{
          version: number;
          name: string;
          document: string;
          summary: string;
          created_at: string;
        }>("SELECT * FROM revisions WHERE project_id=? ORDER BY version", p.id);
        if (
          !revisions.length ||
          revisions.length !== p.version ||
          revisions.some((r, i) => r.version !== i + 1)
        )
          throw new Error(
            "Incomplete legacy history: restore a consistent database backup",
          );
        let previous: Json | null = null;
        for (const r of revisions) {
          const state = {
            name: r.name,
            document: JSON.parse(r.document),
          } as Json;
          const forward = previous ? changes(previous, state) : [],
            inverse = previous ? changes(state, previous) : [];
          if (
            previous &&
            JSON.stringify(restore(previous, forward)) !== JSON.stringify(state)
          )
            throw new Error("Invalid legacy deltas");
          this.run(
            "INSERT INTO operations VALUES (?,?,?,?,?,?,?,?,?)",
            newId(),
            p.id,
            r.version,
            r.summary,
            JSON.stringify(forward),
            JSON.stringify(inverse),
            previous ? 0 : 1,
            null,
            r.created_at,
          );
          previous = state;
        }
        if (
          JSON.stringify(previous) !==
          JSON.stringify({ name: p.name, document: JSON.parse(p.document) })
        )
          throw new Error("Legacy history differs from project");
      }
    });
  }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
interface Runtime {
  store: Store;
  producerTasks: Map<string, AbortController>;
  audioTasks: Map<string, AbortController>;
}
const globalRuntime = globalThis as typeof globalThis & {
  demotifRuntime?: Promise<Runtime>;
};
export async function runtime(): Promise<Runtime> {
  return (globalRuntime.demotifRuntime ??= (async () => {
    if (existsSync(config.database)) {
      const source = new DatabaseSync(config.database, { readOnly: true });
      const target = `${config.database}.pre-nextjs.bak`;
      try {
        if (!existsSync(target)) await backup(source, target);
      } finally {
        source.close();
      }
    }
    const store = new Store(config.database);
    store.run(
      "UPDATE producer_runs SET status='interrupted' WHERE status='running'",
    );
    store.run(
      "UPDATE audio_jobs SET status='interrupted' WHERE status IN ('processing','submitting')",
    );
    return { store, producerTasks: new Map(), audioTasks: new Map() };
  })());
}
