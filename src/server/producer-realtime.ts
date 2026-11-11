import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import {WebSocket,WebSocketServer} from 'ws';
import {config} from './config';
import {runtime} from './db';
import {getProject} from './projects';
import {ApiError} from './errors';
import {RealtimeProducerSession} from './producer-realtime-session';

const relay=new WebSocketServer({noServer:true,maxPayload:config.maxUpload});
export const realtimePath=/^\/api\/projects\/([^/]+)\/producer\/voice\/realtime$/;
export function stepfunSocketURL(){
  const target=new URL(config.stepfunURL+'/realtime');
  target.protocol=target.protocol==='https:'?'wss:':'ws:';
  target.searchParams.set('model',config.realtime.model);return target;
}
function reject(socket:Duplex,status:number,message:string){
  const body=JSON.stringify({message});
  socket.end(`HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
export async function upgradeRealtime(request:IncomingMessage,socket:Duplex,head:Buffer){
  const match=realtimePath.exec(new URL(request.url??'/','http://localhost').pathname);
  if(!match)return false;
  try{
    if(config.upstream){
      if(request.headers['x-demotif-proxy'])throw new ApiError(502,'upstream_loop','Backend API proxy loop');
      const target=new URL(config.upstream.replace(/\/$/,'')+(request.url??'').replace(/^\/api/,''));
      target.protocol=target.protocol==='https:'?'wss:':'ws:';
      const upstream=new WebSocket(target,{headers:{'x-demotif-proxy':'1'},handshakeTimeout:15000,maxPayload:config.maxUpload});
      socket.once('close',()=>{if(upstream.readyState===WebSocket.CONNECTING)upstream.terminate()});
      const unavailable=()=>reject(socket,502,'Cannot reach the shared Demotif backend.');
      upstream.once('error',unavailable);
      upstream.once('open',()=>{upstream.removeListener('error',unavailable);if(socket.destroyed){upstream.close();return}relay.handleUpgrade(request,socket,head,downstream=>bridge(downstream,upstream));});
      return true;
    }
    if(!config.stepfunKey)throw new ApiError(503,'voice_unavailable','Configure STEPFUN_API_KEY before using realtime voice.');
    const {store}=await runtime(),projectId=decodeURIComponent(match[1]);
    if(!getProject(store,projectId).is_draft)throw new ApiError(422,'draft_required','Open an editing draft before using voice.');
    if(socket.destroyed)return true;
    relay.handleUpgrade(request,socket,head,downstream=>{
      const upstream=new WebSocket(stepfunSocketURL(),{headers:{Authorization:`Bearer ${config.stepfunKey}`},handshakeTimeout:15000,maxPayload:config.maxUpload});
      let closed=false;
      const fail=()=>{if(closed)return;if(downstream.readyState===WebSocket.OPEN)downstream.send(JSON.stringify({type:'demotif.error',message:'Realtime voice connection stopped. Check StepFun access and reconnect.'}));close();};
      const close=()=>{if(closed)return;closed=true;clearTimeout(initialization);session.close();downstream.close();if(upstream.readyState===WebSocket.CONNECTING)upstream.terminate();else upstream.close();};
      const send=(ws:WebSocket,event:Record<string,unknown>)=>{
        if(ws.readyState!==WebSocket.OPEN)throw new Error('Voice connection is not ready');
        // Ten seconds of encoded PCM is the maximum pending transport buffer.
        if(ws.bufferedAmount>24000*2*10*4/3)throw new Error('Voice transport is falling behind');
        ws.send(JSON.stringify(event));
      };
      const session=new RealtimeProducerSession(store,projectId,e=>send(upstream,e),e=>send(downstream,e));
      const initialization=setTimeout(fail,15000);
      downstream.on('message',(data,isBinary)=>{try{if(isBinary)throw new Error('Expected a voice event');session.client(JSON.parse(data.toString()));}catch{fail();}});
      upstream.on('message',(data,isBinary)=>{try{if(isBinary)throw new Error('Expected a provider event');const event=JSON.parse(data.toString());if(event.type==='session.updated')clearTimeout(initialization);session.provider(event);}catch{fail();}});
      for(const ws of [downstream,upstream]){ws.on('close',close);ws.on('error',fail);}
    });
  }catch(error){reject(socket,error instanceof ApiError?error.status:502,error instanceof ApiError?error.message:'Realtime voice is unavailable.');}
  return true;
}

function bridge(a:WebSocket,b:WebSocket){
  const close=()=>{for(const ws of [a,b]){if(ws.readyState===WebSocket.CONNECTING)ws.terminate();else if(ws.readyState===WebSocket.OPEN)ws.close();}};
  for(const [from,to] of [[a,b],[b,a]]){
    from.on('message',(data,isBinary)=>{if(to.readyState!==WebSocket.OPEN||to.bufferedAmount>24000*2*10*4/3){close();return}to.send(data,{binary:isBinary});});
    from.on('close',close);from.on('error',close);
  }
}
