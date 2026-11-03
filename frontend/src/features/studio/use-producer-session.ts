import { useState } from 'react'
import type { ProducerCommand } from '@/types/project'

export interface ChatMessage {
  id: string
  role: 'producer' | 'user'
  text: string
  commands?: ProducerCommand[]
  applied?: boolean
}

export function useProducerSession(projectId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'producer',
      text: 'Tell me what to change, or describe the part you hear in your head. I will propose edits before applying them.',
    },
  ])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [applyingFor, setApplyingFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [activeProjectId, setActiveProjectId] = useState(projectId)
  if (activeProjectId !== projectId) {
    setActiveProjectId(projectId)
    setMessages([{ id: 'welcome', role: 'producer', text: 'Tell me what to change. I will propose edits before applying them.' }])
    setDraft('')
    setError(null)
  }
  return { messages, setMessages, draft, setDraft, sending, setSending, applyingFor, setApplyingFor, error, setError }
}
