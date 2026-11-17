import { beforeEach, describe, expect, it } from 'vitest'
import { collectSidebarConversationList } from '../src/lib/providers/sidebar-list'

describe('collectSidebarConversationList', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  const idFrom = (re: RegExp) => (href: string) => href.match(re)?.[1]

  it('normalizes relative links against the origin and fills a default title', () => {
    document.body.innerHTML = '<nav><a href="/c/abc-1">First chat</a><a href="/c/abc-2"> </a></nav>'
    expect(collectSidebarConversationList({
      selectors: ['nav a[href*="/c/"]'],
      platform: 'chatgpt',
      resolveId: idFrom(/\/c\/([a-f0-9-]+)/),
      origin: 'https://chatgpt.com'
    })).toEqual([
      { id: 'abc-1', title: 'First chat', url: 'https://chatgpt.com/c/abc-1', platform: 'chatgpt' },
      { id: 'abc-2', title: 'Untitled Conversation', url: 'https://chatgpt.com/c/abc-2', platform: 'chatgpt' }
    ])
  })

  it('defaults the origin to the current page', () => {
    document.body.innerHTML = '<nav><a href="/c/abc-1">x</a></nav>'
    const [item] = collectSidebarConversationList({
      selectors: ['nav a'], platform: 'chatgpt', resolveId: idFrom(/\/c\/([a-f0-9-]+)/)
    })
    expect(item.url).toBe(`${window.location.origin}/c/abc-1`)
  })

  it('deduplicates ids and ignores links the id resolver rejects', () => {
    document.body.innerHTML =
      '<nav><a href="/c/abc">a</a><a href="/c/abc">dup</a><a href="/settings">s</a><a>no href</a></nav>'
    const items = collectSidebarConversationList({
      selectors: ['nav a'], platform: 'chatgpt', resolveId: idFrom(/\/c\/([a-f0-9-]+)/), origin: 'https://x.test'
    })
    expect(items.map(i => i.id)).toEqual(['abc'])
    expect(items[0].title).toBe('a')
  })

  it('stops at the first selector that yields conversations instead of mixing broader ones', () => {
    document.body.innerHTML =
      '<nav><a href="/c/aaa">nav</a></nav><div><a href="/c/bbb">body</a></div>'
    expect(collectSidebarConversationList({
      selectors: ['nav a', 'a'], platform: 'chatgpt', resolveId: idFrom(/\/c\/([a-f0-9-]+)/), origin: 'https://x.test'
    }).map(i => i.id)).toEqual(['aaa'])
  })

  it('falls through to a broader selector when the specific one finds nothing', () => {
    document.body.innerHTML = '<div><a href="/c/bbb">body</a></div>'
    expect(collectSidebarConversationList({
      selectors: ['nav a', 'a'], platform: 'chatgpt', resolveId: idFrom(/\/c\/([a-f0-9-]+)/), origin: 'https://x.test'
    }).map(i => i.id)).toEqual(['bbb'])
  })

  it('lets providers validate ids beyond the URL pattern (Claude requires a UUID)', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    document.body.innerHTML = `<nav><a href="/chat/new-1">not uuid</a><a href="/chat/${uuid}">real</a></nav>`
    const items = collectSidebarConversationList({
      selectors: ['nav a'],
      platform: 'claude',
      resolveId: href => {
        const id = href.match(/\/chat\/([a-f0-9-]+)/)?.[1]
        return id && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ? id : null
      },
      origin: 'https://claude.ai'
    })
    expect(items.map(i => i.id)).toEqual([uuid])
  })

  it('supports providers with two URL shapes (DeepSeek prefers /a/chat/s/)', () => {
    document.body.innerHTML = '<nav><a href="/a/chat/s/ID_1">one</a><a href="/chat/ID_2">two</a></nav>'
    const items = collectSidebarConversationList({
      selectors: ['nav a'],
      platform: 'deepseek',
      resolveId: href =>
        (href.match(/\/a\/chat\/s\/([A-Za-z0-9_-]+)/) || href.match(/\/chat\/([A-Za-z0-9_-]+)/))?.[1],
      origin: 'https://chat.deepseek.com'
    })
    expect(items.map(i => i.id)).toEqual(['ID_1', 'ID_2'])
  })
})
