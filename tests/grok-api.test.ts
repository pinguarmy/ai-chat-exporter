import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetchGrokConversationDetail, fetchGrokConversationList } from '../src/lib/grok-api'

type FetchResponse = {
  ok: boolean
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
          { responseId: 'assistant-response', sender: 'ASSISTANT', message: 'The answer', createTime: '2026-07-14T08:00:02.000Z' },
          { responseId: 'user-response', sender: 'human', message: 'The question', createTime: '2026-07-14T08:00:01.000Z' },
          { responseId: 'empty-response', sender: 'ASSISTANT', message: '   ' }
        ]
      }))

    const conversation = await fetchGrokConversationDetail('other-conversation', fetchFn)

    expect(conversation).toMatchObject({
      id: 'other-conversation',
      title: 'Other conversation',
      platform: 'grok',
      messages: [
        { id: 'user-response', role: 'user', content: 'The question' },
        { id: 'assistant-response', role: 'assistant', content: 'The answer' }
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

    await expect(fetchGrokConversationList(fetchFn)).resolves.toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
