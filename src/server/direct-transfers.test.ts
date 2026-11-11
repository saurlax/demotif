import {expect,it} from 'vitest';
import {Store} from './db';
import {createProject} from './projects';
import {reserveUpload,finishUpload,sessionPolicy} from './direct-transfers';
import {binaries,type S3BinaryStore} from './storage';
import {PutObjectCommand} from '@aws-sdk/client-s3';
it('limits a credential to one exact object and one transfer direction',()=>{
  const key='incoming/'+'a'.repeat(32),policy=sessionPolicy(key,true);
  expect(policy.statement[0].action).toEqual(['name/cos:PutObject']);
  expect(policy.statement[0].resource).toEqual(['qcs::cos:test:uid/123:prefix//123/test/tests/'+key]);
  expect(()=>sessionPolicy('../foreign',true)).toThrow();
  expect(sessionPolicy('objects/'+'b'.repeat(64),false).statement[0].action).toEqual(['name/cos:GetObject','name/cos:HeadObject']);
});
it('does not publish failed checksum uploads or cross-project completion',async()=>{
  const db=new Store(':memory:');
  try{
    const project=createProject(db,'P'),other=createProject(db,'Other');
    const reservation=await reserveUpload(db,project.id,{filename:'a.wav',content_type:'audio/wav',size_bytes:3,md5:'0'.repeat(32)});
    const store=binaries() as S3BinaryStore;
    await store.client.send(new PutObjectCommand({Bucket:store.bucket,Key:store.prefix+'incoming/'+reservation.id,Body:Uint8Array.of(1,2,3),ContentType:'audio/wav'}));
    await expect(finishUpload(db,other.id,reservation.id)).rejects.toMatchObject({status:404});
    await expect(finishUpload(db,project.id,reservation.id)).rejects.toMatchObject({code:'upload_integrity'});
    expect(db.all('SELECT * FROM assets')).toHaveLength(0);
    expect(db.get<{completed:number}>('SELECT completed FROM browser_uploads')!.completed).toBe(0);
  }finally{db.db.close();}
});
