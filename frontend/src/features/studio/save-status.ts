// Count work from enqueue until completion, including overlapping uploads and edits.
export function createSaveTracker(onChange: (saving: boolean) => void) {
  let pending = 0
  return {
    isSaving: () => pending > 0,
    begin() {
      pending++
      onChange(true)
      let complete = false
      return () => {
        if (complete) return
        complete = true
        pending--
        onChange(pending > 0)
      }
    },
  }
}

export function hasDraftChanges(root: Pick<Document, 'querySelectorAll'>) {
  if (root.querySelectorAll('[data-unsaved="true"]').length) return true
  return [...root.querySelectorAll<HTMLInputElement>('input[data-saved-value]')].some((input) => {
    const saved = input.dataset.savedValue ?? ''
    return input.type === 'number'
      ? !input.value.trim() || Number(input.value) !== Number(saved)
      : input.value !== saved
  })
}
