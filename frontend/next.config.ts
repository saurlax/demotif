import type { NextConfig } from "next";
import { resolve } from "node:path";
const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  turbopack: { root: resolve(import.meta.dirname) },
};
export default config;
