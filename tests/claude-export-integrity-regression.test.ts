import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../src/lib/types'

type ClaudeParserConstructor = typeof import('../src/contents/claude-parser').ClaudeParser
type ClaudeBranchSelector = typeof import('../src/contents/claude-parser').selectClaudeActiveBranch
type ClaudeBranchResolver = typeof import('../src/contents/claude-parser').resolveClaudeActiveBranch

let ClaudeParser: ClaudeParserConstructor
let selectClaudeActiveBranch: ClaudeBranchSelector
let resolveClaudeActiveBranch: ClaudeBranchResolver

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

    ;({ ClaudeParser, selectClaudeActiveBranch, resolveClaudeActiveBranch } = await import('../src/contents/claude-parser'))
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
    expect(conversation?.sourceCompleteness).toBe('unverified')
    expect(conversation?.verification).toMatchObject({
      provider: 'claude',
      source: 'dom',
      transcript: {
        verified: false,
        method: 'dom-unverified',
        reasons: ['source_unverified'],
      },
    })
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

  it('retains an image-only Claude API turn as an attachment', async () => {
    const orgId = '11111111-1111-4111-8111-111111111111'
    document.body.innerHTML = `<script>https://claude.ai/api/organizations/${orgId}/chat_conversations</script>`
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/session') || url.includes('/api/bootstrap') || url.includes('/api/account')) {
        return { ok: false, status: 404, json: async () => ({}) }
      }
      if (url.includes('/chat_conversations/conv-image')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            uuid: 'conv-image',
            current_leaf_message_uuid: 'msg-1',
            chat_messages: [
              {
                uuid: 'msg-1',
                sender: 'human',
                content: [{ type: 'image', source: { type: 'url', url: 'https://images.example/prompt.png' } }],
              },
            ],
          }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }))

    const conversation = await new ClaudeParser().fetchConversationDetail('conv-image')
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]).toMatchObject({
      role: 'user',
      content: '',
      attachments: [{
        type: 'image',
        url: 'https://images.example/prompt.png',
        uploaded: true,
      }],
    })
  })

  it('keeps an 80-turn linear API branch intact', () => {
    const records = Array.from({ length: 80 }, (_, index) => ({
      uuid: `m-${index}`,
      parent_uuid: index === 0 ? undefined : `m-${index - 1}`,
      sender: index % 2 === 0 ? 'human' : 'assistant',
      content: `message ${index}`,
    }))

    const selected = selectClaudeActiveBranch(records, { current_leaf_message_uuid: 'm-79' })
    const resolved = resolveClaudeActiveBranch(records, { current_leaf_message_uuid: 'm-79' })
    expect(selected).toHaveLength(80)
    expect(resolved.complete).toBe(true)
    expect(selected[0].uuid).toBe('m-0')
    expect(selected[79].uuid).toBe('m-79')
  })

  it('accepts a legitimate short active fork even when abandoned branches are much larger', () => {
    const root = { uuid: 'root', sender: 'human', content: 'root' }
    const active = Array.from({ length: 7 }, (_, index) => ({
      uuid: `active-${index + 1}`,
      parent_uuid: index === 0 ? 'root' : `active-${index}`,
      sender: index % 2 === 0 ? 'assistant' : 'human',
      content: `active ${index + 1}`,
    }))
    const abandoned = Array.from({ length: 72 }, (_, index) => ({
      uuid: `old-${index + 1}`,
      parent_uuid: index === 0 ? 'root' : `old-${index}`,
      sender: index % 2 === 0 ? 'assistant' : 'human',
      content: `old ${index + 1}`,
    }))
    const records = [root, ...abandoned, ...active]

    const resolved = resolveClaudeActiveBranch(records, { current_leaf_message_uuid: 'active-7' })
    expect(records).toHaveLength(80)
    expect(resolved.complete).toBe(true)
    expect(resolved.records).toHaveLength(8)
    expect(resolved.records[0].uuid).toBe('root')
    expect(resolved.records.at(-1)?.uuid).toBe('active-7')
  })

  it('rejects a broken parent chain even when the total response is smaller than 20 records', () => {
    const unrelated = Array.from({ length: 9 }, (_, index) => ({
      uuid: `other-${index}`,
      sender: index % 2 === 0 ? 'human' : 'assistant',
      content: `other ${index}`,
    }))
    const tail = Array.from({ length: 6 }, (_, index) => ({
      uuid: `tail-${index}`,
      parent_uuid: index === 0 ? 'missing-parent' : `tail-${index - 1}`,
      sender: index % 2 === 0 ? 'human' : 'assistant',
      content: `tail ${index}`,
    }))
    const records = [...unrelated, ...tail]

    const resolved = resolveClaudeActiveBranch(records, { current_leaf_message_uuid: 'tail-5' })
    expect(records).toHaveLength(15)
    expect(resolved.complete).toBe(false)
    expect(resolved.issue).toBe('missing_parent')
    expect(resolved.records).toHaveLength(6)
  })

  it('keeps a reverse-chronological active chain instead of truncating at the root', () => {
    const records = [
      { uuid: 'turn-3', parent_uuid: 'turn-2', sender: 'assistant', content: 'latest', is_current: true },
      { uuid: 'turn-2', parent_uuid: 'turn-1', sender: 'human', content: 'middle', is_current: true },
      { uuid: 'turn-1', sender: 'human', content: 'root', is_current: true },
    ]

    const resolved = resolveClaudeActiveBranch(records, {})
    expect(resolved.complete).toBe(true)
    expect(resolved.records.map(record => record.uuid)).toEqual(['turn-1', 'turn-2', 'turn-3'])
  })

  it('rejects a cycle in the selected Claude branch', () => {
    const records = [
      { uuid: 'a', parent_uuid: 'c', sender: 'human', content: 'a' },
      { uuid: 'b', parent_uuid: 'a', sender: 'assistant', content: 'b' },
      { uuid: 'c', parent_uuid: 'b', sender: 'human', content: 'c' },
    ]
    const resolved = resolveClaudeActiveBranch(records, { current_leaf_message_uuid: 'c' })
    expect(resolved.complete).toBe(false)
    expect(resolved.issue).toBe('cycle')
  })

  it('rejects a structurally incomplete API tree instead of returning a truncated detail', async () => {
    const orgId = '11111111-1111-4111-8111-111111111111'
    document.body.innerHTML = `<script>https://claude.ai/api/organizations/${orgId}/chat_conversations</script>`

    const records = Array.from({ length: 15 }, (_, index) => ({
      uuid: `tail-${index}`,
      parent_uuid: index === 0 ? 'missing-parent' : `tail-${index - 1}`,
      sender: index % 2 === 0 ? 'human' : 'assistant',
      content: `tail ${index}`,
    }))

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        uuid: 'conversation-1',
        current_leaf_message_uuid: 'tail-14',
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

  it('marks a successful API detail as a verified source', async () => {
    const orgId = '11111111-1111-4111-8111-111111111111'
    document.body.innerHTML = `<script>https://claude.ai/api/organizations/${orgId}/chat_conversations</script>`
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        uuid: 'conversation-1',
        current_leaf_message_uuid: 'm-1',
        chat_messages: [
          { uuid: 'm-0', sender: 'human', content: 'question' },
          { uuid: 'm-1', parent_uuid: 'm-0', sender: 'assistant', content: 'answer' },
        ],
      })
    })))

    try {
      const conversation = await new ClaudeParser().fetchConversationDetail('conversation-1')
      expect(conversation?.source).toBe('api')
      expect(conversation?.sourceCompleteness).toBe('verified')
      expect(conversation?.verification).toMatchObject({
        provider: 'claude',
        source: 'api',
        transcript: {
          verified: true,
          method: 'active-branch-root-chain',
          reasons: ['selected_branch_reaches_root'],
        },
      })
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('reports a partially paginated Claude history instead of presenting it as complete', async () => {
    const orgId = '11111111-1111-4111-8111-111111111111'
    document.body.innerHTML = `<script>https://claude.ai/api/organizations/${orgId}/chat_conversations</script>`
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      uuid: `c-${index}`,
      name: `Conversation ${index}`,
    }))
    const originalFetch = globalThis.fetch
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return { ok: true, status: 200, json: async () => ({ conversations: firstPage }) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    }))

    try {
      const parser = new ClaudeParser()
      const list = await parser.fetchAllConversations()
      expect(list).toHaveLength(100)
      expect(parser.getConversationListMeta()).toEqual({ source: 'api', complete: false, pagesFetched: 1 })
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
    const domConversation = { ...conversationWithMessages(8), source: 'dom' as const, sourceCompleteness: 'unverified' as const }
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
      pageFallbackSupported: false,
      domMessageCount: 8,
    })
  })

  it('accepts a provider-verified one-sided conversation', async () => {
    let listener: ((message: any, sender: any, sendResponse: (response: any) => void) => boolean | void) | undefined
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener: vi.fn((callback: typeof listener) => { listener = callback }) } }
    })
    window.history.replaceState({}, '', '/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')

    const { registerParserMessageHandler } = await import('../src/lib/parser-runtime')
    const verifiedOneSided: Conversation = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Stopped chat',
      url: window.location.href,
      platform: 'claude',
      source: 'api',
      sourceCompleteness: 'verified',
      messages: [{ id: 'u-1', role: 'user', content: 'Prompt then stop' }],
    }
    const parser = {
      isConversationPage: () => true,
      parseCurrentConversation: vi.fn(async () => null),
      getConversationTitle: () => 'Stopped chat',
      getConversationList: () => [],
      fetchAllConversations: vi.fn(async () => []),
      fetchConversationDetail: vi.fn(async () => verifiedOneSided),
      isAuthenticationRequired: () => false,
    }

    registerParserMessageHandler({
      platform: 'claude',
      parser,
      extractConversationId: () => verifiedOneSided.id,
      requireApiDetailForCurrentExport: true,
      preferApiDetailWhenComplete: true,
    })

    const response = await new Promise<any>((resolve, reject) => {
      if (!listener) return reject(new Error('listener not registered'))
      listener({ type: 'PARSE_CONVERSATION' }, {}, resolve)
    })

    expect(response.error).toBeUndefined()
    expect(response.data?.messages).toHaveLength(1)
    expect(response.data?.sourceCompleteness).toBe('verified')
  })
})
