import { describe, expect, it } from 'vitest'
import { conversationToMarkdown } from '../../../src/core/export-markdown'
import { conversationToHtml } from '../../../src/core/export-pdf'
import { embedInlineImageAttachments } from '../../../src/core/inline-media'
import type { Conversation, ExportOptions } from '../../../src/core/types'

const options: ExportOptions = {
  format: 'pdf',
  includeMetadata: false,
  includeCodeBlocks: true,
  includeImages: true,
  includeUploadedFiles: true,
  pdfTextLayer: true
}

const platforms: Conversation['platform'][] = ['chatgpt', 'gemini', 'claude', 'deepseek', 'grok']

function conversation(platform: Conversation['platform']): Conversation {
  return {
    id: `inline-media-${platform}`,
    title: 'Inline media contract',
    url: `https://${platform}.example/conversation`,
    platform,
    messages: [
      {
        id: 'answer',
        role: 'assistant',
        content: 'Before **critical finding**.\n\niturn447234image0\n\nAfter the image.',
        attachments: [
          { type: 'image', name: 'Nikon repair card', url: 'https://images.example/nikon-card.png' }
        ]
      }
    ]
  }
}

describe('inline media transcript contract', () => {
  it('replaces a provider image handle once and retains surrounding prose', () => {
    const result = embedInlineImageAttachments('Before\n\niturn447234image0\n\nAfter', [
      { type: 'image', name: 'Card', url: 'https://images.example/card.png' }
    ])

    expect(result.content).toContain('![Card](https://images.example/card.png)')
    expect(result.usedImageUrls.size).toBe(1)
    expect(result.content.indexOf('Before')).toBeLessThan(result.content.indexOf('![Card]'))
    expect(result.content.indexOf('![Card]')).toBeLessThan(result.content.indexOf('After'))
  })

  for (const platform of platforms) {
    it(`${platform} keeps bold text and inline media in PDF/Markdown order`, () => {
      const source = conversation(platform)
      const html = conversationToHtml(source, options)
      const markdown = conversationToMarkdown(source, { ...options, format: 'markdown' })

      expect(html).toContain('<strong>critical finding</strong>')
      expect(html.match(/nikon-card\.png/g)).toHaveLength(1)
      expect(html.indexOf('Before')).toBeLessThan(html.indexOf('nikon-card.png'))
      expect(html.indexOf('nikon-card.png')).toBeLessThan(html.indexOf('After the image.'))
      expect(markdown.match(/nikon-card\.png/g)).toHaveLength(1)
      expect(markdown.indexOf('Before')).toBeLessThan(markdown.indexOf('nikon-card.png'))
      expect(markdown.indexOf('nikon-card.png')).toBeLessThan(markdown.indexOf('After the image.'))
    })
  }
})
