/**
 * Gemini CAPTURE_PAGE_SNAPSHOT tests.
 *
 * The snapshot path must stay DOM-only: no provider detail/list API calls, no
 * PARSE_CONVERSATION override/cache reuse, strict message-container selection,
 * node-based de-nesting instead of text dedup, and session-context race
 * rejection with requestId echo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const imagesMock = vi.fn((_container: Element): Array<{ url: string; alt: string }> => [])

vi.mock('../src/lib/dom-utils', () => ({
  generateId: () => 'test-id-456',
  extractTextContent: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithBreaks: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithMedia: (element: Element | null) => element?.textContent?.trim() || '',
  extractCodeBlocks: () => [],
  extractImages: (container: Element) => imagesMock(container),
  cleanText: (text: string) => text.replace(/\s+/g, ' ').trim(),
  stripProviderArtifacts: (text: string) => text,
}))

let messageListener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown

vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test/${path}`,
    onMessage: {
      addListener: (listener: typeof messageListener) => { messageListener = listener },
    },
  },
})

import { GeminiParser } from '../src/contents/gemini-parser'
import { registerParserMessageHandler } from '../src/lib/parser-runtime'
import { createGeminiSnapshotSession, type PageSnapshotSession } from '../src/lib/snapshot-session'
import { isPageSnapshot } from '../src/lib/page-snapshot'
import type { PageSnapshot } from '../src/lib/types'

function conversationDom(inner: string): string {
  return `<main><chat-window-content>${inner}</chat-window-content></main>`
}

describe('Gemini page snapshot capture', () => {
  let parser: GeminiParser
  let session: PageSnapshotSession

  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = 'Snapshot Chat - Gemini'
    window.history.pushState({}, '', '/app/conv-123')
    imagesMock.mockReset().mockReturnValue([])

    parser = new GeminiParser()
    session = createGeminiSnapshotSession()
    registerParserMessageHandler({
      platform: 'gemini',
      parser,
      getSnapshotContext: () => session.getSnapshotContext(),
    })
  })

  afterEach(() => {
    session.dispose()
  })

  function sendCapture(requestId: unknown = 'req-1'): Promise<any> {
    return new Promise(resolve => {
      messageListener({ type: 'CAPTURE_PAGE_SNAPSHOT', data: { requestId } }, {}, resolve)
    })
  }

  it('captures observed DOM without calling provider detail/list APIs or fetch', async () => {
    document.body.innerHTML = conversationDom(`
      <user-query>Hello Gemini</user-query>
      <model-response>Hello! How can I help?</model-response>
    `)
    const detailSpy = vi.spyOn(parser, 'fetchConversationDetail')
    const listSpy = vi.spyOn(parser, 'fetchAllConversationsWithStatus')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const response = await sendCapture('req-42')

    expect(response.error).toBeUndefined()
    expect(response.meta.requestId).toBe('req-42')
    expect(typeof response.meta.documentId).toBe('string')
    expect(typeof response.meta.sessionId).toBe('string')
    expect(response.meta.sessionEpoch).toBe(0)

    const snapshot = response.data as PageSnapshot
    expect(snapshot.kind).toBe('page-snapshot')
    expect(snapshot.scope).toBe('observed-dom')
    expect(snapshot.generationState).toBe('unknown')
    expect(snapshot.conversation.platform).toBe('gemini')
    expect(snapshot.conversation.source).toBe('dom')
    expect(snapshot.conversation.sourceCompleteness).toBe('unverified')
    expect(snapshot.conversation.verification?.transcript.verified).toBe(false)
    // The captured conversation carries the same envelope as the snapshot.
    expect(snapshot.conversation.snapshot).toMatchObject({
      kind: 'page-snapshot',
      captureId: snapshot.captureId,
      capturedAt: snapshot.capturedAt,
      scope: 'observed-dom',
      generationState: snapshot.generationState,
    })
    expect(snapshot.conversation.messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(snapshot.conversation.messages[0].content).toBe('Hello Gemini')
    expect(isPageSnapshot(snapshot)).toBe(true)

    expect(detailSpy).not.toHaveBeenCalled()
    expect(listSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('excludes hidden descendants, drafts and inactive attachment URLs without changing the page', async () => {
    document.body.innerHTML = conversationDom('<user-query>Visible <span hidden>HIDDEN_SECRET</span><span style="display:none">CSS_SECRET</span><span contenteditable="true">DRAFT_SECRET</span></user-query><model-response>Answer <span class="inactive-branch">BRANCH_SECRET<img src="https://example.com/private.png"></span></model-response>')
    const response = await sendCapture()
    expect(response.error).toBeUndefined()
    expect(JSON.stringify(response.data)).not.toMatch(/HIDDEN_SECRET|CSS_SECRET|DRAFT_SECRET|BRANCH_SECRET|private\.png/)
    expect(document.body.textContent).toContain('HIDDEN_SECRET')
  })

  it('rejects an empty page with a non-private error', async () => {
    document.body.innerHTML = ''
    const response = await sendCapture('req-empty')
    expect(response.data).toBeUndefined()
    expect(response.error).toContain('No capturable conversation content')
    expect(response.meta.requestId).toBe('req-empty')
  })

  it('rejects a page containing only an unsent input draft', async () => {
    document.body.innerHTML = conversationDom(`
      <div class="editor"><div class="user-query">unsent draft text</div></div>
    `)
    const response = await sendCapture()
    expect(response.data).toBeUndefined()
    expect(response.error).toBeTruthy()
  })

  it('allows a user-only conversation', async () => {
    document.body.innerHTML = conversationDom('<user-query>Only my question</user-query>')
    const response = await sendCapture()
    expect(response.error).toBeUndefined()
    const snapshot = response.data as PageSnapshot
    expect(snapshot.conversation.messages).toHaveLength(1)
    expect(snapshot.conversation.messages[0].role).toBe('user')
  })

  it('allows an assistant-only conversation', async () => {
    document.body.innerHTML = conversationDom('<model-response>Only the answer</model-response>')
    const response = await sendCapture()
    expect(response.error).toBeUndefined()
    const snapshot = response.data as PageSnapshot
    expect(snapshot.conversation.messages).toHaveLength(1)
    expect(snapshot.conversation.messages[0].role).toBe('assistant')
  })

  it('keeps adjacent real messages even when their text is identical', async () => {
    document.body.innerHTML = conversationDom(`
      <user-query>Repeat</user-query>
      <user-query>Repeat</user-query>
      <model-response>Same answer</model-response>
      <model-response>Same answer</model-response>
    `)
    const response = await sendCapture()
    expect(response.error).toBeUndefined()
    const snapshot = response.data as PageSnapshot
    expect(snapshot.conversation.messages.map(m => m.content)).toEqual([
      'Repeat', 'Repeat', 'Same answer', 'Same answer',
    ])
  })

  it('excludes hidden, aria-hidden, nav/aside and inactive-branch copies', async () => {
    document.body.innerHTML = conversationDom(`
      <user-query>Real question</user-query>
      <model-response>Real answer</model-response>
      <div aria-hidden="true"><model-response>Hidden copy</model-response></div>
      <div hidden><user-query>Hidden question</user-query></div>
      <model-response style="display:none">Invisible answer</model-response>
      <div class="inactive-branch"><model-response>Old branch</model-response></div>
      <aside><user-query>Sidebar copy</user-query></aside>
    `)
    const response = await sendCapture()
    expect(response.error).toBeUndefined()
    const snapshot = response.data as PageSnapshot
    expect(snapshot.conversation.messages.map(m => m.content)).toEqual([
      'Real question', 'Real answer',
    ])
  })

  it('de-nests duplicate containers by ancestor relationship', async () => {
    document.body.innerHTML = conversationDom(`
      <model-response><div class="model-message">Nested answer copy</div></model-response>
      <user-query>Question</user-query>
    `)
    const response = await sendCapture()
    expect(response.error).toBeUndefined()
    const snapshot = response.data as PageSnapshot
    expect(snapshot.conversation.messages.map(m => m.role)).toEqual(['assistant', 'user'])
    expect(snapshot.conversation.messages[0].content).toBe('Nested answer copy')
  })

  it('keeps an honest readable placeholder for attachment-only turns', async () => {
    document.body.innerHTML = conversationDom(`
      <user-query data-message-id="att-msg"></user-query>
      <model-response>Here is the file summary</model-response>
    `)
    imagesMock.mockImplementation((container: Element) =>
      container.getAttribute?.('data-message-id') === 'att-msg'
        ? [{ url: 'https://example.com/diagram.png', alt: 'diagram.png' }]
        : [])

    const response = await sendCapture()
    expect(response.error).toBeUndefined()
    const snapshot = response.data as PageSnapshot
    expect(snapshot.conversation.messages).toHaveLength(2)
    const attachmentMessage = snapshot.conversation.messages[0]
    expect(attachmentMessage.role).toBe('user')
    expect(attachmentMessage.content).toContain('Attachment only')
    expect(attachmentMessage.content).toContain('diagram.png')
    expect(attachmentMessage.attachments).toHaveLength(1)
  })

  it('reports generating only with an explicit stop signal, otherwise unknown', async () => {
    document.body.innerHTML = conversationDom(`
      <user-query>Question</user-query>
      <model-response>Partial answer</model-response>
      <button aria-label="Stop generating response">Stop</button>
    `)
    const generating = await sendCapture()
    expect(generating.error).toBeUndefined()
    expect((generating.data as PageSnapshot).generationState).toBe('generating')

    document.body.innerHTML = conversationDom(`
      <user-query>Question</user-query>
      <model-response>Done answer</model-response>
    `)
    const quiet = await sendCapture()
    expect(quiet.error).toBeUndefined()
    expect((quiet.data as PageSnapshot).generationState).toBe('unknown')
  })

  it('rejects the capture when the page session changes mid-capture', async () => {
    document.body.innerHTML = conversationDom(`
      <user-query>Question</user-query>
      <model-response>Answer</model-response>
    `)
    let epoch = 0
    registerParserMessageHandler({
      platform: 'gemini',
      parser,
      getSnapshotContext: () => ({ documentId: 'doc-1', sessionId: 'sess-1', sessionEpoch: epoch++ }),
    })

    const response = await sendCapture('req-race')
    expect(response.data).toBeUndefined()
    expect(response.error).toContain('changed while the page snapshot was being captured')
    expect(response.meta.requestId).toBe('req-race')
  })

  it('rejects malformed capture requests and never echoes page content', async () => {
    const response = vi.fn()
    messageListener({ type: 'CAPTURE_PAGE_SNAPSHOT', data: { requestId: '' } }, {}, response)
    expect(response).toHaveBeenCalledWith({ error: 'Invalid provider request' })

    response.mockClear()
    messageListener({ type: 'CAPTURE_PAGE_SNAPSHOT' }, {}, response)
    expect(response).toHaveBeenCalledWith({ error: 'Invalid provider request' })

    response.mockClear()
    messageListener({ type: 'CAPTURE_PAGE_SNAPSHOT', data: { requestId: 'x'.repeat(200) } }, {}, response)
    expect(response).toHaveBeenCalledWith({ error: 'Invalid provider request' })
  })

  it('answers capture requests on providers without the capability as unsupported', async () => {
    registerParserMessageHandler({
      platform: 'chatgpt',
      parser: {
        isConversationPage: () => true,
        parseCurrentConversation: async () => null,
        getConversationTitle: () => null,
        getConversationList: () => [],
        fetchConversationDetail: async () => null,
        isAuthenticationRequired: () => false,
      },
      getSnapshotContext: () => ({ documentId: 'd', sessionId: 's', sessionEpoch: 0 }),
    })

    const response = await sendCapture('req-unsupported')
    expect(response.data).toBeUndefined()
    expect(response.error).toContain('not supported')
    expect(response.meta.requestId).toBe('req-unsupported')
  })
})
