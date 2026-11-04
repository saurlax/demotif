import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Next loads server-only .env.local; relative storage paths are workspace-relative.
const root = existsSync(resolve(process.cwd(), "frontend"))
  ? process.cwd()
  : resolve(process.cwd(), "..");
export const repositoryRoot = root;
const env = (key: string, fallback = "") =>
  process.env[`DEMOTIF_${key}`] ?? fallback;
const localPath = (path: string) => resolve(root, path);
const databaseURL = env("DATABASE_URL");
if (databaseURL && !databaseURL.startsWith("sqlite"))
  throw new Error("Only local SQLite is configured");
export const config = {
  database: databaseURL
    ? localPath(databaseURL.replace(/^sqlite(?:\+aiosqlite)?:\/\/\//, ""))
    : resolve(root, "data/demotif.db"),
  media: localPath(env("MEDIA_ROOT", "./data/media")),
  examples: localPath(env("EXAMPLES_ROOT", "./data/examples")),
  resources: resolve(root, "resources/sounds"),
  maxUpload: Number(env("MAX_UPLOAD_BYTES", "104857600")),
  environment: env("ENVIRONMENT", "local"),
  producerModel: env("PRODUCER_MODEL"),
  producerApi: env("PRODUCER_API", "responses"),
  producerKey: env("PRODUCER_API_KEY"),
  producerURL: env("PRODUCER_BASE_URL"),
  producerSettings: JSON.parse(env("PRODUCER_MODEL_SETTINGS", "{}")) as Record<
    string,
    unknown
  >,
  audioURL: env("AUDIO_BASE_URL"),
  audioKey: env("AUDIO_API_KEY"),
  audioBiz: env("AUDIO_BIZ_ID"),
  analysisPython: env(
    "ANALYSIS_PYTHON",
    resolve(root, "analysis/.venv/bin/python"),
  ),
};
export const databaseDirectory = dirname(config.database);
