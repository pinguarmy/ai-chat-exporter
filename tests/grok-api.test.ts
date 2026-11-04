import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetchGrokConversationDetail, fetchGrokConversationList } from '../src/lib/grok-api'
import { ProviderRateLimitError } from '../src/lib/provider-rate-limit'
import { renderableMessageReferences } from '../src/lib/message-references'

type FetchResponse = {
  ok: boolean
  status?: number
  json: () => Promise<unknown>
}

function jsonResponse(payload: unknown): FetchResponse {
  return {
    ok: true,
    json: async () => payload
  }
}

describe('Grok API adapter', () => {
  it('routes bulk Grok list and detail requests through the ID-based API adapter', () => {
    const parserSource = readFileSync(resolve(process.cwd(), 'src/contents/grok-parser.ts'), 'utf8')

    expect(parserSource).toContain("import { fetchGrokConversationDetail, fetchGrokConversationList } from '../lib/grok-api'")
    expect(parserSource).toContain('fetchGrokConversationList()')
    expect(parserSource).toContain('return fetchGrokConversationDetail(id)')
    expect(parserSource).not.toContain('Fetch conversation detail — attempts DOM parse if currently viewing it')
  })

  it('loads a non-open Grok conversation by ID without navigating to its page', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({
        conversation: {
          conversationId: 'other-conversation',
          title: 'Other conversation',
          createTime: '2026-07-14T08:00:00.000Z'
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        responseNodes: [
          { responseId: 'user-response', sender: 'human' },
          { responseId: 'assistant-response', sender: 'ASSISTANT' }
        ]
      }))
      .mockResolvedValueOnce(jsonResponse({
        responses: [
          { responseId: 'assistant-response', sender: 'ASSISTANT', message: 'The answer.<grok:render card_id="abc"><argument name="citation_id">92</argument></grok:render>', createTime: '2026-07-14T08:00:02.000Z' },
          { responseId: 'user-response', sender: 'human', message: 'The question', createTime: '2026-07-14T08:00:01.000Z' },
          { responseId: 'empty-response', sender: 'ASSISTANT', message: '   ' }
        ]
      }))

    const conversation = await fetchGrokConversationDetail('other-conversation', fetchFn)

    expect(conversation).toMatchObject({
      id: 'other-conversation',
      title: 'Other conversation',
      platform: 'grok',
      source: 'api',
      sourceCompleteness: 'verified',
      verification: { transcript: { verified: true, method: 'provider-api-complete' } },
      messages: [
        { id: 'user-response', role: 'user', content: 'The question' },
        { id: 'assistant-response', role: 'assistant', content: 'The answer.' }
      ]
    })
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(fetchFn.mock.calls[0][0]).toBe('https://grok.com/rest/app-chat/conversations_v2/other-conversation')
    expect(fetchFn.mock.calls[1][0]).toBe('https://grok.com/rest/app-chat/conversations/other-conversation/response-node')
    expect(fetchFn.mock.calls[2][0]).toBe('https://grok.com/rest/app-chat/conversations/other-conversation/load-responses')
    expect(fetchFn.mock.calls[2][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ responseIds: ['user-response', 'assistant-response'] })
    })
  })

  it('does not mark a Grok detail verified when a requested response body is missing', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({
        conversation: { conversationId: 'partial-conversation', title: 'Partial' }
      }))
      .mockResolvedValueOnce(jsonResponse({
        responseNodes: [
          { responseId: 'user-response', sender: 'human' },
          { responseId: 'assistant-response', sender: 'ASSISTANT' },
        ]
      }))
      .mockResolvedValueOnce(jsonResponse({
        responses: [
          { responseId: 'user-response', sender: 'human', message: 'The question' },
        ]
      }))

    const conversation = await fetchGrokConversationDetail('partial-conversation', fetchFn)
    expect(conversation).toMatchObject({
      source: 'api',
      sourceCompleteness: 'unverified',
      verification: { transcript: { verified: false, reasons: ['missing_response_bodies'] } },
      messages: [{ id: 'user-response', role: 'user', content: 'The question' }],
    })
  })

  it('marks a markup-only Grok response incomplete after sanitization', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({
        conversation: { conversationId: 'markup-only', title: 'Markup only' }
      }))
      .mockResolvedValueOnce(jsonResponse({
        responseNodes: [{ responseId: 'user', sender: 'human' }, { responseId: 'assistant', sender: 'ASSISTANT' }]
      }))
      .mockResolvedValueOnce(jsonResponse({
        responses: [
          { responseId: 'user', sender: 'human', message: 'Question' },
          { responseId: 'assistant', sender: 'ASSISTANT', message: '<grok:render card_id="abc"><argument name="citation_id">92</argument></grok:render>' }
        ]
      }))

    expect(await fetchGrokConversationDetail('markup-only', fetchFn)).toMatchObject({
      sourceCompleteness: 'unverified',
      verification: { transcript: { verified: false, reasons: ['missing_response_bodies'] } },
      messages: [{ id: 'user', content: 'Question' }]
    })
  })

  it('preserves indented Grok API markdown', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({
        conversation: { conversationId: 'code-conversation', title: 'Code' }
      }))
      .mockResolvedValueOnce(jsonResponse({
        responseNodes: [{ responseId: 'assistant-response', sender: 'ASSISTANT' }]
      }))
      .mockResolvedValueOnce(jsonResponse({
        responses: [{
          responseId: 'assistant-response',
          sender: 'ASSISTANT',
          message: '```python\ndef add(a, b):\n    return a + b\n```',
        }]
      }))

    const conversation = await fetchGrokConversationDetail('code-conversation', fetchFn)
    expect(conversation?.messages[0]?.content).toContain('    return a + b')
  })

  it('automatically follows Grok nextPageToken values without sidebar scrolling', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({
        conversations: [{
          conversationId: 'first-conversation',
          title: 'First conversation',
          createTime: '2026-07-14T08:00:00.000Z'
        }],
        nextPageToken: 'page-two'
      }))
      .mockResolvedValueOnce(jsonResponse({
        conversations: [{
          conversationId: 'second-conversation',
          title: 'Second conversation',
          createTime: '2026-07-14T09:00:00.000Z'
        }],
        nextPageToken: ''
      }))

    const conversations = await fetchGrokConversationList(fetchFn)

    expect(conversations).toEqual([
      {
        id: 'first-conversation',
        title: 'First conversation',
        url: 'https://grok.com/c/first-conversation',
        platform: 'grok',
        createdAt: new Date('2026-07-14T08:00:00.000Z').getTime()
      },
      {
        id: 'second-conversation',
        title: 'Second conversation',
        url: 'https://grok.com/c/second-conversation',
        platform: 'grok',
        createdAt: new Date('2026-07-14T09:00:00.000Z').getTime()
      }
    ])
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[0][0]).toBe('https://grok.com/rest/app-chat/conversations?pageSize=100')
    expect(fetchFn.mock.calls[1][0]).toBe('https://grok.com/rest/app-chat/conversations?pageSize=100&pageToken=page-two')
  })

  it('rejects a partial Grok list when a later page cannot be loaded', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({
        conversations: [{ conversationId: 'first-conversation', title: 'First conversation' }],
        nextPageToken: 'page-two'
      }))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({})
      })

    await expect(fetchGrokConversationList(fetchFn)).rejects.toThrow('Grok history request failed')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('surfaces an expired Grok session as an authentication error', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })

    await expect(fetchGrokConversationList(fetchFn)).rejects.toThrow('Authentication required')
  })

  it('surfaces a 429 from Grok detail without retaining the provider response', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })

    await expect(fetchGrokConversationDetail('other-conversation', fetchFn))
      .rejects.toBeInstanceOf(ProviderRateLimitError)
  })

  it('extracts only safe Grok reference metadata and respects privacy modes', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({ conversation: { conversationId: 'synthetic' } }))
      .mockResolvedValueOnce(jsonResponse({ responseNodes: [{ responseId: 'a' }] }))
      .mockResolvedValueOnce(jsonResponse({ responses: [{ responseId: 'a', sender: 'ASSISTANT', message: 'Synthetic answer', webSearchResults: [
        { title: 'Public', url: 'https://user:password@example.com/a', preview: 'secret preview' },
        { title: 'Private', url: 'https://docs.google.com/document/d/123', preview: 'secret preview' },
        { title: 'Public', url: 'https://example.com/a' },
        { title: 'Invalid', url: 'ftp://example.com/a' },
      ] }] }))
    const conversation = await fetchGrokConversationDetail('synthetic', fetchFn)
    const refs = conversation?.messages[0].references
    expect(refs).toHaveLength(2)
    expect(JSON.stringify(conversation)).not.toMatch(/secret preview|password/)
    expect(renderableMessageReferences(refs, 'off')).toEqual([])
    expect(renderableMessageReferences(refs, 'titles')).toEqual([{ title: 'Public' }, { title: 'Private' }])
    expect(renderableMessageReferences(refs, 'safe-links')).toEqual([{ title: 'Public', url: 'https://example.com/a' }, { title: 'Private' }])
  })

  it('marks unverified when a response has partial: true (still streaming)', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({
        conversation: { conversationId: 'streaming-conv', title: 'Streaming' }
      }))
      .mockResolvedValueOnce(jsonResponse({
        responseNodes: [
          { responseId: 'user-1', sender: 'human' },
          { responseId: 'assistant-1', sender: 'ASSISTANT' },
        ]
      }))
      .mockResolvedValueOnce(jsonResponse({
        responses: [
          { responseId: 'user-1', sender: 'human', message: 'Question' },
          { responseId: 'assistant-1', sender: 'ASSISTANT', message: 'Partial answer so far...', partial: true },
        ]
      }))

    const conversation = await fetchGrokConversationDetail('streaming-conv', fetchFn)
    expect(conversation).toMatchObject({
      sourceCompleteness: 'unverified',
      verification: {
        transcript: {
          verified: false,
          method: 'provider-api-incomplete',
          reasons: expect.arrayContaining(['partial_response']),
        },
      },
    })
    // Messages still included but not verified
    expect(conversation?.messages).toHaveLength(2)
  })

  it('marks unverified when nodePayload has inflightResponses', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({
        conversation: { conversationId: 'inflight-conv', title: 'Inflight' }
      }))
      .mockResolvedValueOnce(jsonResponse({
        responseNodes: [
          { responseId: 'user-1', sender: 'human' },
          { responseId: 'assistant-1', sender: 'ASSISTANT' },
        ],
        inflightResponses: [
          'assistant-1',
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        responses: [
          { responseId: 'user-1', sender: 'human', message: 'Question' },
          { responseId: 'assistant-1', sender: 'ASSISTANT', message: 'Still generating...' },
        ]
      }))

    const conversation = await fetchGrokConversationDetail('inflight-conv', fetchFn)
    expect(conversation).toMatchObject({
      sourceCompleteness: 'unverified',
      verification: {
        transcript: {
          verified: false,
          method: 'provider-api-incomplete',
          reasons: expect.arrayContaining(['inflight_responses']),
        },
      },
    })
  })

  it('remains verified when partial is false and no inflightResponses', async () => {
    const fetchFn = vi.fn<(...args: any[]) => Promise<FetchResponse>>()
      .mockResolvedValueOnce(jsonResponse({
        conversation: { conversationId: 'complete-conv', title: 'Complete' }
      }))
      .mockResolvedValueOnce(jsonResponse({
        responseNodes: [
          { responseId: 'user-1', sender: 'human' },
          { responseId: 'assistant-1', sender: 'ASSISTANT' },
        ],
        inflightResponses: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        responses: [
          { responseId: 'user-1', sender: 'human', message: 'Question', partial: false },
          { responseId: 'assistant-1', sender: 'ASSISTANT', message: 'Complete answer', partial: false },
        ]
      }))

    const conversation = await fetchGrokConversationDetail('complete-conv', fetchFn)
    expect(conversation).toMatchObject({
      sourceCompleteness: 'verified',
      verification: { transcript: { verified: true, method: 'provider-api-complete' } },
    })
  })
})
