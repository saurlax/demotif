import {build} from 'esbuild';

export async function buildServer(){
  await build({entryPoints:['scripts/server.ts'],outfile:'.server/server.mjs',bundle:true,platform:'node',format:'esm',packages:'external',banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"}});
}
if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/')))await buildServer();
