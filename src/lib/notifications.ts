import { toast } from 'sonner'

export function notifyError(error: unknown, id?: string, duration = 6000) {
  const message = (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/, '')
  return toast.error(message, { id: id ?? `error:${message}`, duration })
}
