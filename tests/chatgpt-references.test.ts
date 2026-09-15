import { describe, it, expect } from 'vitest'
import { normalizeChatGptReferences } from '../src/lib/chatgpt-references'
import { renderCitationContent } from '../src/lib/message-references'
import { extractChatGptEvents } from '../src/lib/execution-trace'
import { transcriptMetadata } from '../src/lib/transcript-metadata'

describe('provider references and provenance', () => {
  it('resolves nested sources at the original position and respects off/public modes', () => {
    const marker = '\uE200cite\uE202turn0search0\uE201'
    const parsed = normalizeChatGptReferences(`Before ${marker} after`, [{ type: 'webpage', matched_text: marker, items: [{ title: 'Example', url: 'https://example.com', ref_id: 'turn0search0' }] }])
    const message = { id: 'a', role: 'assistant' as const, ...parsed }
    expect(parsed.content).toBe('Before [Example] after')
    expect(renderCitationContent(message, 'off')).toBe('Before  after')
    expect(renderCitationContent(message, 'safe-links')).toContain('[Example](https://example.com/)')
  })
  it('restores entity labels, records unresolved markers, and preserves code samples', () => {
    const entity = '\uE200entity\uE202["company","Example","software"]\uE201'
    const unresolved = '\uE200cite\uE202turn8search0\uE201'
    const result = normalizeChatGptReferences(`${entity} ${unresolved} \`${unresolved}\``, [])
    expect(result.content).toBe(`Example [Unresolved reference] \`${unresolved}\``)
    expect(result.referenceDiagnostics).toEqual([{ code: 'unresolved_provider_reference', marker: unresolved }])
  })
  it('keeps event ordering without inventing success, correlation or duration', () => {
    const events = extractChatGptEvents([
      { message: { id: 'call', author: { role: 'assistant' }, recipient: 'web.run', content: { parts: ['query'] } } },
      { parent: 'call', message: { id: 'result', author: { role: 'tool', name: 'web.run' }, content: { parts: ['result'] } } },
      { message: { author: { role: 'tool' }, metadata: { is_visually_hidden_from_conversation: true } } },
    ])
    expect(events.map(e => e.kind)).toEqual(['tool_call', 'tool_result'])
    expect(events[1].parentId).toBe('call')
    expect(events[1].status).toBe('unknown')
    expect(events[0].callId).toBeUndefined()
  })
  it('retains provider time separately and accepts epoch zero', () => {
    const result = transcriptMetadata({ id: 'c', title: '', url: '', platform: 'chatgpt', createdAt: 4000, messages: [{ id: 'u', role: 'user', content: '', timestamp: 0 }, { id: 'a', role: 'assistant', content: '', timestamp: 2000, modelName: 'model-a' }] }, 10000)
    expect(result.first_visible_message_at).toBe('1970-01-01T00:00:00.000Z')
    expect(result.provider_created_at).toBe('1970-01-01T00:00:04.000Z')
    expect(result.models_observed).toEqual(['model-a'])
  })
})
