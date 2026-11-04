import { useCallback, useEffect, useRef } from 'react'
import { ArrowUp, Check, Loader2, Sparkles, Square, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageGroup,
  MessageHeader,
} from '@/components/ui/message'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import type { Project } from '@/types/project'
import type {
  useProducerSession,
  ProducerRun as Run,
} from './use-producer-session'

export function ProducerPanel({
  project,
  onProjectChange,
  session,
}: {
  project: Project
  session: ReturnType<typeof useProducerSession>
  onProjectChange: (p: Project) => void
}) {
  const {
    runs,
    setRuns,
    ready,
    setReady,
    draft,
    setDraft,
    sending,
    setSending,
    error,
    setError,
    applying,
    setApplying,
    projectRef,
  } = session
  const base = `/api/projects/${project.id}/producer`
  const load = useCallback(async () => {
    const r = await fetch(base)
    if (!r.ok) throw new Error('Cannot load producer conversation')
    const data = await r.json()
    if (projectRef.current === project.id) {
      setRuns(data.runs)
      setReady(data.ready)
    }
  }, [base, project.id, projectRef, setReady, setRuns])
  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load, setError])
  const active = runs.find((r) => r.status === 'running')
  const activeId = active?.id
  const after = active?.events.at(-1)?.seq ?? 0
  const cursor = useRef(after)
  useEffect(() => {
    cursor.current = after
  }, [after])
  useEffect(() => {
    if (!activeId) return
    const source = new EventSource(
      `${base}/runs/${activeId}/events?after=${cursor.current}`,
    )
    source.onmessage = (e) => {
      const event: import('./use-producer-session').ProducerEvent = JSON.parse(
        e.data,
      )
      setRuns((current) =>
        current.map((r) =>
          r.id === activeId && !r.events.some((e) => e.seq === event.seq)
            ? { ...r, events: [...r.events, event] }
            : r,
        ),
      )
    }
    source.addEventListener('done', () => {
      source.close()
      void load().catch((e) => setError(String(e)))
    })
    return () => source.close()
    // The stream owns its cursor; reconnect uses the last persisted snapshot.
  }, [activeId, base, load, setRuns, setError])
  async function send() {
    const text = draft.trim()
    if (!text || sending || active) return
    setSending(true)
    setError(null)
    try {
      const id = crypto.randomUUID(),
        r = await fetch(`${base}/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, text, expected_version: project.version }),
        })
      if (!r.ok) {
        const body = await r.json()
        throw new Error(body.message ?? 'Producer unavailable')
      }
      setDraft('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSending(false)
    }
  }
  async function apply(run: Run) {
    setApplying(run.id)
    setError(null)
    try {
      const r = await fetch(`${base}/runs/${run.id}/apply`, { method: 'POST' })
      if (!r.ok) {
        const body = await r.json()
        throw new Error(body.message ?? 'Apply failed')
      }
      const result = await r.json()
      onProjectChange(result.project)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplying(null)
    }
  }
  function publicEvents(run: Run) {
    const output: { type: string; text: string; seq: number }[] = []
    for (const e of run.events) {
      if (e.type === 'text') {
        const last = output.at(-1)
        if (last?.type === 'text') last.text += e.delta ?? ''
        else output.push({ type: 'text', text: e.delta ?? '', seq: e.seq })
      } else if (e.type === 'tool')
        output.push({
          type: 'tool',
          text:
            e.name === 'process_audio'
              ? 'Processing audio…'
              : `${e.count ?? 0} edits ${e.status ?? 'proposed'}`,
          seq: e.seq,
        })
      else if (e.type === 'error')
        output.push({
          type: 'error',
          text: e.text ?? 'Run failed',
          seq: e.seq,
        })
      else if (e.type === 'reply' && !output.some((o) => o.type === 'text'))
        output.push({ type: 'text', text: e.text ?? '', seq: e.seq })
    }
    return output
  }
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
              <Message align="end">
                <MessageContent>
                  <MessageHeader>You</MessageHeader>
                  <Bubble align="end" variant="tinted">
                    <BubbleContent className="whitespace-pre-wrap text-sm">
                      {run.prompt}
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
              <Message align="start">
                <MessageAvatar className="size-8 self-start">
                  <Sparkles className="size-4" />
                </MessageAvatar>
                <MessageContent className="min-w-0">
                  <MessageHeader>Producer</MessageHeader>
                  {publicEvents(run).map((e) =>
                    e.type === 'tool' ? (
                      <div
                        key={e.seq}
                        className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground"
                      >
                        <Wand2 className="size-3" />
                        {e.text}
                      </div>
                    ) : (
                      <Bubble
                        key={e.seq}
                        variant={
                          e.type === 'error' ? 'destructive' : 'secondary'
                        }
                      >
                        <BubbleContent className="whitespace-pre-wrap text-sm">
                          {e.text}
                        </BubbleContent>
                      </Bubble>
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
                  ) : (
                    <span className="px-2 text-xs text-muted-foreground">
                      {run.status}
                    </span>
                  )}
                  {run.commands.length > 0 && (
                    <div className="space-y-1 rounded-md border p-2">
                      {run.commands.map((c, i) => (
                        <div
                          key={i}
                          className="truncate text-sm text-muted-foreground"
                        >
                          {c.type.replaceAll('.', ' ').replaceAll('_', ' ')}
                        </div>
                      ))}
                      <Button
                        className="mt-2 w-full"
                        size="sm"
                        variant="secondary"
                        disabled={
                          run.applied ||
                          applying !== null ||
                          run.base_version !== project.version
                        }
                        onClick={() => void apply(run)}
                      >
                        {run.applied ? (
                          <Check />
                        ) : applying === run.id ? (
                          <Loader2 className="animate-spin" />
                        ) : null}
                        {run.applied
                          ? 'Applied'
                          : run.base_version !== project.version
                            ? 'Project changed · ask for fresh edits'
                            : `Apply ${run.commands.length} edits`}
                      </Button>
                    </div>
                  )}
                </MessageContent>
              </Message>
            </div>
          ))}
          {error && (
            <p role="alert" className="p-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </MessageGroup>
      </div>
      <div className="shrink-0 border-t p-3">
        <InputGroup className="h-auto flex-col items-stretch">
          <InputGroupTextarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="Develop this idea…"
            aria-label="Message Producer"
            className="min-h-16"
          />
          <InputGroupAddon align="block-end" className="justify-between">
            <InputGroupText className="text-xs">
              {ready ? 'Enter to send' : 'Configure a model to begin'}
            </InputGroupText>
            <InputGroupButton
              size="icon-xs"
              disabled={!ready || !draft.trim() || sending || !!active}
              aria-label="Send message"
              onClick={() => void send()}
            >
              {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </aside>
  )
}
