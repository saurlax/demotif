import {useEffect,useRef} from 'react';
import {clientRenderSchema} from '@/shared/schema';
import {randomUUID} from '@/shared/id';
import {studioRequest,type useClipAudioActions} from './clip-audio-actions';
import type {useProducerController} from './use-producer-controller';
import {notifyError} from '@/lib/notifications';

export function useProducerRender(projectId:string,controller:ReturnType<typeof useProducerController>,audio:ReturnType<typeof useClipAudioActions>){
  const handlers=useRef(audio);useEffect(()=>{handlers.current=audio},[audio]);
  const work=useRef(new Map<string,AbortController>()),client=useRef('');
  useEffect(()=>{
    const key='demotif:render-client';
    try{client.current=sessionStorage.getItem(key)??randomUUID();sessionStorage.setItem(key,client.current);}catch{client.current=randomUUID();}
    const running=work.current;return()=>{for(const operation of running.values())operation.abort();running.clear();};
  },[projectId,controller.active?.id]);
  useEffect(()=>{
    const run=controller.active;if(!run)return;
    const complete=new Set(run.events.filter(e=>e.type==='client_render_result').map(e=>e.request_id));
    for(const event of run.events){
      if(event.type!=='client_render'||!event.request_id||complete.has(event.request_id)||work.current.has(event.request_id))continue;
      const parsed=clientRenderSchema.safeParse(event);if(!parsed.success)continue;
      const request=parsed.data,abort=new AbortController();work.current.set(request.request_id,abort);
      const body={request_id:request.request_id,client_id:client.current};
      const endpoint=`/api/projects/${projectId}/producer/runs/${run.id}/render`;
      void(async()=>{
        try{
          while(true){
            const claim=await studioRequest<{status:string}>(endpoint,{...body,action:'claim'},abort.signal);
            if(claim.status==='complete')return;
            if(claim.status==='claimed')break;
            await new Promise<void>((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(abort.signal.reason);};const timer=setTimeout(()=>{abort.signal.removeEventListener('abort',stop);resolve();},3000);abort.signal.addEventListener('abort',stop,{once:true});if(abort.signal.aborted)stop();});
          }
          const asset_id=await handlers.current.renderCaptured(request,abort.signal);abort.signal.throwIfAborted();
          await studioRequest(endpoint,{...body,action:'complete',asset_id},abort.signal);
        }catch(error){
          if(!abort.signal.aborted){notifyError(error instanceof Error?error.message:'Clip rendering failed');await studioRequest(endpoint,{...body,action:'fail'}).catch(()=>{});}
        }
      })();
    }
  },[controller.active,projectId]);
}
