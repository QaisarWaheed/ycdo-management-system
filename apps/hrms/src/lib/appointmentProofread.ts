export const SAVE_BEFORE_PRINT_MESSAGE = 'Save changes before printing.'

export function printDraftBlockedReason(
  hasUnsavedChanges: boolean,
): string | null {
  return hasUnsavedChanges ? SAVE_BEFORE_PRINT_MESSAGE : null
}
