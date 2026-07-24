/**
 * Gemini Markdown export correctness tests.
 *
 * These instantiate the real GeminiParser and assert that messages come out in
 * interleaved DOM order (NOT all-users-then-all-assistants), that duplicate DOM
 * copies are collapsed, and that standalone UI crumbs ("Gemini said", etc.)
 * are stripped from message bodies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GeminiParser } from '../src/contents/gemini-parser'

// Mock DOM helpers the parser relies on via dom-utils
vi.mock('../src/lib/dom-utils', () => ({
  generateId: (() => {
    let n = 0
    return () => `gen-id-${++n}`
  })(),
  extractTextContent: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithBreaks: (element: Element | null) => element?.textContent?.trim() || '',
  extractCodeBlocks: () => [],
  extractImages: () => [],
  cleanText: (text: string) => text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}))

// Minimal chrome storage mock
;(globalThis as any).chrome = {
  storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } },
  runtime: { getURL: vi.fn((p: string) => `chrome-extension://test/${p}`) },
  tabs: { sendMessage: vi.fn() },
  alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
  downloads: { onDeterminingFilename: { addListener: vi.fn() } }
}

/**
 * Build a realistic Gemini DOM: a main conversation thread with interleaved
 * user/assistant turns, plus duplicate sidebar copies of the first user query
 * and a "Gemini said" crumb inside an assistant bubble.
 */
function buildGeminiDom() {
  document.body.innerHTML = `
    <!-- sidebar duplicate copy of the first user query -->
    <aside>
      <div class="user-query"><div class="content">What is the capital of France?</div></div>
    </aside>

    <main>
      <div class="user-query" data-message-author-role="user">
        <div class="content">What is the capital of France?</div>
      </div>
      <div class="model-response" data-message-author-role="model">
        <div class="content">
          <p>Paris is the capital of France.</p>
          <div class="said" aria-label="Gemini said">Gemini said</div>
        </div>
      </div>
      <div class="user-query" data-message-author-role="user">
        <div class="content">And what about Germany?</div>
      </div>
      <div class="model-response" data-message-author-role="model">
        <div class="content"><p>Berlin is the capital of Germany.</p></div>
      </div>
    </main>
  `
}

describe('GeminiParser message ordering', () => {
  let parser: GeminiParser

  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
    parser = new GeminiParser()
  })

  it('emits messages in interleaved DOM order (user, assistant, user, assistant)', async () => {
    buildGeminiDom()
    const conversation = await parser.parseCurrentConversation()
    expect(conversation).not.toBeNull()
    const msgs = conversation!.messages
    // 2 user + 2 assistant, with sidebar dup collapsed
    expect(msgs).toHaveLength(4)
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  it('parses the current Gemini custom elements without scanning the sidebar', async () => {
    document.body.innerHTML = `
      <main>
        <conversations-list>
          ${Array.from({ length: 160 }, (_, i) => `<a href="/app/history-${i}">Old chat ${i}</a>`).join('')}
        </conversations-list>
        <chat-window-content>
          <user-query><div class="query-content"><p>Question one</p></div></user-query>
          <model-response><div class="response-container-content"><p>Answer one</p></div></model-response>
          <user-query><div class="query-content"><p>Question two</p></div></user-query>
          <model-response><div class="response-container-content"><p>Answer two</p></div></model-response>
        </chat-window-content>
      </main>
    `

    const conversation = await parser.parseCurrentConversation()

    expect(conversation?.messages).toHaveLength(4)
    expect(conversation?.messages.map(message => message.content)).toEqual([
      'Question one',
      'Answer one',
      'Question two',
      'Answer two'
    ])
    expect(conversation?.messages.some(message => message.content.includes('Old chat'))).toBe(false)
  })

  it('does NOT reorder into all-users-then-all-assistants', async () => {
    buildGeminiDom()
    const conversation = await parser.parseCurrentConversation()
    const roles = conversation!.messages.map(m => m.role)
    // The buggy implementation produced [user, user, assistant, assistant]
    expect(roles).not.toEqual(['user', 'user', 'assistant', 'assistant'])
  })

  it('collapses duplicate sidebar copies of the same user query', async () => {
    buildGeminiDom()
    const conversation = await parser.parseCurrentConversation()
    const userCount = conversation!.messages.filter(m => m.role === 'user').length
    // sidebar copy + main copy are the same text -> deduped to 1
    expect(userCount).toBe(2)
    const firstUser = conversation!.messages[0]
    expect(firstUser.content).toContain('capital of France')
    // ensure no repeated identical user block
    const userTexts = conversation!.messages.filter(m => m.role === 'user').map(m => m.content)
    expect(new Set(userTexts).size).toBe(userTexts.length)
  })

  it('strips "Gemini said" UI crumbs from assistant content', async () => {
    buildGeminiDom()
    const conversation = await parser.parseCurrentConversation()
    const assistant = conversation!.messages.find(m => m.role === 'assistant')!
    expect(assistant.content).toContain('Paris is the capital of France')
    expect(assistant.content).not.toMatch(/gemini said/i)
  })

  it('preserves real multi-line assistant answers as paragraphs', async () => {
    document.body.innerHTML = `
      <main>
        <div class="user-query"><div class="content">Explain a tuple.</div></div>
        <div class="model-response"><div class="content">
          <p>A tuple is an ordered collection.</p>
          <p>It is immutable.</p>
        </div></div>
      </main>
    `
    const conversation = await parser.parseCurrentConversation()
    const assistant = conversation!.messages[1]
    expect(assistant.content).toContain('ordered collection')
    expect(assistant.content).toContain('immutable')
  })

  it('keeps a genuine repeated message that reappears later (no false dedup)', async () => {
    document.body.innerHTML = `
      <main>
        <div class="user-query"><div class="content">yes</div></div>
        <div class="model-response"><div class="content"><p>Great.</p></div></div>
        <div class="user-query"><div class="content">no</div></div>
        <div class="model-response"><div class="content"><p>Okay.</p></div></div>
        <div class="user-query"><div class="content">yes</div></div>
        <div class="model-response"><div class="content"><p>Understood.</p></div></div>
      </main>
    `
    const conversation = await parser.parseCurrentConversation()
    const userTexts = conversation!.messages.filter(m => m.role === 'user').map(m => m.content)
    // The repeated "yes" appears at the start AND the end — both must survive.
    expect(userTexts.filter(t => t === 'yes')).toHaveLength(2)
    expect(userTexts).toEqual(['yes', 'no', 'yes'])
  })

  it('keeps two consecutive messages that share a long (>200 char) opening but differ later', async () => {
    const sharedPrefix = 'def process(data):\n    # ' + 'x'.repeat(250) + '\n'
    document.body.innerHTML = `
      <main>
        <div class="user-query"><div class="content">${sharedPrefix}first variant</div></div>
        <div class="model-response"><div class="content"><p>ok</p></div></div>
        <div class="user-query"><div class="content">${sharedPrefix}second variant</div></div>
        <div class="model-response"><div class="content"><p>done</p></div></div>
      </main>
    `
    const conversation = await parser.parseCurrentConversation()
    const userTexts = conversation!.messages.filter(m => m.role === 'user').map(m => m.content)
    // Both user messages MUST survive (the old slice(0,200) dedup wrongly
    // collapsed them into one).
    expect(userTexts).toHaveLength(2)
    expect(userTexts.filter(t => t.includes('first variant'))).toHaveLength(1)
    expect(userTexts.filter(t => t.includes('second variant'))).toHaveLength(1)
  })
})
