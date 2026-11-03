// Adapted from official base-nova/sidebar-15; calendar content becomes Producer.
import { useState, type ReactNode, type CSSProperties } from 'react'
import { usePanelPresence } from '@/components/use-panel-presence'
import { Sidebar, SidebarContent } from '@/components/ui/sidebar'

export function SidebarRight({
  children,
  open,
}: {
  children: ReactNode
  open: boolean
}) {
  const [width, setWidth] = useState(288)
  const present = usePanelPresence(open)
  if (!present) return null
  return (
    <div className="studio-side-panel sticky top-0 hidden h-svh shrink-0 lg:block"
      data-side="right" data-state={open ? 'open' : 'closed'} inert={!open}
      style={{ '--panel-width': `${width}px` } as CSSProperties}>
    <Sidebar
      style={{ '--sidebar-width': `${width}px`, width } as CSSProperties}
      collapsible="none"
      className="studio-side-panel-content relative h-svh shrink-0 border-l"
    >
      <div
        role="separator"
        aria-label="Resize Producer"
        className="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize hover:bg-border"
        onPointerDown={(e) => {
          const x = e.clientX,
            initial = width
          const move = (ev: PointerEvent) =>
            setWidth(Math.max(256, Math.min(520, initial + x - ev.clientX)))
          const end = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', end)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', end, { once: true })
        }}
      />
      <SidebarContent className="overflow-hidden">{children}</SidebarContent>
    </Sidebar>
    </div>
  )
}
