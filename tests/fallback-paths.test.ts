import { beforeAll, describe, expect, it, vi } from 'vitest'
import claudeRealFixture from './fixtures/providers/claude/2026-08-24-normal.json'

const ok = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body })
const status = (code: number) => ({ ok: false, status: code, headers: new Headers(), json: async () => ({}) })

describe('fallbacks instead of dead ends', () => {
  beforeAll(() => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } },
      runtime: { onMessage: { addListener: vi.fn() }, getURL: vi.fn((path: string) => path) },
    })
  })

  it('opens a Claude conversation that lives under another membership', async () => {
    const { ClaudeParser } = await import('../src/contents/claude-parser')
    const detail = (claudeRealFixture as any).payload.raw.details[0]
    const pageOrg = '11111111-1111-4111-8111-111111111111'
    const otherOrg = '22222222-2222-4222-8222-222222222222'
    document.body.innerHTML = `<script>https://claude.ai/api/organizations/${pageOrg}/chat_conversations</script>`
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url)
      if (target.endsWith('/api/bootstrap')) {
        return ok({ account: { memberships: [{ organization: { uuid: pageOrg } }, { organization: { uuid: otherOrg } }] } })
      }
      if (target.includes(`/organizations/${pageOrg}/chat_conversations/`)) return status(404)
      if (target.includes(`/organizations/${otherOrg}/chat_conversations/`)) return ok(detail)
      return status(404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const parser = new ClaudeParser()
    const conversation = await parser.fetchConversationDetail(detail.uuid)
    expect(conversation?.sourceCompleteness).toBe('verified')
    expect(parser.isAuthenticationRequired()).toBe(false)
    document.body.innerHTML = ''
  })

  it('captures an unverified page snapshot from the rendered DOM only', async () => {
    const { createDomSnapshotSupport } = await import('../src/lib/dom-snapshot')
    const parser = {
      parseCurrentConversation: vi.fn(async () => ({
        id: 'c1', title: 'Chat', url: 'https://claude.ai/chat/c1', platform: 'claude' as const,
        messages: [
          { id: 'm1', role: 'user' as const, content: 'Question' },
          { id: 'm2', role: 'assistant' as const, content: 'Answer' },
        ],
      })),
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const support = createDomSnapshotSupport(parser, '[data-testid="chat-message"]')
    const before = support.getSnapshotContext()
    const snapshot = await support.capturePageSnapshot()
    expect(snapshot.kind).toBe('page-snapshot')
    expect(snapshot.conversation.sourceCompleteness).toBe('unverified')
    expect(snapshot.conversation.verification?.transcript.verified).toBe(false)
    expect(snapshot.conversation.messages).toHaveLength(2)
    expect(support.getSnapshotContext()).toEqual(before)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an empty page snapshot with a safe message', async () => {
    const { createDomSnapshotSupport } = await import('../src/lib/dom-snapshot')
    const support = createDomSnapshotSupport({ parseCurrentConversation: async () => null }, 'article')
    await expect(support.capturePageSnapshot()).rejects.toThrow('No capturable conversation content')
  })

  it('answers CAPTURE_PAGE_SNAPSHOT on Claude through the registered content script', async () => {
    vi.resetModules()
    const addListener = vi.fn()
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } },
      runtime: { onMessage: { addListener }, getURL: vi.fn((path: string) => path), sendMessage: vi.fn(async () => ({})) },
    })
    window.history.replaceState({}, '', '/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">Question</div>
        <div data-testid="assistant-message"><div class="prose"><p>Answer</p></div></div>
      </main>
    `
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await import('../src/contents/claude-parser')
    const listener = addListener.mock.calls.at(-1)?.[0]
    const response = await new Promise<any>(resolve => {
      listener({ type: 'CAPTURE_PAGE_SNAPSHOT', data: { requestId: 'req-1' } }, {}, resolve)
    })
    expect(response.error).toBeUndefined()
    expect(response.data.kind).toBe('page-snapshot')
    expect(response.data.conversation.platform).toBe('claude')
    expect(response.data.conversation.sourceCompleteness).toBe('unverified')
    expect(response.meta.requestId).toBe('req-1')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/chat_conversations/'), expect.anything())
    document.body.innerHTML = ''
  })
})
