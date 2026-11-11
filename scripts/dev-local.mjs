import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {startLocalS3} from './local-s3.mjs';
const settings=JSON.parse(await readFile('demotif.config.json','utf8'));
if(settings.storage?.endpoint!=='http://127.0.0.1:4569')throw Error('Configure the local S3 endpoint before starting dev:local.');
const service=await startLocalS3();
const app=spawn(process.execPath,['scripts/run-server.mjs','--dev'],{stdio:'inherit',windowsHide:true});
let closing=false;async function close(code=0){if(closing)return;closing=true;app.kill();await service.close();process.exit(code)}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close());
app.once('exit',code=>void close(code??0));app.once('error',()=>void close(1));
