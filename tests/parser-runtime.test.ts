import { describe, expect, it, vi } from 'vitest'
import { registerParserMessageHandler } from '../src/lib/parser-runtime'
import type { Conversation, ConversationListItem } from '../src/lib/types'

describe('parser runtime FETCH_ALL_CONVERSATIONS', () => {
  it('rejects malformed detail requests before calling a provider and ignores unrelated messages', () => {
    let listener: (message: unknown, sender: unknown, response: (value: unknown) => void) => unknown
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: (next: typeof listener) => { listener = next } } } })
    const fetchConversationDetail = vi.fn(async () => null)
    registerParserMessageHandler({ platform: 'chatgpt', parser: {
      isConversationPage: () => false, parseCurrentConversation: async () => null,
      getConversationTitle: () => null, getConversationList: () => [],
      fetchConversationDetail, isAuthenticationRequired: () => false,
    } })
    const response = vi.fn()
    listener({ type: 'FETCH_CONVERSATION_DETAIL', data: { id: 123 } }, {}, response)
    expect(response).toHaveBeenCalledWith({ error: 'Invalid provider request' })
    expect(fetchConversationDetail).not.toHaveBeenCalled()
    response.mockClear()
    expect(() => listener(null, {}, response)).not.toThrow()
    listener({ type: 'UNRELATED_MESSAGE' }, {}, response)
    expect(response).not.toHaveBeenCalled()
  })

  it('returns sidebar fallback with incomplete metadata when the API list rejects', async () => {
    const sidebarList: ConversationListItem[] = [{
      id: 'sidebar-1',
      title: 'Sidebar chat',
      url: 'https://chatgpt.com/c/sidebar-1',
      platform: 'chatgpt',
    }]
    const listeners: Array<(message: any, sender: any, sendResponse: (response: any) => void) => boolean | void> = []
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: typeof listeners[number]) => {
            listeners.push(listener)
          }),
        },
      },
    })

    registerParserMessageHandler({
      platform: 'chatgpt',
      parser: {
        isConversationPage: () => false,
        parseCurrentConversation: async () => null,
        getConversationTitle: () => null,
        getConversationList: () => sidebarList,
        fetchAllConversations: async () => {
          throw new Error('history request failed')
        },
        getConversationListMeta: () => ({ source: 'api', complete: true, pagesFetched: 3 }),
        fetchConversationDetail: async () => null as Conversation | null,
        isAuthenticationRequired: () => true,
      },
    })

    const response = await new Promise<any>((resolve) => {
      expect(listeners[0]({ type: 'FETCH_ALL_CONVERSATIONS' }, {}, resolve)).toBe(true)
    })

    expect(response).toEqual({
      data: sidebarList,
      meta: { source: 'sidebar', complete: false, authRequired: true },
    })
  })
})
