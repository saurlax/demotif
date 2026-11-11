import { beforeEach, vi } from 'vitest';
import * as storage from './storage';
import { createHash } from 'node:crypto';
import { config } from './config';
vi.mock('tencentcloud-sdk-nodejs-sts',()=>({default:{sts:{v20180813:{Client:class {async GetFederationToken(){return{Credentials:{TmpSecretId:'temporary-id',TmpSecretKey:'temporary-secret',Token:'temporary-token'},ExpiredTime:Math.floor(Date.now()/1000)+900}}}}}}}));

// Run the real adapter with an isolated in-memory S3 transport in service tests.
beforeEach(() => {
  config.s3.endpoint='https://storage.test';config.s3.bucket='test-123';config.s3.region='test';config.s3.prefix='tests/';
  const objects = new Map<string, { bytes: Uint8Array; type: string; metadata: Record<string, string> }>();
  const store = new storage.S3BinaryStore({ endpoint: 'https://storage.test', bucket: 'test', region: 'test', prefix: 'tests/', accessKeyId: 'test', secretAccessKey: 'test' });
  vi.spyOn(store.client, 'send').mockImplementation((async (command: { constructor: {name: string}; input: Record<string, unknown> }) => {
    const input = command.input, key = String(input.Key);
    if (command.constructor.name === 'CopyObjectCommand') {
      const source = String(input.CopySource).slice('test/'.length), object=objects.get(source);
      if(!object || input.CopySourceIfMatch !== '"'+createHash('md5').update(object.bytes).digest('hex')+'"')throw Error('PreconditionFailed');
      objects.set(key,{...object,type:String(input.ContentType)});return {};
    }
    if (command.constructor.name === 'PutObjectCommand') {
      objects.set(key, { bytes: Uint8Array.from(input.Body as Uint8Array), type: String(input.ContentType), metadata: input.Metadata as Record<string, string> }); return {};
    }
    const object = objects.get(key);
    if (!object) throw new Error('NoSuchKey');
    let bytes = object.bytes;
    if (input.Range) { const match = /bytes=(\d+)-(\d+)/.exec(String(input.Range))!; bytes = bytes.slice(Number(match[1]), Number(match[2]) + 1); }
    return { ContentLength: bytes.length, ContentType: object.type, Metadata: object.metadata, ETag:'"'+createHash('md5').update(bytes).digest('hex')+'"',
      Body: { transformToByteArray: async () => bytes,
        transformToWebStream: () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), destroy() {} } };
  }) as never);
  vi.spyOn(storage, 'binaries').mockReturnValue(store);
});
