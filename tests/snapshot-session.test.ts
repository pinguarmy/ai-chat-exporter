/**
 * PageSnapshotSession tests: conversation-boundary detection for snapshot
 * capture and the future recovery monitor.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PageSnapshotSession,
  sameSnapshotSessionContext,
  createGeminiSnapshotSession,
} from '../src/lib/snapshot-session'

function geminiDom(messageCount = 2): string {
  const messages: string[] = []
  for (let i = 0; i < messageCount; i++) {
    messages.push(i % 2 === 0
      ? `<user-query>Question ${i}</user-query>`
      : `<model-response>Answer ${i}</model-response>`)
  }
  return `<chat-window-content>${messages.join('')}</chat-window-content>`
}

describe('PageSnapshotSession', () => {
  let session: PageSnapshotSession | null = null
  let idCounter = 0
  const randomId = () => `id-${++idCounter}`

  const makeSession = () => {
    session = createGeminiSnapshotSession({ randomId })
    return session
  }

  beforeEach(() => {
    idCounter = 0
    document.body.innerHTML = geminiDom()
    window.history.pushState({}, '', '/app/conv-1')
  })

  afterEach(() => {
    session?.dispose()
    session = null
  })

  it('returns a stable context while streaming only appends messages', () => {
    session = makeSession()
    const first = session.getSnapshotContext()
    expect(first.sessionEpoch).toBe(0)

    // Streaming appends: add nodes without removing anything.
    const root = document.querySelector('chat-window-content')!
    root.insertAdjacentHTML('beforeend', '<model-response>Answer 2 (still streaming)</model-response>')
    root.insertAdjacentHTML('beforeend', '<user-query>Question 3</user-query>')

    const second = session.getSnapshotContext()
    expect(sameSnapshotSessionContext(first, second)).toBe(true)
    expect(second.sessionEpoch).toBe(0)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.documentId).toBe(first.documentId)
  })

  it('advances the epoch and rotates the session id on navigation', () => {
    session = makeSession()
    const first = session.getSnapshotContext()

    window.history.pushState({}, '', '/app/conv-2')
    const second = session.getSnapshotContext()
    expect(second.sessionEpoch).toBe(first.sessionEpoch + 1)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(sameSnapshotSessionContext(first, second)).toBe(false)

    // A no-ID new chat at the same URL shape is still isolated: the identity
    // is random, never the URL.
    window.history.pushState({}, '', '/app')
    const third = session.getSnapshotContext()
    expect(third.sessionEpoch).toBe(second.sessionEpoch + 1)
    expect(third.sessionId).not.toBe(second.sessionId)
  })

  it('advances the epoch when rendered messages disappear (regenerate/reset)', () => {
    session = makeSession()
    const first = session.getSnapshotContext()

    // Regeneration rewrites the last rendered response.
    document.querySelector('model-response')!.remove()
    const second = session.getSnapshotContext()
    expect(second.sessionEpoch).toBeGreaterThan(first.sessionEpoch)
    expect(second.sessionId).not.toBe(first.sessionId)
  })

  it('advances the epoch when the conversation root is replaced', () => {
    session = makeSession()
    const first = session.getSnapshotContext()

    const oldRoot = document.querySelector('chat-window-content')!
    oldRoot.remove()
    document.body.innerHTML = geminiDom(4)
    const second = session.getSnapshotContext()
    expect(second.sessionEpoch).toBeGreaterThan(first.sessionEpoch)
    expect(second.sessionId).not.toBe(first.sessionId)
  })

  it('detects same-count message replacement at the same URL without confusing text streaming', () => {
    session = makeSession()
    const first = session.getSnapshotContext()
    document.querySelector('model-response')!.textContent += ' streamed text'
    expect(sameSnapshotSessionContext(first, session.getSnapshotContext())).toBe(true)
    document.querySelector('chat-window-content')!.innerHTML = '<user-query>Different chat</user-query><model-response>Different answer</model-response>'
    expect(sameSnapshotSessionContext(first, session.getSnapshotContext())).toBe(false)
  })

  it('invalidates new-chat and regeneration clicks even before same-node DOM changes', () => {
    session = makeSession()
    const first = session.getSnapshotContext()
    document.body.insertAdjacentHTML('beforeend', '<button aria-label="Regenerate response">Regenerate</button>')
    document.querySelector('button')!.click()
    expect(sameSnapshotSessionContext(first, session.getSnapshotContext())).toBe(false)
  })

  it('gives each document session a distinct documentId', () => {
    const a = makeSession()
    const aContext = a.getSnapshotContext()
    a.dispose()

    idCounter = 100
    const b = makeSession()
    const bContext = b.getSnapshotContext()
    expect(bContext.documentId).not.toBe(aContext.documentId)
  })

  it('sameSnapshotSessionContext compares all three fields', () => {
    const base = { documentId: 'd', sessionId: 's', sessionEpoch: 1 }
    expect(sameSnapshotSessionContext(base, { ...base })).toBe(true)
    expect(sameSnapshotSessionContext(base, { ...base, documentId: 'x' })).toBe(false)
    expect(sameSnapshotSessionContext(base, { ...base, sessionId: 'x' })).toBe(false)
    expect(sameSnapshotSessionContext(base, { ...base, sessionEpoch: 2 })).toBe(false)
  })
})
