import S3rver from 's3rver';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function startLocalS3(){
const directory=resolve('data/s3');await mkdir(directory,{recursive:true});
const cors='<CORSConfiguration><CORSRule><AllowedOrigin>http://127.0.0.1:5173</AllowedOrigin><AllowedOrigin>http://localhost:5173</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>Content-Range</ExposeHeader></CORSRule></CORSConfiguration>';
const service=new S3rver({address:'127.0.0.1',port:4569,directory,silent:true,resetOnClose:false,vhostBuckets:false,configureBuckets:[{name:'demotif-local',configs:[cors]}]});
await service.run();console.log('Local S3 ready at http://127.0.0.1:4569 (persistent data/s3).');
return service;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const service=await startLocalS3();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void service.close().then(()=>process.exit(0)));}
