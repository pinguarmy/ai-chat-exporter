import { describe, expect, it } from 'vitest'
import { mergeRenderedImageAttachments, shouldUseApiFallback, preferMoreCompleteConversation } from '../../src/providers/parser-fallback'
import type { Conversation } from '../../src/core/types'

const conv = (messages: Conversation['messages']): Conversation => ({
  id: 'conv-1',
  title: 'Test Conversation',
  url: 'https://claude.ai/chat/conv-1',
  platform: 'claude',
  messages
})

describe('parser API fallback decision', () => {
  it('falls back when DOM returns null', () => {
    expect(shouldUseApiFallback(null)).toBe(true)
  })

  it('falls back when DOM returns zero messages', () => {
    expect(shouldUseApiFallback(conv([]))).toBe(true)
  })

  it('falls back when DOM returns only user messages', () => {
    expect(shouldUseApiFallback(conv([
      { id: 'u1', role: 'user', content: 'Please analyse this report' }
    ]))).toBe(true)
  })

  it('falls back when assistant message is empty', () => {
    expect(shouldUseApiFallback(conv([
      { id: 'u1', role: 'user', content: 'Question' },
      { id: 'a1', role: 'assistant', content: '   ' }
    ]))).toBe(true)
  })

  it('does not fall back when DOM includes a non-empty assistant response', () => {
    expect(shouldUseApiFallback(conv([
      { id: 'u1', role: 'user', content: 'Question' },
      { id: 'a1', role: 'assistant', content: 'Answer' }
    ]))).toBe(false)
  })

  it('falls back when DOM contains assistant content but no user message', () => {
    expect(shouldUseApiFallback(conv([
      { id: 'a1', role: 'assistant', content: 'Answer without prompt' }
    ]))).toBe(true)
  })

  it('prefers API conversation when it has more messages than partial DOM result', () => {
    const dom = conv([{ id: 'u1', role: 'user', content: 'Question' }])
    const api = conv([
      { id: 'u1', role: 'user', content: 'Question' },
      { id: 'a1', role: 'assistant', content: 'Answer' }
    ])
    expect(preferMoreCompleteConversation(dom, api)).toBe(api)
  })

  it('prefers API conversation with assistant content even when DOM has more user-only messages', () => {
    const dom = conv([
      { id: 'u1', role: 'user', content: 'Question 1' },
      { id: 'u2', role: 'user', content: 'Question 2' },
      { id: 'u3', role: 'user', content: 'Question 3' }
    ])
    const api = conv([
      { id: 'u1', role: 'user', content: 'Question 1' },
      { id: 'a1', role: 'assistant', content: 'Answer 1' }
    ])
    expect(preferMoreCompleteConversation(dom, api)).toBe(api)
  })

  it('prefers API conversation when both have assistant content and equal message count', () => {
    const dom = conv([
      { id: 'u1', role: 'user', content: 'Question' },
      { id: 'a1', role: 'assistant', content: 'Rendered math H 0 H_0 H 0' }
    ])
    const api = conv([
      { id: 'u1', role: 'user', content: 'Question' },
      { id: 'a1', role: 'assistant', content: 'Rendered math \\(H_0\\)' }
    ])
    expect(preferMoreCompleteConversation(dom, api)).toBe(api)
  })

  it('keeps DOM conversation when API returns no improvement', () => {
    const dom = conv([
      { id: 'u1', role: 'user', content: 'Question' },
      { id: 'a1', role: 'assistant', content: 'Answer' }
    ])
    const api = conv([{ id: 'u1', role: 'user', content: 'Question' }])
    expect(preferMoreCompleteConversation(dom, api)).toBe(dom)
  })

  it('prefers provider-verified API data over a balanced unverified DOM tail', () => {
    const dom = {
      ...conv([
        { id: 'u-tail', role: 'user', content: 'Rendered tail question' },
        { id: 'a-tail', role: 'assistant', content: 'Rendered tail answer' }
      ]),
      source: 'dom' as const,
      sourceCompleteness: 'unverified' as const,
    }
    const api = {
      ...conv([{ id: 'u1', role: 'user', content: 'Prompt then Stop' }]),
      source: 'api' as const,
      sourceCompleteness: 'verified' as const,
    }

    expect(preferMoreCompleteConversation(dom, api)).toBe(api)
  })

  it('merges a DOM image into the matching API message without changing API text or order', () => {
    const api = conv([
      { id: 'u1', role: 'user', content: 'Question' },
      { id: 'a1', role: 'assistant', content: 'iturn447234image0\n\nAnswer with a rendered image.' }
    ])
    const dom = conv([
      { id: 'u1', role: 'user', content: 'Question' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Answer with a rendered image.',
        attachments: [{ type: 'image', url: 'https://images.example/chart.png', name: 'Chart' }]
      }
    ])

    const merged = mergeRenderedImageAttachments(api, dom)

    expect(merged?.messages).toHaveLength(2)
    expect(merged?.messages[1].content).toContain('iturn447234image0')
    expect(merged?.messages[1].attachments).toEqual([
      { type: 'image', url: 'https://images.example/chart.png', name: 'Chart' }
    ])
  })

  it('returns a DOM image to its paragraph position when richer API text has no image handle', () => {
    const api = conv([
      { id: 'u1', role: 'user', content: 'Question' },
      {
        id: 'a1',
        role: 'assistant',
        content: '## Repair recommendation\n\n**Nikon repair shop** · 4.6 · Camera repair service\n\nCall before visiting.'
      }
    ])
    const dom = conv([
      { id: 'u1', role: 'user', content: 'Question' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Repair recommendation\n\nNikon repair shop · 4.6 · Camera repair service\n\n![Nikon repair card](https://images.example/nikon-card.png)\n\nCall before visiting.',
        attachments: [{ type: 'image', url: 'https://images.example/nikon-card.png', name: 'Nikon repair card' }]
      }
    ])

    const merged = mergeRenderedImageAttachments(api, dom)
    const content = merged?.messages[1].content || ''

    expect(content).toContain('**Nikon repair shop**')
    expect(content.indexOf('Camera repair service')).toBeLessThan(content.indexOf('![Nikon repair card]'))
    expect(content.indexOf('![Nikon repair card]')).toBeLessThan(content.indexOf('Call before visiting.'))
    expect(merged?.messages[1].attachments).toEqual([
      { type: 'image', url: 'https://images.example/nikon-card.png', name: 'Nikon repair card' }
    ])
  })

  it('does not attach a rendered image to a different assistant turn', () => {
    const api = conv([
      { id: 'a1', role: 'assistant', content: 'One answer' }
    ])
    const dom = conv([
      {
        id: 'different',
        role: 'assistant',
        content: 'Completely unrelated answer',
        attachments: [{ type: 'image', url: 'https://images.example/unrelated.png' }]
      }
    ])

    expect(mergeRenderedImageAttachments(api, dom)).toBe(api)
  })
})
