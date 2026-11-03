import { useEffect, useState } from 'react'

// Keep closing panels mounted until their exit animation has completed.
export function usePanelPresence(open: boolean) {
  const [retained, setRetained] = useState(open)
  useEffect(() => {
    if (open) {
      setRetained(true)
      return
    }
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200
    const timer = window.setTimeout(() => setRetained(false), delay)
    return () => window.clearTimeout(timer)
  }, [open])
  return open || retained
}
