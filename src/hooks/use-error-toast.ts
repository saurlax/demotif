import { useEffect } from 'react'
import { toast } from 'sonner'
import { notifyError } from '@/lib/notifications'

// One notification per error state; repeated polling and keystrokes do not stack it.
export function useErrorToast(message: string | null | undefined, id: string) {
  useEffect(() => {
    if (!message) { toast.dismiss(id); return }
    const timer = setTimeout(() => notifyError(message, id, Infinity), 250)
    return () => { clearTimeout(timer); toast.dismiss(id) }
  }, [message, id])
}
