import type { NextConfig } from "next";
import { resolve } from "node:path";
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  agentRules: false,
  devIndicators: false,
  turbopack: { root: resolve(import.meta.dirname) },
};
export default config;
