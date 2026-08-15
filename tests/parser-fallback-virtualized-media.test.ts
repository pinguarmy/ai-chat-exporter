import { describe, expect, it } from 'vitest'
import { mergeRenderedImageAttachments } from '../src/lib/parser-fallback'
import type { Conversation } from '../src/lib/types'

function conversation(messages: Conversation['messages']): Conversation {
  return {
    id: 'virtualized-media',
    title: 'Virtualized media',
    url: 'https://claude.ai/chat/virtualized-media',
    platform: 'claude',
    messages,
  }
}

describe('virtualized rendered-media alignment', () => {
  it('maps a short image-bearing DOM tail message back to its late API turn', () => {
    const apiMessages: Conversation['messages'] = Array.from({ length: 80 }, (_, index) => ({
      id: `api-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 77 ? 'See this image.' : `API message ${index}`,
    }))
    const renderedTail: Conversation['messages'] = apiMessages.slice(72).map((message, tailIndex) => ({
      ...message,
      // Simulate DOM-only/generated IDs that cannot match the API UUID.
      id: `dom-${tailIndex}`,
      ...(message.id === 'api-77'
        ? {
            content: 'See this image.\n\n![Chart](https://images.example/late-chart.png)',
            attachments: [{ type: 'image' as const, url: 'https://images.example/late-chart.png', name: 'Chart' }],
          }
        : {}),
    }))

    const merged = mergeRenderedImageAttachments(conversation(apiMessages), conversation(renderedTail))

    expect(merged?.messages[77].attachments).toEqual([
      { type: 'image', url: 'https://images.example/late-chart.png', name: 'Chart' },
    ])
    expect(merged?.messages[77].content).toContain('![Chart](https://images.example/late-chart.png)')
    expect(merged?.messages[5].attachments).toBeUndefined()
  })

  it('uses exact provider message IDs before text similarity', () => {
    const api = conversation([
      { id: 'u1', role: 'user', content: 'Question' },
      { id: 'a1', role: 'assistant', content: 'API wording differs substantially.' },
    ])
    const rendered = conversation([
      {
        id: 'a1',
        role: 'assistant',
        content: 'Rendered wording.\n\n![Diagram](https://images.example/id-match.png)',
        attachments: [{ type: 'image', url: 'https://images.example/id-match.png' }],
      },
    ])

    const merged = mergeRenderedImageAttachments(api, rendered)
    expect(merged?.messages[1].attachments?.[0].url).toBe('https://images.example/id-match.png')
  })

  it('does not attach media when the same-role tail text is unrelated', () => {
    const api = conversation([
      { id: 'u1', role: 'user', content: 'Question one' },
      { id: 'a1', role: 'assistant', content: 'First answer' },
      { id: 'u2', role: 'user', content: 'Question two' },
      { id: 'a2', role: 'assistant', content: 'Second answer' },
    ])
    const rendered = conversation([
      {
        id: 'dom-a',
        role: 'assistant',
        content: 'Unrelated rendered answer\n\n![Wrong](https://images.example/wrong.png)',
        attachments: [{ type: 'image', url: 'https://images.example/wrong.png' }],
      },
    ])

    expect(mergeRenderedImageAttachments(api, rendered)).toBe(api)
  })

  it('keeps repeated short text tied to the correct same-role tail ordinal', () => {
    const api = conversation([
      { id: 'u1', role: 'user', content: 'Prompt 1' },
      { id: 'a1', role: 'assistant', content: 'Done.' },
      { id: 'u2', role: 'user', content: 'Prompt 2' },
      { id: 'a2', role: 'assistant', content: 'Done.' },
      { id: 'u3', role: 'user', content: 'Prompt 3' },
      { id: 'a3', role: 'assistant', content: 'Done.' },
    ])
    const rendered = conversation([
      { id: 'dom-u3', role: 'user', content: 'Prompt 3' },
      {
        id: 'dom-a3',
        role: 'assistant',
        content: 'Done.\n\n![Final](https://images.example/final.png)',
        attachments: [{ type: 'image', url: 'https://images.example/final.png' }],
      },
    ])

    const merged = mergeRenderedImageAttachments(api, rendered)
    expect(merged?.messages[5].attachments?.[0].url).toBe('https://images.example/final.png')
    expect(merged?.messages[1].attachments).toBeUndefined()
    expect(merged?.messages[3].attachments).toBeUndefined()
  })
})
