import {isLoopbackStorage} from '@/shared/storage-endpoint';
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Md5 } from '@smithy/md5-js';
interface Session {endpoint:string;region:string;bucket:string;key:string;serverTime:number;expiresAt:number;credentials:{accessKeyId:string;secretAccessKey:string;sessionToken?:string}}
const sessions = new Map<string,Promise<{session:Session;client:S3Client;until:number}>>();
async function ticket(url:string,refresh=false) {
  if(refresh)sessions.delete(url);
  let pending=sessions.get(url);
  if(pending && (await pending).until<Date.now()){sessions.delete(url);pending=undefined;}
  if(!pending){pending=(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw Error('Cannot authorize audio download.');
    const session=await response.json() as Session;
    const client=new S3Client({endpoint:session.endpoint,region:session.region,credentials:session.credentials,forcePathStyle:isLoopbackStorage(session.endpoint),requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',systemClockOffset:session.serverTime*1000-Date.now()});
    return {session,client,until:Date.now()+Math.max(0,session.expiresAt-session.serverTime-60)*1000};
  })();sessions.set(url,pending);pending.catch(()=>sessions.delete(url));}
  return pending;
}
/** Stable application URLs identify assets; only the small authorization response uses the API. */
export async function fetchMedia(url:string,init?:RequestInit):Promise<Response> {
  if(!/^\/api\/(projects\/[^/]+\/assets\/[^/]+\/content|sounds\/[^/]+\/preview)$/.test(url))return fetch(url,init);
  for(let attempt=0;;attempt++){
    const {client,session:s}=await ticket(url,attempt>0);
    try {
      const headers=new Headers(init?.headers),input={Bucket:s.bucket,Key:s.key,...(headers.has('range')?{Range:headers.get('range')!}:{})};
      if(init?.method==='HEAD'){
        const result=await client.send(new HeadObjectCommand(input),{abortSignal:init.signal??undefined});
        return new Response(null,{headers:{'Content-Length':String(result.ContentLength),'Content-Type':result.ContentType??'application/octet-stream'}});
      }
      const result=await client.send(new GetObjectCommand(input),{abortSignal:init?.signal??undefined});
      if(!result.Body)throw Error('Audio content is unavailable.');
      return new Response(result.Body.transformToWebStream(),{status:result.ContentRange?206:200,headers:{'Content-Type':result.ContentType??'application/octet-stream',...(result.ContentLength!=null?{'Content-Length':String(result.ContentLength)}:{}),...(result.ContentRange?{'Content-Range':result.ContentRange}:{})}});
    } catch(error){if(attempt===0 && (error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===403)continue;throw Error('Direct audio download failed.');}
  }
}
export async function uploadDirect(project:string,file:Blob,filename:string,kind='recording',version?:number) {
  const bytes=new Uint8Array(await file.arrayBuffer()),hash=new Md5();hash.update(bytes);
  const digest=await hash.digest(),md5=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  async function api(path:string,body:unknown){
    const response=await fetch(`/api/projects/${project}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const value=await response.json();if(!response.ok)throw Error(value.message??'Direct upload failed.');return value;
  }
  const reservation=await api('/uploads',{filename,content_type:file.type||'audio/wav',size_bytes:file.size,md5,kind,project_version:version});
  const s=reservation.session as Session;
  const client=new S3Client({endpoint:s.endpoint,region:s.region,credentials:s.credentials,forcePathStyle:isLoopbackStorage(s.endpoint),requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',systemClockOffset:s.serverTime*1000-Date.now()});
  try{await client.send(new PutObjectCommand({Bucket:s.bucket,Key:s.key,Body:bytes,ContentType:file.type||'audio/wav',ContentMD5:btoa(String.fromCharCode(...digest))}));}
  catch{throw Error('Direct audio upload failed.');}finally{client.destroy();}
  return api(`/uploads/${reservation.id}/complete`,{});
}
