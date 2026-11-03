import { describe, expect, it } from 'vitest'
import { createSaveTracker, hasDraftChanges } from './save-status'

describe('departure save guard', () => {
  it('stays dirty until every queued edit and overlapping upload completes', () => {
    const states: boolean[] = []
    const tracker = createSaveTracker((saving) => states.push(saving))
    expect(tracker.isSaving()).toBe(false)
    const uploadDone = tracker.begin()
    const editDone = tracker.begin()
    const queuedEditDone = tracker.begin()
    editDone()
    uploadDone()
    expect(tracker.isSaving()).toBe(true)
    queuedEditDone()
    expect(tracker.isSaving()).toBe(false)
    queuedEditDone()
    expect(states).toEqual([true, true, true, true, true, false])
  })

  it('detects uncommitted fields while treating numeric formatting as unchanged', () => {
    const input = { type: 'number', value: '120.0', dataset: { savedValue: '120' } }
    const root = { querySelectorAll: (selector: string) => selector.startsWith('input') ? [input] : [] } as unknown as Document
    expect(hasDraftChanges(root)).toBe(false)
    input.value = '121'
    expect(hasDraftChanges(root)).toBe(true)
    input.value = ''
    expect(hasDraftChanges(root)).toBe(true)
    input.type = 'text'
    input.value = input.dataset.savedValue = 'Piano'
    expect(hasDraftChanges(root)).toBe(false)
    input.value = 'Piano 2'
    expect(hasDraftChanges(root)).toBe(true)
  })
  it('protects a slider draft before its release submits the edit', () => {
    let dragging = true
    const root = { querySelectorAll: (selector: string) =>
      selector.includes('data-unsaved') && dragging ? [{}] : [],
    } as unknown as Document
    expect(hasDraftChanges(root)).toBe(true)
    dragging = false
    expect(hasDraftChanges(root)).toBe(false)
  })

})
