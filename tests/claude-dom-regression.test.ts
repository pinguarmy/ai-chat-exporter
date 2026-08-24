import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type ClaudeParserConstructor = typeof import('../src/contents/claude-parser').ClaudeParser
type ClaudeBranchSelector = typeof import('../src/contents/claude-parser').selectClaudeActiveBranch

let ClaudeParser: ClaudeParserConstructor
let selectClaudeActiveBranch: ClaudeBranchSelector

describe('Claude parser DOM regressions', () => {
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
    window.history.replaceState({}, '', '/chat/test-conversation')
  })

  it('captures assistant replies from Claude data-is-streaming nodes', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">What is the answer?</div>
        <div data-is-streaming="false">
          <div class="prose"><p>The answer is here.</p></div>
        </div>
      </main>
    `

    const conversation = await new ClaudeParser().parseCurrentConversation()

    expect(conversation?.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'What is the answer?'],
      ['assistant', 'The answer is here.']
    ])
  })

  it('does not duplicate a streaming answer when its old class is nested', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">Question</div>
        <div data-is-streaming="false">
          <div class="font-claude-message">Answer</div>
        </div>
      </main>
    `

    const conversation = await new ClaudeParser().parseCurrentConversation()

    expect(conversation?.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Question'],
      ['assistant', 'Answer']
    ])
  })

  it('keeps Claude answer layout when parsing the rendered DOM', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">Please format this answer.</div>
        <div data-is-streaming="false">
          <div class="prose">
            <h2>Visual overhaul:</h2>
            <p>Use <strong>clear sections</strong> and keep the spacing.</p>
            <ul><li>First item</li><li>Second item</li></ul>
            <pre><code class="language-ts">const ready = true</code></pre>
          </div>
        </div>
      </main>
    `

    const conversation = await new ClaudeParser().parseCurrentConversation()
    const assistant = conversation?.messages.find(message => message.role === 'assistant')

    expect(assistant?.content).toContain('## Visual overhaul:')
    expect(assistant?.content).toContain('Use **clear sections** and keep the spacing.')
    expect(assistant?.content).toContain('- First item\n- Second item')
    expect(assistant?.content).toContain('```ts\nconst ready = true\n```')
  })

  it('prefers the semantic prose child over a legacy wrapper mirror', async () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="user-message">Question</div>
        <div data-is-streaming="false">
          <div class="font-claude-message">
            Flattened mirror that should not win
            <div class="prose"><p><strong>Structured answer</strong></p></div>
          </div>
        </div>
      </main>
    `

    const conversation = await new ClaudeParser().parseCurrentConversation()
    expect(conversation?.messages.find(message => message.role === 'assistant')?.content)
      .toBe('**Structured answer**')
  })

  it('uses visible API Markdown and keeps artifacts separate from tool activity', async () => {
    const orgId = '11111111-1111-4111-8111-111111111111'
    document.body.innerHTML = `<script>https://claude.ai/api/organizations/${orgId}/chat_conversations</script>`
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        uuid: 'conversation-1',
        name: 'API conversation',
        chat_messages: [
          { uuid: 'user-1', sender: 'human', content: [{ type: 'text', text: 'Question' }] },
          {
            uuid: 'assistant-1',
            sender: 'assistant',
            content: [
              { type: 'thinking', thinking: 'private reasoning' },
              { type: 'text', text: '## Structured answer\n\n- Keep this list' },
              {
                type: 'tool_use',
                name: 'artifacts',
                input: { type: 'html', title: 'Dashboard', content: '<html></html>' }
              }
            ]
          }
        ]
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const conversation = await new ClaudeParser().fetchConversationDetail('conversation-1')
      expect(conversation?.messages.map(message => message.content)).toEqual([
        'Question',
        '## Structured answer\n\n- Keep this list'
      ])
      expect(conversation?.messages[1].content).not.toContain('private reasoning')
      expect(conversation?.artifacts?.[0]).toMatchObject({ title: 'Dashboard', type: 'html' })
      expect(conversation?.artifacts?.[0].language).toBeUndefined()
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('exports only the branch selected by Claude current leaf metadata', () => {
    const records = [
      { uuid: 'u1', sender: 'human', content: 'Question' },
      { uuid: 'a-old', parent_uuid: 'u1', sender: 'assistant', content: 'Old answer' },
      { uuid: 'a-new', parent_uuid: 'u1', sender: 'assistant', content: 'Current answer' },
      { uuid: 'u2', parent_uuid: 'a-new', sender: 'human', content: 'Follow up' },
      { uuid: 'a2', parent_uuid: 'u2', sender: 'assistant', content: 'Final answer' },
    ]
    const selected = selectClaudeActiveBranch(records, { current_leaf_message_uuid: 'a2' })
    expect(selected.map(record => record.uuid)).toEqual(['u1', 'a-new', 'u2', 'a2'])
  })

  it('does not flatten sibling branches when current leaf metadata is absent', () => {
    const records = [
      { uuid: 'u1', sender: 'human', content: 'Question' },
      { uuid: 'a-old', parent_uuid: 'u1', sender: 'assistant', content: 'Old answer' },
      { uuid: 'a-new', parent_uuid: 'u1', sender: 'assistant', content: 'Current answer' },
    ]
    const selected = selectClaudeActiveBranch(records, {})
    expect(selected).toHaveLength(2)
    expect(selected.map(record => record.uuid)).not.toContain('a-old')
  })
})
