import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Store} from './db';
import {createProject} from './projects';
import {config} from './config';
import {upgradeRealtime} from './producer-realtime';
const sandbox=vi.hoisted(()=>({value:undefined as unknown}));
vi.mock('./db',async original=>({...await original<typeof import('./db')>(),runtime:async()=>sandbox.value}));
let db:Store,server:Server,provider:WebSocketServer,port:number,project:string;
const original={key:config.stepfunKey,url:config.stepfunURL,upstream:config.upstream};
const sockets:WebSocket[]=[];
beforeEach(async()=>{
  db=new Store(':memory:');sandbox.value={store:db,producerTasks:new Map()};project=createProject(db,'Voice',{},true).id;
  config.stepfunKey='local-test-key';config.upstream='';
  server=createServer();server.on('upgrade',(req,socket,head)=>{void upgradeRealtime(req,socket,head)});server.listen(0,'127.0.0.1');await once(server,'listening');port=(server.address() as {port:number}).port;
  provider=new WebSocketServer({port:0,host:'127.0.0.1'});await once(provider,'listening');config.stepfunURL=`http://127.0.0.1:${(provider.address() as {port:number}).port}/v1`;
});
afterEach(async()=>{
  for(const ws of sockets.splice(0))ws.terminate();for(const ws of provider.clients)ws.terminate();
  await new Promise<void>(resolve=>provider.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));db.db.close();
  config.stepfunKey=original.key;config.stepfunURL=original.url;config.upstream=original.upstream;
});
function client(id=project){const ws=new WebSocket(`ws://127.0.0.1:${port}/api/projects/${id}/producer/voice/realtime`);sockets.push(ws);return ws}
it('authenticates only upstream, forwards configured audio, and closes both sockets',async()=>{
  let upstream:WebSocket|undefined;
  provider.on('connection',(ws,request)=>{
    upstream=ws;expect(request.headers.authorization).toBe('Bearer local-test-key');expect(request.url).toContain('model=stepaudio-3-realtime-preview');
    ws.send(JSON.stringify({type:'session.created'}));ws.on('message',data=>{const event=JSON.parse(data.toString());if(event.type==='session.update')ws.send(JSON.stringify({type:'session.updated',session:{input_audio_format:'pcm16',output_audio_format:'pcm16'}}));if(event.type==='input_audio_buffer.append')ws.send(JSON.stringify({type:'input_audio_buffer.speech_started',item_id:'input'}));});
  });
  const ws=client(),events:Record<string,unknown>[]=[];ws.on('message',data=>events.push(JSON.parse(data.toString())));await once(ws,'open');ws.send(JSON.stringify({type:'demotif.context',version:1,context:null}));
  await vi.waitFor(()=>expect(events.some(e=>e.type==='demotif.ready')).toBe(true));expect(JSON.stringify(events)).not.toContain('local-test-key');
  ws.send(JSON.stringify({type:'input_audio_buffer.append',audio:'AAA='}));await vi.waitFor(()=>expect(events.some(e=>e.type==='input_audio_buffer.speech_started')).toBe(true));
  ws.close();await vi.waitFor(()=>expect(upstream?.readyState).toBe(WebSocket.CLOSED));
});
it('rejects missing credentials before opening a provider connection',async()=>{
  config.stepfunKey='';const ws=client();const [error]=await once(ws,'error');expect(String(error)).toContain('503');expect(provider.clients.size).toBe(0);
});
it('rejects a saved project and unknown project',async()=>{
  const saved=createProject(db,'Saved').id;for(const id of [saved,'missing']){const ws=client(id);const [error]=await once(ws,'error');expect(String(error)).toMatch(/422|404/);}expect(provider.clients.size).toBe(0);
});
it('forwards proxy upgrades to their owning backend without local credentials',async()=>{
  config.upstream=config.stepfunURL;
  let authorization:unknown='unset';
  provider.on('connection',(ws,request)=>{authorization=request.headers.authorization;expect(request.headers['x-demotif-proxy']).toBe('1');ws.send(JSON.stringify({type:'demotif.ready',sample_rate:24000}));});
  const ws=client('remote-project'),events:string[]=[];ws.on('message',data=>events.push(data.toString()));await once(ws,'open');
  await vi.waitFor(()=>expect(events.some(e=>e.includes('demotif.ready'))).toBe(true));expect(authorization).toBeUndefined();
});
