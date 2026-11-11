import {expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {S3BinaryStore,binaries} from './storage';
import {directSession,reserveUpload,finishUpload} from './direct-transfers';
import {config} from './config';
import {Store} from './db';
import {createProject} from './projects';
import {PutObjectCommand} from '@aws-sdk/client-s3';
import {createHash} from 'node:crypto';
const S3rver=createRequire(import.meta.url)('s3rver');
it('supports real persistent loopback S3 direct transfers and owned checksum completion',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'demotif-local-s3-')),old={...config.s3},server=new S3rver({address:'127.0.0.1',port:0,directory,silent:true,configureBuckets:[{name:'demotif-local'}]});
 const address=await server.run();Object.assign(config.s3,{endpoint:`http://127.0.0.1:${address.port}`,region:'us-east-1',bucket:'demotif-local',prefix:'demotif/',accessKeyId:'S3RVER',secretAccessKey:'S3RVER'});
 const store=new S3BinaryStore(config.s3),db=new Store(':memory:');vi.mocked(binaries).mockReturnValue(store);
 try{
  const bytes=Uint8Array.of(1,2,3,4),ref=await store.put(bytes,'audio/wav');expect(await store.read(ref)).toEqual(bytes);
  expect(new Uint8Array(await (await store.response(new Request('http://localhost',{headers:{range:'bytes=1-2'}}),ref)).arrayBuffer())).toEqual(Uint8Array.of(2,3));
  const p=createProject(db,'Local',{},true),md5=createHash('md5').update(bytes).digest('hex'),reservation=await reserveUpload(db,p.id,{filename:'test.wav',content_type:'audio/wav',size_bytes:4,md5});
  expect(reservation.session.credentials).not.toHaveProperty('sessionToken');
  await store.client.send(new PutObjectCommand({Bucket:config.s3.bucket,Key:reservation.session.key,Body:bytes}));
  const asset=await finishUpload(db,p.id,reservation.id);expect(asset.project_id).toBe(p.id);
  config.s3.secretAccessKey='real-secret';await expect(directSession('objects/'+'a'.repeat(64))).rejects.toMatchObject({code:'local_storage_credentials'});
  config.s3.secretAccessKey='S3RVER';await server.close();const restarted=await server.run();const reopened=new S3BinaryStore({...config.s3,endpoint:`http://127.0.0.1:${restarted.port}`});try{expect(await reopened.read(ref)).toEqual(bytes)}finally{reopened.client.destroy()}
 }finally{store.client.destroy();await server.close();db.db.close();Object.assign(config.s3,old);rmSync(directory,{recursive:true,force:true});}
},20000);
it('rejects cleartext remote endpoints while allowing explicit loopback development',()=>{
 expect(()=>new S3BinaryStore({...config.s3,endpoint:'http://storage.example.com'})).toThrow('endpoint');
 expect(()=>new S3BinaryStore({...config.s3,endpoint:'http://127.0.0.1:4569'})).not.toThrow();
});
