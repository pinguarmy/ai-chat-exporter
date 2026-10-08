import { beforeAll, describe, expect, it, vi } from 'vitest'
import chatgpt from './fixtures/providers/chatgpt/2026-08-24-normal.json'
import claude from './fixtures/providers/claude/2026-08-24-normal.json'
import gemini from './fixtures/providers/gemini/2026-08-24-normal.json'
import deepseek from './fixtures/providers/deepseek/2026-08-24-normal.json'
import grok from './fixtures/providers/grok/2026-08-24-normal.json'

/**
 * Every provider's sanitized real API capture must come out of the parser as a
 * verified source. Hand-written payloads drifted from the real shape once
 * (Claude's root-parent placeholder), which blocked every Claude export while
 * all synthetic tests passed. These fixtures are the guard against that.
 */

const ok = (body: unknown, text?: string) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => body,
  text: async () => text ?? JSON.stringify(body),
})

function expectVerified(conversation: any) {
  expect(conversation).not.toBeNull()
  expect(conversation.source).toBe('api')
  expect(conversation.sourceCompleteness).toBe('verified')
  expect(conversation.verification?.transcript?.verified).toBe(true)
  const roles = new Set(conversation.messages.map((message: any) => message.role))
  expect(roles.has('user')).toBe(true)
  expect(roles.has('assistant')).toBe(true)
}

describe('real provider fixtures verify end to end', () => {
  beforeAll(() => {
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
        session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      },
      runtime: { onMessage: { addListener: vi.fn() }, getURL: vi.fn((path: string) => path), sendMessage: vi.fn(async () => ({})) },
    })
  })

  it('ChatGPT', async () => {
    const { ChatGPTParser } = await import('../src/contents/chatgpt-parser')
    const payload = (chatgpt as any).payload
    for (const detail of payload.details) {
      vi.stubGlobal('fetch', vi.fn(async (url: string) =>
        String(url).includes('/api/auth/session') ? ok({ ...payload.session, accessToken: 'token' }) : ok(detail)))
      expectVerified(await new ChatGPTParser().fetchConversationDetail(detail.conversation_id))
    }
  })

  it('Claude', async () => {
    const { ClaudeParser } = await import('../src/contents/claude-parser')
    document.body.innerHTML = '<script>https://claude.ai/api/organizations/11111111-1111-4111-8111-111111111111/chat_conversations</script>'
    for (const detail of (claude as any).payload.raw.details) {
      vi.stubGlobal('fetch', vi.fn(async () => ok(detail)))
      expectVerified(await new ClaudeParser().fetchConversationDetail(detail.uuid))
    }
    document.body.innerHTML = ''
  })

  it('DeepSeek', async () => {
    const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
    for (const detail of (deepseek as any).payload.details) {
      vi.stubGlobal('fetch', vi.fn(async () => ok(detail)))
      expectVerified(await new DeepSeekParser().fetchConversationDetail('session-id'))
    }
  })

  it('Grok', async () => {
    const { GrokParser } = await import('../src/contents/grok-parser')
    for (const detail of (grok as any).payload.details) {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const target = String(url)
        if (target.includes('conversations_v2')) return ok(detail.conversation_v2)
        if (target.includes('response-node')) return ok(detail.response_node)
        if (target.includes('load-responses')) return ok(detail.load_responses)
        return ok({})
      }))
      expectVerified(await new GrokParser().fetchConversationDetail(detail.conversation_v2.conversation.conversationId))
    }
  })

  it('Gemini', async () => {
    const { GeminiParser } = await import('../src/contents/gemini-parser')
    for (const detail of (gemini as any).payload.details) {
      vi.stubGlobal('fetch', vi.fn(async () => ok(null, detail)))
      const parser = new GeminiParser() as any
      parser.getAuthToken = async () => 'token'
      parser.getSessionId = async () => 'session'
      const wireId = String(detail).match(/"c_([0-9a-f]+)/)?.[1] ?? 'conversation'
      expectVerified(await parser.fetchConversationDetail(wireId))
    }
  })
})
