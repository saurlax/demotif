import nextEnv from '@next/env';
import {buildServer} from './build-server.mjs';

const dev=process.argv.includes('--dev');
process.env.NODE_ENV=dev?'development':'production';
nextEnv.loadEnvConfig(process.cwd(),dev);
if(dev)await buildServer();
await import('../.server/server.mjs');
