import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../src/lib/types'
import {
  filterMessageAttachments,
  getRenderableAttachments,
  preparePreviewMessage,
  removeInlineMarkdownCodeBlocks,
  shouldIncludeAttachment,
  shouldShowHeaderMetadata,
  shouldShowMessageTimestamp
} from '../src/lib/preview-message'

describe('preview-message — includeCodeBlocks semantics', () => {
  it('preserves embedded code blocks and renders <pre><code> when includeCodeBlocks is true', () => {
    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'Here is Python code:\n```python\ndef add(a, b):\n    return a + b\n```\nDone.'
    }

    const prepared = preparePreviewMessage(msg, {
      includeCodeBlocks: true,
      includeImages: true,
      includeMetadata: true
    })

    expect(prepared.contentHtml).toContain('<pre data-language="python"><code>')
    expect(prepared.contentHtml).toContain('def add(a, b):')
    expect(prepared.contentHtml).toContain('return a + b')
    expect(prepared.hasEmbeddedCodeBlocks).toBe(true)
    expect(prepared.shouldRenderStandaloneCodeBlocks).toBe(false)
  })

  it('strips embedded markdown fences and renders no <pre><code> when includeCodeBlocks is false', () => {
    const msg: ChatMessage = {
      id: 'm2',
      role: 'assistant',
      content: 'Before code.\n```typescript\nconst answer = 42;\n```\nAfter code.'
    }

    const prepared = preparePreviewMessage(msg, {
      includeCodeBlocks: false,
      includeImages: true,
      includeMetadata: true
    })

    expect(prepared.contentHtml).not.toContain('<pre')
    expect(prepared.contentHtml).not.toContain('const answer = 42')
    expect(prepared.contentHtml).toContain('Before code.')
    expect(prepared.contentHtml).toContain('After code.')
    expect(prepared.shouldRenderStandaloneCodeBlocks).toBe(false)
  })

  it('removes multiple code fences and handles 4+ backtick fences', () => {
    const content = [
      'Intro',
      '```js',
      'console.log("first");',
      '```',
      'Middle',
      '````markdown',
      '```nested```',
      '````',
      'Outro'
    ].join('\n')

    const stripped = removeInlineMarkdownCodeBlocks(content)
    expect(stripped).not.toContain('console.log')
    expect(stripped).not.toContain('nested')
    expect(stripped).toContain('Intro')
    expect(stripped).toContain('Middle')
    expect(stripped).toContain('Outro')
  })

  it('preserves inline backtick formatting when includeCodeBlocks is false', () => {
    const msg: ChatMessage = {
      id: 'm3',
      role: 'user',
      content: 'Check the value of `process.env.NODE_ENV` before running.'
    }

    const prepared = preparePreviewMessage(msg, {
      includeCodeBlocks: false,
      includeImages: true,
      includeMetadata: true
    })

    expect(prepared.contentHtml).toContain('<code>process.env.NODE_ENV</code>')
    expect(prepared.contentHtml).not.toContain('<pre')
  })

  it('controls standalone codeBlocks array based on includeCodeBlocks and embedded presence', () => {
    const msgWithoutEmbedded: ChatMessage = {
      id: 'm4',
      role: 'assistant',
      content: 'Here is the standalone snippet:',
      codeBlocks: [{ language: 'rust', code: 'fn main() {}' }]
    }

    const enabled = preparePreviewMessage(msgWithoutEmbedded, {
      includeCodeBlocks: true,
      includeImages: true,
      includeMetadata: true
    })
    expect(enabled.shouldRenderStandaloneCodeBlocks).toBe(true)
    expect(enabled.codeBlocks).toEqual([{ language: 'rust', code: 'fn main() {}' }])

    const disabled = preparePreviewMessage(msgWithoutEmbedded, {
      includeCodeBlocks: false,
      includeImages: true,
      includeMetadata: true
    })
    expect(disabled.shouldRenderStandaloneCodeBlocks).toBe(false)
  })
})

