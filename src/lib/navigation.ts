let confirmNavigation: (() => boolean | Promise<boolean>) | undefined

export function registerNavigationGuard(guard: () => boolean | Promise<boolean>) {
  confirmNavigation = guard
  return () => {
    if (confirmNavigation === guard) confirmNavigation = undefined
  }
}

// Internal departures ask explicitly: embedded browsers may silently cancel native dialogs.
export async function navigate(path:string,options?:{replace?:boolean}) {
  if (confirmNavigation && !await confirmNavigation()) return
  if(options?.replace)window.location.replace(path)
  else window.location.assign(path)
}

let discardPrompt: (() => Promise<boolean>) | undefined
export function registerDiscardPrompt(prompt: () => Promise<boolean>) {
  discardPrompt = prompt
  return () => { if (discardPrompt === prompt) discardPrompt = undefined }
}
// Modal dismissal reuses the same unsaved-changes dialog as document departures.
export function requestDiscard() { return discardPrompt?.() ?? Promise.resolve(false) }
