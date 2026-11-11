import {isLoopbackStorage} from '@/shared/storage-endpoint';
import sts from 'tencentcloud-sdk-nodejs-sts';
import { z } from 'zod';
import { basename } from 'node:path';
import { config } from './config';
import { ApiError, invalid, missing } from './errors';
import { binaries, type BinaryRef } from './storage';
import { publishAsset } from './media';
import { now } from './projects';
import { newId } from '@/shared/schema';
import type { Store } from './db';
type Upload = {id:string;project_id:string;asset_id:string;filename:string;content_type:string;size_bytes:number;md5:string;kind:string;project_version:number|null;expires_at:number;completed:number;created_at:string};
const sessions = new Map<string,Promise<{credentials:{accessKeyId:string;secretAccessKey:string;sessionToken:string};expiresAt:number}>>();
export function sessionPolicy(key: string, write: boolean) {
  if (!/^(objects\/[a-f0-9]{64}|uploads\/[a-f0-9]{32}\/[a-f0-9]{32}|incoming\/[a-f0-9]{32})$/.test(key)) invalid('Invalid object reference');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\/$/.test(config.s3.prefix) || config.s3.prefix.includes('//')) invalid('Invalid storage namespace');
  const bucket=config.s3.bucket, app=bucket.split('-').at(-1)!, short=bucket.slice(0,-app.length-1);
  return {version:'2.0',statement:[{effect:'allow',action:write?['name/cos:PutObject']:['name/cos:GetObject','name/cos:HeadObject'],resource:[`qcs::cos:${config.s3.region}:uid/${app}:prefix//${app}/${short}/${config.s3.prefix}${key}`]}]};
}
export async function directSession(key: string, write = false) {
  const policy=sessionPolicy(key,write), cacheKey=JSON.stringify(policy);
  if(isLoopbackStorage(config.s3.endpoint)){
    // Published emulator credentials only: never send real storage secrets to a browser.
    if(config.s3.accessKeyId!=='S3RVER'||config.s3.secretAccessKey!=='S3RVER')throw new ApiError(503,'local_storage_credentials','Local S3rver requires its development test credentials.');
    return {credentials:{accessKeyId:'S3RVER',secretAccessKey:'S3RVER'},expiresAt:Math.floor(Date.now()/1000)+900,bucket:config.s3.bucket,region:config.s3.region,endpoint:config.s3.endpoint,key:config.s3.prefix+key,serverTime:Math.floor(Date.now()/1000)};
  }
  let pending=sessions.get(cacheKey);
  if (pending && (await pending).expiresAt < Date.now()/1000+60) {sessions.delete(cacheKey);pending=undefined;}
  if (!pending) {
    pending=(async()=>{
      try {
        const client=new sts.sts.v20180813.Client({credential:{secretId:config.s3.accessKeyId,secretKey:config.s3.secretAccessKey},region:config.s3.region});
        const result=await client.GetFederationToken({Name:'demotif',DurationSeconds:900,Policy:JSON.stringify(policy)}), c=result.Credentials;
        if (!c?.TmpSecretId || !c.TmpSecretKey || !c.Token || !result.ExpiredTime) throw Error();
        return {credentials:{accessKeyId:c.TmpSecretId,secretAccessKey:c.TmpSecretKey,sessionToken:c.Token},expiresAt:result.ExpiredTime};
      } catch {sessions.delete(cacheKey);throw new ApiError(503,'sts_unavailable','Temporary storage authorization is unavailable.');}
    })();sessions.set(cacheKey,pending);
  }
  const u=new URL(config.s3.endpoint);if(u.hostname.startsWith(config.s3.bucket+'.'))u.hostname=u.hostname.slice(config.s3.bucket.length+1);
  return {...await pending,bucket:config.s3.bucket,region:config.s3.region,endpoint:u.href,key:config.s3.prefix+key,serverTime:Math.floor(Date.now()/1000)};
}
const uploadSchema=z.object({filename:z.string().min(1),content_type:z.string().regex(/^(audio|video)\//),size_bytes:z.number().int().positive(),md5:z.string().regex(/^[a-f0-9]{32}$/),kind:z.enum(['recording','vocal','instrument','sample','reference','export']).default('recording'),project_version:z.number().int().positive().optional()});
export async function reserveUpload(db:Store,project:string,input:unknown) {
  const data=uploadSchema.parse(input);
  if(data.size_bytes>config.maxUpload)throw new ApiError(413,'file_too_large','Upload exceeds the size limit');
  if(data.kind==='export' && (!data.project_version || !db.get('SELECT id FROM operations WHERE project_id=? AND version=?',project,data.project_version)))invalid('Unknown export project version');
  const id=newId(), asset=newId(), expires=Math.floor(Date.now()/1000)+900;
  db.run('INSERT INTO browser_uploads (id,project_id,asset_id,filename,content_type,size_bytes,md5,kind,project_version,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,project,asset,basename(data.filename),data.content_type,data.size_bytes,data.md5,data.kind,data.project_version??null,expires,now());
  return {id,session:await directSession(`incoming/${id}`,true)};
}
export async function finishUpload(db:Store,project:string,id:string) {
  const row=db.get<Upload>('SELECT * FROM browser_uploads WHERE id=? AND project_id=?',id,project)??missing('Upload not found');
  if(!row.completed) {
    if(row.expires_at<Date.now()/1000)throw new ApiError(410,'upload_expired','Upload authorization expired. Start a new upload.');
    const ref:BinaryRef={key:`uploads/${row.asset_id}/${row.md5}`,md5:row.md5,size:row.size_bytes,type:row.content_type};
    const store=binaries();if(!store.finalize)throw new ApiError(503,'storage_unavailable','Direct uploads are unavailable.');
    await store.finalize(`incoming/${id}`,ref);
    db.tx(()=>{
      if(db.get<Upload>('SELECT * FROM browser_uploads WHERE id=?',id)!.completed)return;
      publishAsset(db,{id:row.asset_id,project_id:project,filename:row.filename,content_type:row.content_type,size_bytes:row.size_bytes,kind:row.kind,storage_key:`s3:${ref.key}`,created_at:row.created_at});
      if(row.kind==='export')db.run('INSERT INTO audio_exports VALUES (?,?,?,?,?)',id,project,row.project_version!,row.asset_id,row.created_at);
      db.run('UPDATE browser_uploads SET completed=1 WHERE id=?',id);
    });
  }
  const asset=db.get<Record<string,unknown>>('SELECT id,project_id,kind,filename,content_type,size_bytes,created_at FROM assets WHERE id=?',row.asset_id)!;
  return asset;
}