describe('preview-message — includeUploadedFiles semantics', () => {
  it('excludes user-uploaded non-image files when includeUploadedFiles is false', () => {
    const uploadedDoc = {
      type: 'file' as const,
      name: 'notes.pdf',
      url: 'https://example.com/notes.pdf',
      uploaded: true
    }

    expect(shouldIncludeAttachment(uploadedDoc, { includeUploadedFiles: false })).toBe(false)
    expect(shouldIncludeAttachment(uploadedDoc, { includeUploadedFiles: true })).toBe(true)
    expect(shouldIncludeAttachment(uploadedDoc, {})).toBe(true)

    const filtered = filterMessageAttachments([uploadedDoc], { includeUploadedFiles: false })
    expect(filtered).toHaveLength(0)
  })

  it('never excludes user-uploaded images when includeUploadedFiles is false', () => {
    const userUploadedImage = {
      type: 'image' as const,
      name: 'screenshot.png',
      url: 'https://example.com/screenshot.png',
      uploaded: true
    }

    // User images must NOT be removed when includeUploadedFiles is false
    expect(shouldIncludeAttachment(userUploadedImage, { includeUploadedFiles: false })).toBe(true)

    const msg: ChatMessage = {
      id: 'm-img',
      role: 'user',
      content: 'Look at this screenshot:',
      attachments: [userUploadedImage]
    }

    const prepared = preparePreviewMessage(msg, {
      includeUploadedFiles: false,
      includeImages: true,
      includeMetadata: true
    })

    expect(prepared.imageAttachments).toHaveLength(1)
    expect(prepared.imageAttachments[0].url).toBe('https://example.com/screenshot.png')
  })

  it('preserves non-uploaded file attachments when includeUploadedFiles is false', () => {
    const modelGeneratedFile = {
      type: 'file' as const,
      name: 'generated.csv',
      url: 'https://example.com/generated.csv',
      uploaded: false
    }

    expect(shouldIncludeAttachment(modelGeneratedFile, { includeUploadedFiles: false })).toBe(true)

    const filtered = filterMessageAttachments([modelGeneratedFile], { includeUploadedFiles: false })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('generated.csv')
  })

  it('formats otherAttachments safely and rejects unsafe protocols', () => {
    const safeAttachment = {
      type: 'file' as const,
      name: 'valid.pdf',
      url: 'https://example.com/valid.pdf'
    }
    const unsafeAttachment = {
      type: 'file' as const,
      name: 'exploit',
      url: 'javascript:alert(1)'
    }

    const renderable = getRenderableAttachments([safeAttachment, unsafeAttachment], {
      referenceExportMode: 'all-links',
      locale: 'en'
    })

    expect(renderable).toHaveLength(2)
    expect(renderable[0].safeUrl).toBe('https://example.com/valid.pdf')
    expect(renderable[1].safeUrl).toBeUndefined()
  })
})

describe('preview-message — includeMetadata semantics', () => {
  it('controls message timestamps consistent with Markdown and PDF export', () => {
    const timestamp = 1715000000000

    // Enabled
    expect(shouldShowMessageTimestamp(timestamp, {
      includeMetadata: true,
      showMessageTimestamps: true
    })).toBe(true)

    // Hidden when includeMetadata is false
    expect(shouldShowMessageTimestamp(timestamp, {
      includeMetadata: false,
      showMessageTimestamps: true
    })).toBe(false)

    // Hidden when showMessageTimestamps is false
    expect(shouldShowMessageTimestamp(timestamp, {
      includeMetadata: true,
      showMessageTimestamps: false
    })).toBe(false)

    // Hidden when timestamp is invalid
    expect(shouldShowMessageTimestamp(NaN, {
      includeMetadata: true,
      showMessageTimestamps: true
    })).toBe(false)
  })

  it('reflects timestamp visibility in preparePreviewMessage', () => {
    const msg: ChatMessage = {
      id: 'm-time',
      role: 'user',
      content: 'Hello',
      timestamp: 1715000000000
    }

    const withMetadata = preparePreviewMessage(msg, {
      includeMetadata: true,
      showMessageTimestamps: true
    })
    expect(withMetadata.hasTimestamp).toBe(true)

    const withoutMetadata = preparePreviewMessage(msg, {
      includeMetadata: false,
      showMessageTimestamps: true
    })
    expect(withoutMetadata.hasTimestamp).toBe(false)
  })

  it('controls header metadata section visibility', () => {
    expect(shouldShowHeaderMetadata({ includeMetadata: true })).toBe(true)
    expect(shouldShowHeaderMetadata({ includeMetadata: false })).toBe(false)
    expect(shouldShowHeaderMetadata({})).toBe(true)
  })
})

describe('preview-message — includeImages semantics', () => {
  it('removes inline markdown images and attachment images when includeImages is false', () => {
    const msg: ChatMessage = {
      id: 'm-img2',
      role: 'assistant',
      content: 'Here is an image: ![chart](https://example.com/chart.png)',
      attachments: [{
        type: 'image',
        name: 'extra.png',
        url: 'https://example.com/extra.png'
      }]
    }

    const enabled = preparePreviewMessage(msg, {
      includeImages: true,
      includeMetadata: true
    })
    expect(enabled.contentHtml).toContain('<img')
    expect(enabled.contentHtml).toContain('https://example.com/chart.png')
    expect(enabled.imageAttachments).toHaveLength(1)

    const disabled = preparePreviewMessage(msg, {
      includeImages: false,
      includeMetadata: true
    })
    expect(disabled.contentHtml).not.toContain('<img')
    expect(disabled.imageAttachments).toHaveLength(0)
  })
})
