/** Bound a UI read without allowing late provider replies to replace fallback state. */
export function withReadTimeout<T>(read: Promise<T>, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Provider read timed out')), timeoutMs)
    read.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

type HistoryResponse = {
  data?: unknown
  error?: string
  meta?: Record<string, unknown>
}

/** An account request may stall even while the sidebar remains readable. */
export async function readConversationHistory(
  send: (type: 'FETCH_ALL_CONVERSATIONS' | 'FETCH_CONVERSATION_LIST') => Promise<HistoryResponse>,
  timeoutMs = 30_000,
): Promise<HistoryResponse> {
  let failure: string | undefined
  let authRequired = false
  try {
    const response = await withReadTimeout(send('FETCH_ALL_CONVERSATIONS'), timeoutMs)
    authRequired = response.meta?.authRequired === true
    if (Array.isArray(response.data)) return response
    failure = response.error
  } catch (error) {
    failure = error instanceof Error ? error.message : 'History request failed'
  }
  const sidebar = await withReadTimeout(send('FETCH_CONVERSATION_LIST'), 5_000)
  if (!Array.isArray(sidebar.data)) throw new Error('History request failed')
  return {
    data: sidebar.data,
    error: failure,
    meta: { source: 'sidebar', complete: false, authRequired },
  }
}
