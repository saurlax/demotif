import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseEnv} from 'node:util';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
async function main(){
if(!process.argv.includes('--apply'))throw Error('Use --apply to copy verified objects and switch local settings.');
const settingsPath=resolve('demotif.config.json'),envPath=resolve('.env.local');
const settings=JSON.parse(await readFile(settingsPath,'utf8')),envText=await readFile(envPath,'utf8'),env={...process.env,...parseEnv(envText)};
if(new URL(settings.storage.endpoint).hostname==='127.0.0.1'){console.log('Local object storage is already configured.');process.exit(0);}
const sourceOptions=settings.storage,sourceEndpoint=new URL(sourceOptions.endpoint);if(sourceEndpoint.hostname.startsWith(sourceOptions.bucket+'.'))sourceEndpoint.hostname=sourceEndpoint.hostname.slice(sourceOptions.bucket.length+1);
const source=new S3Client({endpoint:sourceEndpoint.href,region:sourceOptions.region,credentials:{accessKeyId:env.DEMOTIF_S3_ACCESS_KEY_ID,secretAccessKey:env.DEMOTIF_S3_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
const targetOptions={endpoint:'http://127.0.0.1:4569',bucket:'demotif-local',region:'us-east-1',prefix:'demotif/'},target=new S3Client({endpoint:targetOptions.endpoint,region:targetOptions.region,forcePathStyle:true,credentials:{accessKeyId:'S3RVER',secretAccessKey:'S3RVER'},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
const directory=resolve('data/backups/local-s3-'+new Date().toISOString().replaceAll(/[:.]/g,'-'));await mkdir(directory,{recursive:true});
await copyFile(settingsPath,join(directory,'demotif.config.json'));await copyFile(envPath,join(directory,'.env.local'));
const db=new DatabaseSync(resolve(env.DEMOTIF_DATA_DIR||'data','demotif.db'));
await backup(db,join(directory,'demotif.db'));
const keys=new Map();
for(const a of db.prepare('SELECT storage_key,size_bytes,content_type FROM assets').all())if(a.storage_key.startsWith('s3:'))keys.set(a.storage_key.slice(3),{size:a.size_bytes,type:a.content_type});
function collect(v){if(!v||typeof v!=='object')return;if(typeof v.key==='string'&&typeof v.size==='number')keys.set(v.key,v);for(const x of Object.values(v))collect(x);}
for(const c of db.prepare('SELECT manifest FROM storage_catalogs').all())collect(JSON.parse(c.manifest));
let total=0,count=0;
try{
 for(const [key,ref] of keys){
  if(!/^(objects\/[a-f0-9]{64}|uploads\/[a-f0-9]{32}\/[a-f0-9]{32})$/.test(key))throw Error('Invalid accepted object reference');
  const response=await source.send(new GetObjectCommand({Bucket:sourceOptions.bucket,Key:sourceOptions.prefix+key}));if(!response.Body)throw Error('Source object missing');
  const bytes=await response.Body.transformToByteArray(),digest=key.split('/').at(-1),algorithm=digest.length===64?'sha256':'md5';
  if(bytes.length!==ref.size||createHash(algorithm).update(bytes).digest('hex')!==digest)throw Error('Source object integrity failed');
  await target.send(new PutObjectCommand({Bucket:targetOptions.bucket,Key:targetOptions.prefix+key,Body:bytes,ContentType:ref.type||response.ContentType,Metadata:response.Metadata}));
  const check=await target.send(new GetObjectCommand({Bucket:targetOptions.bucket,Key:targetOptions.prefix+key}));if(!check.Body)throw Error('Target object missing');const copied=await check.Body.transformToByteArray();
  if(copied.length!==bytes.length||createHash(algorithm).update(copied).digest('hex')!==digest)throw Error('Target object integrity failed');
  total+=bytes.length;count++;console.log(JSON.stringify({verified:count,objects:keys.size,bytes:total}));
 }
 // Change settings only after all copies were verified; originals remain untouched.
 let next=envText;for(const name of ['DEMOTIF_S3_ACCESS_KEY_ID','DEMOTIF_S3_SECRET_ACCESS_KEY']){const line=`${name}=S3RVER`;next=new RegExp(`^${name}=.*$`,'m').test(next)?next.replace(new RegExp(`^${name}=.*$`,'m'),line):next+'\n'+line+'\n';}
 await writeFile(envPath,next);try{await writeFile(settingsPath,JSON.stringify({...settings,storage:targetOptions},null,2)+'\n');}catch(error){await writeFile(envPath,envText);throw error;}
 console.log(JSON.stringify({switched:true,objects:count,bytes:total,backup:directory}));
}finally{db.close();source.destroy();target.destroy();}

}
main().catch(()=>{console.error("Local storage migration failed. Original configuration and objects are retained; check connectivity and object integrity.");process.exitCode=1;});
