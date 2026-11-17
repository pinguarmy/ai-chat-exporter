/** Shared cancellation semantics for foreground and background export queues. */
export const EXPORT_CANCELLED_MESSAGE = 'Export cancelled'

export function isExportCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === EXPORT_CANCELLED_MESSAGE
}

export function throwIfExportCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(EXPORT_CANCELLED_MESSAGE)
}
