import { ArrowUp, Undo2, Loader2, Sparkles, Square, Wand2, AudioLines, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  Message,
    MessageContent,
  MessageGroup,
  MessageHeader,
} from '@/components/ui/message'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import type { Project } from '@/types/project'
import {ProducerMarkdown} from './producer-markdown'
import type {useClipAudioActions} from './clip-audio-actions'
import {selectClass} from './controls'
import type {useProducerVoice} from './use-producer-voice'
import type {
  useProducerController,
} from './use-producer-controller'

export function ProducerPanel({
  project,
  session,
  audio,
  voice,
  onUndo,
}: {
  project: Project
  onUndo:()=>void
  session: ReturnType<typeof useProducerController>
  audio: ReturnType<typeof useClipAudioActions>
  voice: ReturnType<typeof useProducerVoice>
}) {
  const {runs,ready,draft,setDraft,sending,active,base,load,send,publicEvents}=session
  return (
    <aside className="studio-producer flex h-full min-h-0 w-full flex-col bg-sidebar">
      <div className="producer-header flex h-14 shrink-0 items-center gap-2 border-b px-4 max-lg:pr-12">
        <span className="producer-mark"><Sparkles className="size-4" /></span>
        <span className="text-sm font-medium">Producer</span>
        <Badge
          variant="outline"
          className={`producer-status ml-auto text-xs ${ready ? 'is-ready' : 'text-muted-foreground'}`}
        >
          {ready ? 'Ready' : 'Not configured'}
        </Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageGroup className="gap-5 p-3">
          {!runs.length && (
            <p className="p-2 text-sm text-muted-foreground">
              No messages yet.
            </p>
          )}
          {runs.map((run) => (
            <div key={run.id} className="space-y-3">
              {run.prompt&&<Message align="end">
                <MessageContent>
                  <MessageHeader>You</MessageHeader>
                  {run.events.find(e=>e.type==='context')?.context&&(()=>{
                    const context=run.events.find(e=>e.type==='context')!.context!
                    const clip=project.document.tracks.flatMap(t=>t.clips).find(c=>c.id===context.clip_id)
                    const source=project.document.sources.find(s=>s.id===(context.source_id??clip?.source_id))
                    const label=clip?.name??source?.name??(context.clip_id?'Referenced Clip':'Selected location')
                    return <span className="break-words text-xs text-muted-foreground">{label}{context.note_ids?.length?` · ${context.note_ids.length} notes`:''}</span>
                  })()}
                  <Bubble align="end" variant="tinted">
                    <BubbleContent className="whitespace-pre-wrap text-sm">
                      {run.prompt}
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>}
              <Message align="start">
                <MessageContent className="min-w-0">
                  <MessageHeader>Producer</MessageHeader>
                  {publicEvents(run).filter(e=>e.type!=='error').map((e) =>
                    e.type === 'tool' ? (
                      <div
                        key={e.seq}
                        className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground"
                      >
                        <Wand2 className="size-3" />
                        {e.text}
                      </div>
                    ) : (
                      <ProducerMarkdown key={e.seq}>{e.text}</ProducerMarkdown>
                    ),
                  )}
                  {run.status === 'running' ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      Working
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Stop producer"
                        onClick={() =>
                          void fetch(`${base}/runs/${run.id}/cancel`, {
                            method: 'POST',
                          }).then(() => load())
                        }
                      >
                        <Square />
                      </Button>
                    </div>
                  ) : run.status !== 'complete' ? (
                    <span className="px-2 text-xs text-muted-foreground">
                      {run.status}
                    </span>
                  ) : null}
                  {run.applied&&<Button size="sm" variant="ghost" className="w-fit self-start" disabled={!!active||!project.can_undo||project.version!==run.base_version+1} onClick={onUndo}><Undo2/>Undo changes</Button>}

                </MessageContent>
              </Message>
            </div>
          ))}
        </MessageGroup>

      </div>
      <div className="shrink-0 border-t p-3">
        {voice.open?<div className="flex flex-wrap items-center gap-2">
          <div role="status" className="flex min-w-0 flex-1 items-center gap-2 text-sm"><AudioLines className="size-4 shrink-0 text-primary"/><span>{voice.label}</span></div>
          <Button size="icon" variant="ghost" aria-label="End voice chat" onClick={voice.end}><PhoneOff/></Button>
        </div>:<InputGroup className="h-auto flex-col items-stretch">
          <InputGroupTextarea
            disabled={voice.open}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send(audio.context??undefined)
              }
            }}
            placeholder="Develop this idea…"
            aria-label="Message Producer"
            className="min-h-16"
          />
          <InputGroupAddon align="block-end" className="flex-wrap justify-end">
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <select aria-label="Producer model" className={`${selectClass} max-w-48 border-0 bg-transparent`} value={session.model} disabled={sending||!!active||voice.open} onChange={e=>session.setModel(e.target.value)}>
                {session.models.map(model=><option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
            <InputGroupButton
              size="icon-xs"
              disabled={!(draft.trim()?ready:voice.ready) || sending || !!active || audio.busy || voice.open}
              aria-label={draft.trim()?'Send message':'Start voice chat'}
              onClick={() => draft.trim()?void send(audio.context??undefined):voice.start()}
            >
              {sending ? <Loader2 className="animate-spin" /> : draft.trim()?<ArrowUp />:<AudioLines/>}
            </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>}
      </div>
    </aside>
  )
}
