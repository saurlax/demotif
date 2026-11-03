import { ArrowUp, Check, Loader2, Sparkles, Wand2 } from 'lucide-react'
import type { ChatMessage, useProducerSession } from './use-producer-session'

import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Message, MessageAvatar, MessageContent, MessageGroup, MessageHeader } from '@/components/ui/message'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ApiError, applyCommand, sendProducerMessage } from '@/lib/api'
import type { ProducerCommand, Project } from '@/types/project'


function describeCommand(command: ProducerCommand): string {
  switch (command.type) {
    case 'project.set_tempo':
      return `Tempo → ${command.tempo} BPM`
    case 'project.rename':
      return `Rename → ${command.name}`
    case 'track.add':
      return `Add ${command.kind} track “${command.name}”`
    case 'track.remove':
      return `Remove track`
    case 'track.set_lock':
      return `${command.locked ? 'Lock' : 'Unlock'} track`
    case 'clip.add':
      return `Add clip “${command.name}”`
    case 'clip.move':
      return `Move clip to beat ${command.start_beat}`
    case 'clip.remove':
      return 'Remove clip'
  }
}

interface ProducerPanelProps {
  project: Project
  session: ReturnType<typeof useProducerSession>
  onProjectChange: (project: Project) => void
}

export function ProducerPanel({ project, onProjectChange, session }: ProducerPanelProps) {
  const { messages, setMessages, draft, setDraft, sending, setSending, applyingFor, setApplyingFor, error, setError } = session

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text }])
    setDraft('')
    try {
      const reply = await sendProducerMessage(project.id, project.version, text)
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'producer', text: reply.reply, commands: reply.commands },
      ])
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The producer could not answer.')
    } finally {
      setSending(false)
    }
  }

  async function apply(message: ChatMessage) {
    if (!message.commands?.length) return
    setApplyingFor(message.id)
    setError(null)
    let latest = project
    try {
      for (const command of message.commands) {
        const result = await applyCommand(latest.id, latest.version, command)
        latest = result.project
        onProjectChange(latest)
      }
      setMessages((current) => current.map((item) => (item.id === message.id ? { ...item, applied: true } : item)))
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Some edits could not be applied.')
    } finally {
      setApplyingFor(null)
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-sidebar">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border px-4 pr-12">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-sm font-medium">Producer</span>
        <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
          local stub
        </Badge>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <MessageGroup className="gap-5 p-3">
          {messages.map((message) => (
            <Message key={message.id} align={message.role === 'user' ? 'end' : 'start'}>
              {message.role === 'producer' && (
                <MessageAvatar className="size-8 self-start">
                  <Sparkles className="size-4 text-primary" />
                </MessageAvatar>
              )}
              <MessageContent className="gap-1.5">
                <MessageHeader className="px-2">
                  {message.role === 'producer' ? 'Producer' : 'You'}
                </MessageHeader>
                <Bubble
                  align={message.role === 'user' ? 'end' : 'start'}
                  variant={message.role === 'user' ? 'default' : 'secondary'}
                >
                  <BubbleContent className="text-xs">{message.text}</BubbleContent>
                </Bubble>

                {message.commands && message.commands.length > 0 && (
                  <Bubble align="start" variant="outline" className="w-full max-w-full">
                    <BubbleContent className="w-full space-y-1.5">
                      {message.commands.map((command, index) => (
                        <div key={index} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Wand2 className="size-3 shrink-0" />
                          <span className="truncate">{describeCommand(command)}</span>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant={message.applied ? 'ghost' : 'secondary'}
                        className="mt-1 w-full"
                        disabled={message.applied || applyingFor !== null}
                        onClick={() => void apply(message)}
                      >
                        {applyingFor === message.id ? (
                          <Loader2 className="animate-spin" />
                        ) : message.applied ? (
                          <Check />
                        ) : null}
                        {message.applied
                          ? 'Applied'
                          : `Apply ${message.commands.length} edit${message.commands.length > 1 ? 's' : ''}`}
                      </Button>
                    </BubbleContent>
                  </Bubble>
                )}
              </MessageContent>
            </Message>
          ))}

          {error && (
            <Bubble align="start" variant="destructive" className="max-w-full">
              <BubbleContent className="text-[11px]">{error}</BubbleContent>
            </Bubble>
          )}
        </MessageGroup>
      </ScrollArea>

      <div className="shrink-0 border-t border-border/70 p-3">
        <InputGroup className="h-auto flex-col items-stretch">
          <InputGroupTextarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder="Make the chorus feel wider…"
            aria-label="Message Producer" className="min-h-[64px]"
          />
          <InputGroupAddon align="block-end" className="justify-between">
            <InputGroupText className="text-[10px]">Enter to send</InputGroupText>
            <InputGroupButton
              size="icon-xs"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              aria-label="Send message"
            >
              {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </aside>
  )
}
