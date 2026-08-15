import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../src/lib/types'

type ClaudeParserConstructor = typeof import('../src/contents/claude-parser').ClaudeParser
type ClaudeBranchSelector = typeof import('../src/contents/claude-parser').selectClaudeActiveBranch

let ClaudeParser: ClaudeParserConstructor
let selectClaudeActiveBranch: ClaudeBranchSelector

function conversationWithMessages(count: number): Conversation {
  return {
    id: 'conversation-1',
    title: 'Conversation',
    url: 'https://claude.ai/chat/conversation-1',
    platform: 'claude',
    messages: Array.from({ length: count }, (_, index) => ({
      id: `m-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `message ${index}`,
    })),
  }
}

describe('Claude export integrity regressions', () => {
  beforeAll(async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {})
        }
      },
      runtime: {
        onMessage: { addListener: vi.fn() },
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
      }
    })

    ;({ ClaudeParser, selectClaudeActiveBranch } = await import('../src/contents/claude-parser'))
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
    window.history.replaceState({}, '', '/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })

  it('does not double-count nested streaming and assistant-message wrappers', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">Question</div>
        <div data-is-streaming="false">
          <div data-testid="assistant-message">
            <div class="prose"><p>One answer only.</p></div>
          </div>
        </div>
      </main>
    `

    const conversation = await new ClaudeParser().parseCurrentConversation()
    expect(conversation?.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Question'],
      ['assistant', 'One answer only.'],
    ])
  })

  it('does not turn structured response classes, headings, or code labels into messages', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">Show structured content</div>
        <div data-testid="assistant-message">
          <div class="prose">
            <h3 class="assistant-message-label">Section heading</h3>
            <p>Explanation.</p>
            <pre><code class="user-message-code">const ready = true</code></pre>
          </div>
        </div>
      </main>
    `

    const conversation = await new ClaudeParser().parseCurrentConversation()
    expect(conversation?.messages).toHaveLength(2)
    expect(conversation?.messages[1].content).toContain('### Section heading')
    expect(conversation?.messages[1].content).toContain('const ready = true')
  })

  it('keeps generic legacy turns alongside newer semantic turns in DOM order', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="chat-message" class="human-message-row"><div class="prose">Old question</div></div>
        <div data-testid="chat-message" class="claude-response-row"><div class="prose">Old answer</div></div>
        <div data-testid="user-message">New question</div>
        <div data-is-streaming="false"><div class="prose">New answer</div></div>
      </main>
    `

    const conversation = await new ClaudeParser().parseCurrentConversation()
    expect(conversation?.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Old question'],
      ['assistant', 'Old answer'],
      ['user', 'New question'],
      ['assistant', 'New answer'],
    ])
  })

  it('does not classify unrelated aria labels containing the letters ai as assistant messages', async () => {
    document.body.innerHTML = `
      <main>
        <div aria-label="Email details">Not a chat message</div>
      </main>
    `

    const conversation = await new ClaudeParser().parseCurrentConversation()
    expect(conversation).toBeNull()
  })

  it('keeps an 80-turn linear API branch intact', () => {
    const records = Array.from({ length: 80 }, (_, index) => ({
      uuid: `m-${index}`,
      parent_uuid: index === 0 ? undefined : `m-${index - 1}`,
      sender: index % 2 === 0 ? 'human' : 'assistant',
      content: `message ${index}`,
    }))

    const selected = selectClaudeActiveBranch(records, { current_leaf_message_uuid: 'm-79' })
    expect(selected).toHaveLength(80)
    expect(selected[0].uuid).toBe('m-0')
    expect(selected[79].uuid).toBe('m-79')
  })

  it('rejects a severe API tree collapse instead of returning a silently truncated detail', async () => {
    const orgId = '11111111-1111-4111-8111-111111111111'
    document.body.innerHTML = `<script>https://claude.ai/api/organizations/${orgId}/chat_conversations</script>`

    const records = Array.from({ length: 80 }, (_, index) => {
      if (index < 72) {
        return {
          uuid: `old-${index}`,
          sender: index % 2 === 0 ? 'human' : 'assistant',
          content: `old ${index}`,
        }
      }
      return {
        uuid: `tail-${index}`,
        parent_uuid: index === 72 ? 'missing-parent' : `tail-${index - 1}`,
        sender: index % 2 === 0 ? 'human' : 'assistant',
        content: `tail ${index}`,
      }
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        uuid: 'conversation-1',
        current_leaf_message_uuid: 'tail-79',
        chat_messages: records,
      })
    })))

    try {
      const conversation = await new ClaudeParser().fetchConversationDetail('conversation-1')
      expect(conversation).toBeNull()
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })
})

describe('authoritative API runtime guard', () => {
  it('returns an explicit error instead of a DOM snapshot when required API detail is unavailable', async () => {
    let listener: ((message: any, sender: any, sendResponse: (response: any) => void) => boolean | void) | undefined
    const chromeStub = {
      runtime: {
        onMessage: {
          addListener: vi.fn((callback: typeof listener) => {
            listener = callback
          })
        }
      }
    }
    vi.stubGlobal('chrome', chromeStub)
    window.history.replaceState({}, '', '/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')

    const { registerParserMessageHandler } = await import('../src/lib/parser-runtime')
    const domConversation = conversationWithMessages(8)
    const parser = {
      isConversationPage: () => true,
      parseCurrentConversation: vi.fn(async () => domConversation),
      getConversationTitle: () => 'Conversation',
      getConversationList: () => [],
      fetchAllConversations: vi.fn(async () => []),
      fetchConversationDetail: vi.fn(async () => null),
      isAuthenticationRequired: () => false,
    }

    registerParserMessageHandler({
      platform: 'claude',
      parser,
      extractConversationId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      requireApiDetailForCurrentExport: true,
      apiDetailUnavailableError: 'Complete Claude history unavailable.',
    })

    const response = await new Promise<any>((resolve, reject) => {
      if (!listener) return reject(new Error('listener not registered'))
      listener({ type: 'PARSE_CONVERSATION' }, {}, resolve)
    })

    expect(response.data).toBeUndefined()
    expect(response.error).toBe('Complete Claude history unavailable.')
    expect(response.meta).toMatchObject({
      apiDetailRequired: true,
      domMessageCount: 8,
    })
  })
})
