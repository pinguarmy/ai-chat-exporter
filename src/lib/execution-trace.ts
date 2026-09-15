import type { ExecutionEvent } from './types'

/** Provider-exposed tool events only. Never infer hidden reasoning or duration. */
export function extractChatGptEvents(nodes: any[]): ExecutionEvent[] {
  return nodes.flatMap((node, index) => {
    const msg = node?.message
    if (!msg || msg.metadata?.is_visually_hidden_from_conversation) return []
    const role = msg.author?.role || msg.role
    const recipient = typeof msg.recipient === 'string' && msg.recipient !== 'all' ? msg.recipient : undefined
    if (role !== 'tool' && !(role === 'assistant' && recipient)) return []
    const parts = Array.isArray(msg.content?.parts) ? msg.content.parts : []
    return [{
      id: msg.id || node.id || `event-${index}`, parentId: node.parent || undefined,
      kind: role === 'tool' ? 'tool_result' : 'tool_call',
      toolName: role === 'tool' ? msg.author?.name || 'unknown' : recipient!,
      callId: typeof msg.metadata?.tool_call_id === 'string' ? msg.metadata.tool_call_id : undefined,
      timestamp: typeof msg.create_time === 'number' && Number.isFinite(msg.create_time) ? msg.create_time * 1000 : undefined,
      status: msg.metadata?.is_error === true ? 'error' : 'unknown',
      content: parts.map((p: unknown) => typeof p === 'string' ? p : p && typeof p === 'object' && 'text' in p ? String(p.text) : '').join('\n'),
    } as ExecutionEvent]
  })
}

export function toolSummary(events: ExecutionEvent[] | undefined): string[] {
  const counts = new Map<string, number>()
  for (const event of events || []) {
    if (event.kind === 'tool_call') counts.set(event.toolName, (counts.get(event.toolName) || 0) + 1)
  }
  return [...counts].map(([name, count]) => `${name.replace(/[\r\n<>]/g, ' ')} × ${count}`)
}
