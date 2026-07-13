import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** Keys that insert or edit text in a field — keep them from bubbling to Tabs/Dialog handlers. */
export function stopTypingKeyPropagation(e: ReactKeyboardEvent) {
  if (
    e.key === ' ' ||
    e.key === 'Backspace' ||
    e.key === 'Delete' ||
    (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)
  ) {
    e.stopPropagation()
  }
}

export function isTextEntryTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  )
}
