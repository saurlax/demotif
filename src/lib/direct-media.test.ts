import {beforeEach,expect,it,vi} from 'vitest';
const sdk=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('@aws-sdk/client-s3',async original=>({...await original<typeof import('@aws-sdk/client-s3')>(),S3Client:class{send=sdk.send;destroy(){}}}));
import {fetchMedia,uploadDirect} from './direct-media';
const session=()=>({endpoint:'https://storage.test',bucket:'test-123',region:'test',key:'tests/objects/test',serverTime:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+900,credentials:{accessKeyId:'temporary',secretAccessKey:'temporary',sessionToken:'temporary'}});
beforeEach(()=>{sdk.send.mockReset();});
it('sends only reservation and completion JSON through the server, with bytes going to S3',async()=>{
  const metadata=vi.fn(async(url:string,init?:RequestInit)=>{
    expect(typeof init?.body).toBe('string');
    const data=JSON.parse(String(init?.body));
    if(url.endsWith('/uploads')){expect(data.project_version).toBe(7);expect(data.md5).toHaveLength(32);return Response.json({id:'upload',session:session()});}
    expect(data).toEqual({});return Response.json({id:'published'});
  });vi.stubGlobal('fetch',metadata);sdk.send.mockResolvedValue({});
  expect(await uploadDirect('p',new Blob([Uint8Array.of(1,2,3)],{type:'audio/wav'}),'take.wav','export',7)).toEqual({id:'published'});
  expect(metadata).toHaveBeenCalledTimes(2);
  const command=sdk.send.mock.calls[0][0];expect(command.constructor.name).toBe('PutObjectCommand');expect([...command.input.Body]).toEqual([1,2,3]);expect(command.input.ContentMD5).toBeTruthy();
});
it('downloads with temporary credentials and renews once after an expired authorization response',async()=>{
  const metadata=vi.fn(async(_url:string)=>Response.json(session()));vi.stubGlobal('fetch',metadata);
  sdk.send.mockRejectedValueOnce({$metadata:{httpStatusCode:403}}).mockResolvedValueOnce({Body:{transformToWebStream:()=>new Blob(['audio']).stream()},ContentLength:5});
  const response=await fetchMedia('/api/projects/p/assets/read/content');expect(await response.text()).toBe('audio');
  expect(metadata).toHaveBeenCalledTimes(2);expect(sdk.send).toHaveBeenCalledTimes(2);
  expect(metadata.mock.calls.every(call=>String(call[0]).startsWith('/api/'))).toBe(true);
});
