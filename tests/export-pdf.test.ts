/**
 * Export PDF Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  calculatePdfPageSlices,
  conversationToHtml,
  exportToPdfBlob,
  groupPdfPageSlices
} from '../src/lib/export-pdf'
import type { Conversation, ExportOptions } from '../src/lib/types'

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => ({
    width: 800,
    height: 1000,
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,mock')
  }))
}))

vi.mock('jspdf', () => ({
  jsPDF: class MockJsPdf {
    addImage = vi.fn()
    addPage = vi.fn()
    output = vi.fn(() => new Blob(['mock pdf'], { type: 'application/pdf' }))
  }
}))

// Mock chrome API
const mockChrome = {
  downloads: {
    download: vi.fn().mockResolvedValue(1)
  }
}

vi.stubGlobal('chrome', mockChrome)

describe('Export PDF', () => {
  const defaultOptions: ExportOptions = {
    format: 'pdf',
    includeMetadata: true,
    includeCodeBlocks: true,
    includeImages: true
  }

  const createConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
    id: 'test-conv-1',
    title: 'Test Conversation',
    url: 'https://chatgpt.com/c/test',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Hello, how are you?'
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: "I'm doing well, thank you!"
      }
    ],
    platform: 'chatgpt',
    ...overrides
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('calculatePdfPageSlices', () => {
    it('uses nearby block boundaries instead of cutting through text', () => {
      expect(calculatePdfPageSlices(2500, 1000, [920, 1850])).toEqual([
        { start: 0, height: 920 },
        { start: 920, height: 930 },
        { start: 1850, height: 650 }
      ])
    })

    it('hard-crops a block that is taller than one page', () => {
      expect(calculatePdfPageSlices(2100, 1000)).toEqual([
        { start: 0, height: 1000 },
        { start: 1000, height: 1000 },
        { start: 2000, height: 100 }
      ])
    })
  })

  describe('groupPdfPageSlices', () => {
    it('groups adjacent pages without exceeding the safe chunk height', () => {
      const slices = calculatePdfPageSlices(10000, 1000)
      const chunks = groupPdfPageSlices(slices, 4000)

      expect(chunks.map(chunk => chunk.slices.length)).toEqual([4, 4, 2])
      expect(chunks.every(chunk => chunk.height <= 4000)).toBe(true)
      expect(chunks.flatMap(chunk => chunk.slices)).toEqual(slices)
    })
  })

  describe('conversationToHtml', () => {
    it('should generate valid HTML structure', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html')
      expect(html).toContain('<head>')
      expect(html).toContain('<body>')
      expect(html).toContain('</html>')
    })

    it('should include metadata when enabled', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('<h1>Test Conversation</h1>')
      expect(html).toContain('Platform:')
      expect(html).toContain('ChatGPT')
      expect(html).toContain('Messages:')
      expect(html).toContain('2')
    })

    it('should exclude metadata when disabled', () => {
      const conv = createConversation()
      const options = { ...defaultOptions, includeMetadata: false }
      const html = conversationToHtml(conv, options)
      
      expect(html).not.toContain('<h1>Test Conversation</h1>')
      expect(html).not.toContain('**Platform:**')
    })

    it('should format user messages', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('class="message user"')
      expect(html).toContain('Hello, how are you?')
    })

    it('should format assistant messages', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('class="message assistant"')
      expect(html).toContain('I&#039;m doing well, thank you!')
    })

    it('keeps an ordered list continuous across blank lines', () => {
      const conv = createConversation({
        messages: [{ id: 'msg-1', role: 'assistant', content: '1. First\n\n1. Second' }]
      })
      const html = conversationToHtml(conv, defaultOptions)

      expect(html.match(/<ol>/g)).toHaveLength(1)
      expect(html.match(/<li>/g)).toHaveLength(2)
      expect(html.match(/<\/ol>/g)).toHaveLength(1)
    })

    it('should include code blocks when enabled', () => {
      const conv = createConversation({
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Here is code:',
            codeBlocks: [
              {
                language: 'python',
                code: 'print("hello")'
              }
            ]
          }
        ]
      })
      
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('<pre')
      expect(html).toContain('print(&quot;hello&quot;)')
    })

    it('should exclude code blocks when disabled', () => {
      const conv = createConversation({
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Here is code:',
            codeBlocks: [
              {
                language: 'python',
                code: 'print("hello")'
              }
            ]
          }
        ]
      })
      
      const options = { ...defaultOptions, includeCodeBlocks: false }
      const html = conversationToHtml(conv, options)
      
      expect(html).not.toContain('<pre')
    })

    it('should include images when enabled', () => {
      const conv = createConversation({
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Here is an image:',
            attachments: [
              {
                type: 'image',
                url: 'https://example.com/image.png',
                name: 'Test image'
              }
            ]
          }
        ]
      })
      
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('<img')
      expect(html).toContain('src="https://example.com/image.png"')
    })

    describe('Artifacts section (exportArtifacts) — mirrors markdown', () => {
      it('renders an Artifacts block from conversation.artifacts when exportArtifacts is on', () => {
        const conv = createConversation({
          artifacts: [
            { type: 'html', title: 'Page', content: '<html></html>', url: 'https://safe.example/a.html' }
          ]
        })
        const html = conversationToHtml(conv, { ...defaultOptions, exportArtifacts: true })
        expect(html).toContain('<h2>Artifacts</h2>')
        expect(html).toContain('https://safe.example/a.html')
      })

      it('omits the Artifacts block when exportArtifacts is off', () => {
        const conv = createConversation({
          artifacts: [
            { type: 'html', title: 'Page', content: '<html></html>', url: 'https://safe.example/a.html' }
          ]
        })
        const html = conversationToHtml(conv, { ...defaultOptions, exportArtifacts: false })
        expect(html).not.toContain('<h2>Artifacts</h2>')
      })

      it('blocks non-http(s)/mailto artifact urls (no javascript: link target)', () => {
        const conv = createConversation({
          artifacts: [
            { type: 'html', title: '[click me](javascript:alert(1))', content: 'x', url: 'javascript:alert(1)' }
          ]
        })
        const html = conversationToHtml(conv, { ...defaultOptions, exportArtifacts: true })
        // The link TARGET must never be the javascript: url — it is sanitized to '#'.
        expect(html).not.toContain('href="javascript:alert(1)"')
        expect(html).toContain('href="#"')
        // The malicious title is rendered as inert escaped text, not as a live link.
        expect(html).toContain('click me')
      })

      it('drops user-uploaded document artifacts when includeUploadedFiles is off', () => {
        const conv = createConversation({
          artifacts: [
            { type: 'html', title: 'Page', content: '<html></html>', url: 'https://safe.example/a.html' },
            { type: 'document', title: 'my-upload.pdf', content: '', url: 'https://files.example/my-upload.pdf' }
          ]
        })
        const html = conversationToHtml(conv, { ...defaultOptions, exportArtifacts: true, includeUploadedFiles: false })
        expect(html).toContain('https://safe.example/a.html')
        expect(html).not.toContain('my-upload.pdf')
      })
    })

    it('should escape HTML in content', () => {
      const conv = createConversation({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Test <script>alert("xss")</script>'
          }
        ]
      })
      
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>alert')
    })

    it('keeps HTML-looking LaTex and markdown-link URLs inert in the render container', () => {
      const conv = createConversation({
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: '$<img src="x" onerror="alert(1)">$\n[link](https://example.com" onmouseover="alert(1))'
        }]
      })
      const container = document.createElement('div')
      container.innerHTML = conversationToHtml(conv, defaultOptions)

      expect(container.querySelector('.latex img')).toBeNull()
      expect(container.querySelector('.content a')?.getAttribute('onmouseover')).toBeNull()
    })

    it('should handle empty conversation', () => {
      const conv = createConversation({ messages: [] })
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Test Conversation')
    })

    it('should include print styles', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('<style>')
      expect(html).toContain('@page')
      expect(html).toContain('font-family')
    })

    it('should handle Gemini platform', () => {
      const conv = createConversation({ platform: 'gemini' })
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('Google Gemini')
    })
  })

  describe('HTML Structure', () => {
    it('should have proper CSS classes', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('class="conversation"')
      expect(html).toContain('class="messages"')
      expect(html).toContain('class="metadata"')
    })

    it('should include footer', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('<footer>')
      expect(html).toContain('Exported from')
    })

    it('should have responsive viewport meta', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('meta name="viewport"')
    })
  })

  describe('PDF Blob Generation (mocked)', () => {
    it('returns a PDF blob and removes its temporary render container', async () => {
      const conv = createConversation()
      const childCount = document.body.childElementCount

      const blob = await exportToPdfBlob(conv, defaultOptions)

      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('application/pdf')
      expect(document.body.childElementCount).toBe(childCount)
    })

    it('should generate HTML content for PDF rendering', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      // Verify HTML is valid for PDF rendering
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<body>')
      expect(html).toContain('class="conversation"')
    })
  })

  describe('Cleanup', () => {
    it('should provide HTML that can be cleaned up', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      // Verify HTML doesn't contain any persistent state
      expect(html).not.toContain('localStorage')
      expect(html).not.toContain('sessionStorage')
      expect(html).not.toContain('indexedDB')
    })
  })
})
