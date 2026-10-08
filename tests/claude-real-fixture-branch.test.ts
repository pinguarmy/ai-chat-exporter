import { beforeAll, describe, expect, it, vi } from 'vitest'
import claudeRealFixture from './fixtures/providers/claude/2026-08-24-normal.json'

type ClaudeParserModule = typeof import('../src/contents/claude-parser')

let parserModule: ClaudeParserModule

const details = (claudeRealFixture as any).payload.raw.details as Array<Record<string, any>>

describe('Claude real API fixture', () => {
  beforeAll(async () => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } },
      runtime: { onMessage: { addListener: vi.fn() }, getURL: vi.fn((path: string) => path) },
    })
    parserModule = await import('../src/contents/claude-parser')
  })

  it('roots every captured conversation at the fixed root-parent placeholder', () => {
    for (const detail of details) {
      const ids = new Set(detail.chat_messages.map((m: any) => m.uuid))
      const missing = new Set(
        detail.chat_messages.map((m: any) => m.parent_message_uuid).filter((p: string) => !ids.has(p))
      )
      expect([...missing]).toEqual([parserModule.CLAUDE_ROOT_PARENT_UUID])
    }
  })

  it('resolves each captured active branch as complete', () => {
    for (const detail of details) {
      const result = parserModule.resolveClaudeActiveBranch(detail.chat_messages, detail)
      expect(result.complete).toBe(true)
      expect(result.issue).toBeUndefined()
      expect(result.records.at(-1)?.uuid).toBe(detail.current_leaf_message_uuid)
    }
  })

  it('keeps only the active branch when the first message was edited', () => {
    const edited = details.find(detail => detail.chat_messages.length === 3)!
    const result = parserModule.resolveClaudeActiveBranch(edited.chat_messages, edited)
    expect(result.complete).toBe(true)
    expect(result.records).toHaveLength(2)
  })

  it('exports a captured conversation as a verified API source', async () => {
    const detail = details[0]
    const orgId = '11111111-1111-4111-8111-111111111111'
    document.body.innerHTML = `<script>https://claude.ai/api/organizations/${orgId}/chat_conversations</script>`
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => detail })))
    try {
      const conversation = await new parserModule.ClaudeParser().fetchConversationDetail(detail.uuid)
      expect(conversation?.source).toBe('api')
      expect(conversation?.sourceCompleteness).toBe('verified')
      expect(conversation?.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('still refuses a chain whose parent is genuinely absent', () => {
    const detail = structuredClone(details[0])
    detail.chat_messages[0].parent_message_uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const result = parserModule.resolveClaudeActiveBranch(detail.chat_messages, detail)
    expect(result.complete).toBe(false)
    expect(result.issue).toBe('missing_parent')
  })
})
