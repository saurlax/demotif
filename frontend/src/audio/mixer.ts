import type { AutomationLane, MixerChannel, Project } from './model'

// Duplicate-time points describe steps. The last point at that time wins.
export function automationValue(
  points: AutomationLane['points'],
  time: number,
) {
  if (!points.length) return 0
  let previous = points[0]
  for (const next of points) {
    if (next.time > time) {
      if (time <= previous.time) return previous.value
      const t = (time - previous.time) / (next.time - previous.time)
      return previous.value + (next.value - previous.value) * t
    }
    previous = next
  }
  return previous.value
}
export function scheduleAutomation(
  param: AudioParam,
  lane: AutomationLane,
  from: number,
  when: number,
) {
  if (!lane.points.length) return
  param.setValueAtTime(automationValue(lane.points, from), when)
  for (let i = 0; i < lane.points.length; i++) {
    const point = lane.points[i]
    if (point.time <= from) continue
    const at = when + point.time - from
    if (i && point.time === lane.points[i - 1].time)
      param.setValueAtTime(point.value, at)
    else param.linearRampToValueAtTime(point.value, at)
  }
}
export function defaultMixer(): NonNullable<Project['mixer']> {
  return { master: { id: 'master', name: 'Master', gain: 1 }, buses: [] }
}
// Validate all routes before creating nodes, including unreferenced buses.
export function mixerOrder(buses: MixerChannel[]) {
  const byId = new Map(buses.map((b) => [b.id, b]))
  if (byId.size !== buses.length || byId.has('master'))
    throw new Error('混音总线 ID 重复')
  const pending = new Set<string>(),
    visited = new Set<string>(),
    ordered: MixerChannel[] = []
  const visit = (bus: MixerChannel) => {
    if (visited.has(bus.id)) return
    if (pending.has(bus.id)) throw new Error('混音路由不能形成循环')
    pending.add(bus.id)
    if (bus.busId) {
      const destination = byId.get(bus.busId)
      if (!destination) throw new Error('混音总线不存在')
      visit(destination)
    }
    pending.delete(bus.id)
    visited.add(bus.id)
    ordered.push(bus)
  }
  for (const bus of buses) visit(bus)
  return ordered
}
