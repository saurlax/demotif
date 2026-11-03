import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { AudioEngine } from '@/audio/audio'
import type { Project } from '@/types/project'
import { ClipPreviewContents, type PreviewClip } from './clip-preview-card'

// Both drag origins use the same overlay, palette and motion. Pointer velocity
// adds a small lean that settles when the pointer stops; sway is shared in CSS.
export function ClipDragPreview({ project, clip, engine, x, y, color, invalid = false, trailing }: {
  project: Project
  clip: PreviewClip
  engine: AudioEngine
  x: number
  y: number
  color: string
  invalid?: boolean
  trailing?: string
}) {
  const pointer = useRef({ x, time: 0 })
  const motion = useRef({ target: 0, angle: 0 })
  const [tilt, setTilt] = useState(0)
  useEffect(() => {
    const now = performance.now()
    const elapsed = Math.max(8, now - pointer.current.time)
    motion.current.target = Math.max(-4, Math.min(4, (x - pointer.current.x) / elapsed * 2))
    pointer.current = { x, time: now }
  }, [x])
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame: number, previous = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(50, now - previous)
      previous = now
      motion.current.target *= Math.exp(-dt / 90)
      motion.current.angle += (motion.current.target - motion.current.angle) * (1 - Math.exp(-dt / 65))
      setTilt(motion.current.angle)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return createPortal(
    <div className="clip-drag-overlay studio-edit-surface" aria-hidden="true"
      style={{ left: x - 24, top: y - 24, '--drag-tilt': `${tilt}deg`,
        '--clip-color': color, '--beat-duration': `${60 / project.document.tempo}s` } as CSSProperties}>
      <div className="clip-drag-card" data-invalid={invalid}>
        <ClipPreviewContents project={project} clip={clip} engine={engine} trailing={trailing} />
      </div>
    </div>, document.body,
  )
}
