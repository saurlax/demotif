import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { usePanelPresence } from '@/components/use-panel-presence'

export function BottomPanel({ open, height, children }: {
  open: boolean
  height: number
  children: (interactive: boolean) => ReactNode
}) {
  const present = usePanelPresence(open)
  const previous = useRef(children)
  useLayoutEffect(() => { if (open) previous.current = children }, [open, children])
  if (!present) return null
  const render = open ? children : previous.current
  return <div className="studio-bottom-panel relative min-h-0 shrink-0"
    data-state={open ? 'open' : 'closed'} inert={!open} aria-hidden={!open}
    style={{ '--panel-height': `${height}px` } as CSSProperties}>
    <div className="studio-bottom-panel-content flex min-h-0 flex-col">{render(open)}</div>
  </div>
}
