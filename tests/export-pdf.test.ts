/**
 * Export PDF Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import html2canvas from 'html2canvas'
import {
  calculatePdfPageSlices,
  collectPdfTextRuns,
  conversationToHtml,
  exportToPdf,
  exportToPdfBlob,
  formatMessageTimestamp,
  fitPdfImages,
  formatHtmlContent,
  getAssistantDisplayName,
  groupPdfPageSlices,
  selectPdfVisualTextMode
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

    it('folds a tiny trailing layout remainder into the previous page', () => {
      expect(calculatePdfPageSlices(1004, 1000)).toEqual([
        { start: 0, height: 1004 }
      ])
    })

    it('prefers an image boundary before the normal text boundary', () => {
      expect(calculatePdfPageSlices(2600, 1000, [980, 1980], [760])).toEqual([
        { start: 0, height: 760 },
        { start: 760, height: 1000 },
        { start: 1760, height: 840 }
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
    it('renders file attachments without a URL without throwing', () => {
      const conv = createConversation({
        messages: [{
          id: 'm1',
          role: 'user',
          content: 'Uploaded document',
          attachments: [{ type: 'file', name: 'document.pdf' } as never],
        }],
      })
      const html = conversationToHtml(conv, {
        format: 'pdf',
        includeMetadata: true,
        includeCodeBlocks: true,
        includeImages: true,
      })
      expect(html).toContain('document.pdf')
    })

    it('does not double-escape query parameters in inline markdown images', () => {
      const html = formatHtmlContent('![A & B](https://example.com/img.png?w=100&h=200)')
      expect(html).toContain('src="https://example.com/img.png?w=100&amp;h=200"')
      expect(html).toContain('alt="A &amp; B"')
      expect(html).not.toContain('&amp;amp;')
    })

    it('localizes generated document labels and language metadata', () => {
      const conv = createConversation({
        title: '',
        messages: [
          { id: 'm1', role: 'user', content: '你好' },
          { id: 'm2', role: 'system', content: '规则' }
        ]
      })
      const html = conversationToHtml(conv, { ...defaultOptions, locale: 'zh-TW' })

      expect(html).toContain('<html lang="zh-TW">')
      expect(html).toContain('未命名對話')
      expect(html).toContain('平台:</strong> ChatGPT')
      expect(html).toContain('使用者')
      expect(html).toContain('系統')
      expect(html).toContain('由 ChatGPT 匯出於')
    })

    it('renders an unsafe conversation URL as text instead of an active link', () => {
      const html = conversationToHtml(createConversation({ url: 'javascript:alert(1)' }), defaultOptions)

      expect(html).toContain('javascript:alert(1)')
      expect(html).not.toContain('href="javascript:')
    })

    it('renders rich Markdown structure for the shared preview/PDF path', () => {
      const html = formatHtmlContent('## Heading\n\n- First\n- Second\n\n```ts\nconst ready = true\n```')

      expect(html).toContain('<h2>Heading</h2>')
      expect(html).toContain('<ul>')
      expect(html).toContain('<li>First</li>')
      expect(html).toContain('<pre data-language="ts"><code>const ready = true</code></pre>')
    })

    it('renders Markdown tables instead of exposing pipe syntax', () => {
      const html = formatHtmlContent(
        '| Device | Can share Wi-Fi |\n| :--- | ---: |\n| 4G module | No |\n| MiFi | Yes |'
      )

      expect(html).toContain('<table>')
      expect(html).toContain('<thead>')
      expect(html).toContain('<th style="text-align:left">Device</th>')
      expect(html).toContain('<th style="text-align:right">Can share Wi-Fi</th>')
      expect(html).toContain('<td style="text-align:left">4G module</td>')
      expect(html).not.toContain('| Device |')
      expect(html).not.toContain('| --- |')
    })

    it('removes Grok citation-card markup from the preview/PDF path', () => {
      const html = formatHtmlContent(
        'Claim.<grok:render card_id="abc" card_type="citation_card"><argument name="citation_id">92</argument></grok:render>'
      )

      expect(html).toContain('Claim.')
      expect(html).not.toContain('grok:render')
      expect(html).not.toContain('citation_id')
    })

    it('keeps currency amounts in normal prose instead of splitting them as LaTeX', () => {
      const html = formatHtmlContent('Genesis commitments ($60M / $40M).')

      expect(html).toContain('<p>Genesis commitments ($60M / $40M).</p>')
      expect(html).not.toContain('class="latex"')
    })

    it('does not treat underscores inside URL slugs as page-wide emphasis', () => {
      const html = formatHtmlContent('https://example.com/crescendo_heres_the_sources')

      expect(html).toContain('<a href="https://example.com/crescendo_heres_the_sources">')
      expect(html).not.toContain('<em>')
    })

    it('preserves query parameters in clickable Markdown links', () => {
      const html = formatHtmlContent('[source](https://example.com/search?q=ai&lang=zh-CN)')

      expect(html).toContain('href="https://example.com/search?q=ai&amp;lang=zh-CN"')
    })

    it('renders LaTeX as semantic MathML without raw delimiters', () => {
      const html = formatHtmlContent(String.raw`\[\text{citation share}=\frac{\text{domain citations}}{\text{all citations}}\]`)

      expect(html).toContain('<math')
      expect(html).toContain('citation share')
      expect(html).not.toContain('\\[')
      expect(html).not.toContain('<p>\\frac')
    })

    it('should generate valid HTML structure', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html')
      expect(html).toContain('<head>')
      expect(html).toContain('<body class="pdf-document-root pdf-style-minimal">')
      expect(html).toContain('</html>')
    })

    it('should include metadata when enabled', () => {
      const conv = createConversation()
      const html = conversationToHtml(conv, defaultOptions)
      
      expect(html).toContain('<h1>Test Conversation</h1>')
      expect(html).toContain('Platform:')
      expect(html).toContain('ChatGPT')
      expect(html).toContain('Visible messages:')
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

    it('renders system messages with their own role and presentation hook', () => {
      const conv = createConversation({
        messages: [{ id: 'msg-system', role: 'system', content: 'Follow policy.' }]
      })
      const parsed = new DOMParser().parseFromString(
        conversationToHtml(conv, defaultOptions),
        'text/html'
      )
      const message = parsed.querySelector('.message.system')

      expect(message).not.toBeNull()
      expect(message?.querySelector('.role')?.textContent).toBe('System')
      expect(message?.classList.contains('assistant')).toBe(false)
      expect(message?.querySelector('.content')?.textContent).toContain('Follow policy.')
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
      expect(html).toContain('data-pdf-block="image"')
    })

    it('fits image blocks to the available page height', () => {
      const container = document.createElement('div')
      container.innerHTML = '<figure class="image" data-pdf-block="image"><img></figure>'
      expect(fitPdfImages(container, 1000)).toBe(720)
      expect(container.querySelector('img')?.style.maxHeight).toBe('720px')
      expect(container.querySelector('img')?.style.width).toBe('auto')
    })

    it('uses a compact model-and-time conversation heading', () => {
      const conv = createConversation({ modelName: 'gpt-5-6-thinking' })
      const timestamp = new Date(2026, 6, 30, 21, 17, 49).getTime()
      conv.messages[1].timestamp = timestamp

      const html = conversationToHtml(conv, defaultOptions)

      expect(getAssistantDisplayName(conv)).toBe('GPT-5.6 Thinking')
      expect(formatMessageTimestamp(timestamp)).toBe('2026-07-30 · 21:17')
      expect(html).toContain('<div class="message-meta"><span class="role">GPT-5.6 Thinking</span><span class="meta-separator"')
      expect(html).not.toContain('letter-spacing: 0.08em')

      // The visible label is intentionally minute-precision, while the
      // machine-readable datetime keeps the original seconds. Inspect the
      // rendered node instead of searching the whole HTML, because the ISO
      // attribute necessarily contains the seconds on UTC runners.
      const timestampNode = new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector('time.timestamp')
      expect(timestampNode?.textContent).toBe('2026-07-30 · 21:17')
      expect(timestampNode?.getAttribute('datetime')).toBe(new Date(timestamp).toISOString())
    })

    describe('Artifacts section (exportArtifacts) — mirrors markdown', () => {
      it('renders an Artifacts block from conversation.artifacts when exportArtifacts is on', () => {
        const conv = createConversation({
          artifacts: [
            { type: 'html', title: 'Page', content: '<html></html>', url: 'https://safe.example/a.html' }
          ]
        })
        const html = conversationToHtml(conv, { ...defaultOptions, exportArtifacts: true, referenceExportMode: 'all-links' })
        expect(html).toContain('<h2>Artifacts</h2>')
        expect(html).toContain('<h3>Page</h3>')
        expect(html).toContain('href="https://safe.example/a.html"')
        expect(html).not.toContain('<li><a href="https://safe.example/a.html">Page</a></li>')
      })

      it('renders inline artifact metadata and content safely', () => {
        const conv = createConversation({
          artifacts: [{
            type: 'html',
            title: 'Core dashboard',
            content: '<script>alert(1)</script>',
            language: 'html',
            mimeType: 'text/html'
          }]
        })
        const html = conversationToHtml(conv, { ...defaultOptions, exportArtifacts: true })

        expect(html).toContain('<h3>Core dashboard</h3>')
        expect(html).toContain('<strong>Type:</strong> html')
        expect(html).toContain('<strong>MIME type:</strong> text/html')
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
        expect(html).not.toContain('<script>alert(1)</script>')
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
        // Non-http(s)/mailto artifact URLs must never become a live link target.
        expect(html).not.toContain('href="javascript:alert(1)"')
        expect(html).not.toMatch(/<a[^>]+javascript:/)
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
        const html = conversationToHtml(conv, { ...defaultOptions, exportArtifacts: true, includeUploadedFiles: false, referenceExportMode: 'all-links' })
        expect(html).toContain('href="https://safe.example/a.html"')
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
      expect(html).toContain('<body class="pdf-document-root pdf-style-minimal">')
      expect(html).not.toContain('👤')
      expect(html).not.toContain('🤖')
    })

    it('applies classic selectors to the fragment root used by html2canvas', async () => {
      const conv = createConversation()
      let renderRoot: HTMLElement | null = null
      let renderedUserMessage: HTMLElement | null = null
      const rect = {
        x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 1000,
        width: 800, height: 1000, toJSON: () => ({})
      } as DOMRect
      const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
      vi.mocked(html2canvas).mockImplementationOnce(async target => {
        const root = target as HTMLElement
        const userMessage = root.querySelector<HTMLElement>('.message.user')
        renderRoot = root
        renderedUserMessage = userMessage
        throw new Error('fragment inspected')
      })

      await expect(exportToPdfBlob(conv, { ...defaultOptions, pdfStyle: 'classic' }))
        .rejects.toThrow('fragment inspected')
      rectSpy.mockRestore()

      expect(renderRoot).not.toBeNull()
      expect(renderRoot?.matches('.pdf-document-root.pdf-style-classic')).toBe(true)
      expect(renderedUserMessage?.matches('.pdf-document-root.pdf-style-classic .message.user')).toBe(true)
    })

    it('renders Markdown images as centered figures and drops map decoration assets', () => {
      const useful = formatHtmlContent('![Storefront](https://example.com/storefront.png)')
      const decoration = formatHtmlContent('![Marker](https://www.gstatic.com/gemini/maps/star.png)')

      expect(useful).toContain('<figure class="image" data-pdf-block="image">')
      expect(useful).toContain('class="markdown-image"')
      expect(decoration).not.toContain('star.png')
      expect(decoration).not.toContain('Marker')
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
    it('stops before rendering or downloading when its export signal is already cancelled', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(exportToPdf(createConversation(), defaultOptions, 'cancelled.pdf', {
        signal: controller.signal,
      })).rejects.toThrow('Export cancelled')
      expect(html2canvas).not.toHaveBeenCalled()
      expect(mockChrome.downloads.download).not.toHaveBeenCalled()
    })

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
      expect(html).toContain('<body class="pdf-document-root pdf-style-minimal">')
      expect(html).toContain('class="conversation"')
    })
  })

  describe('PDF visual text mode', () => {
    const run = (text: string) => ({
      text,
      left: 0,
      top: 0,
      bottom: 16,
      right: Math.max(1, text.length * 8),
      fontSize: 16
    })

    it('keeps Arabic text in the raster layer instead of hiding it', () => {
      const container = document.createElement('div')
      container.textContent = 'مرحبا بالعالم'

      expect(selectPdfVisualTextMode(container, [run(container.textContent)])).toBe('raster')
    })

    it('keeps mixed unsupported-script text in the raster layer', () => {
      const container = document.createElement('div')
      container.textContent = 'English then Ελληνικά and العربية'

      expect(selectPdfVisualTextMode(container, [run(container.textContent)])).toBe('raster')
    })

    it('retains the vector path for supported Latin and Chinese text', () => {
      const container = document.createElement('div')
      container.textContent = 'Résumé — 中文测试。'

      expect(selectPdfVisualTextMode(container, [run(container.textContent)])).toBe('vector')
    })

    it('skips character Range layout entirely for exceptionally large text', () => {
      const container = document.createElement('div')
      container.textContent = 'a'.repeat(250_001)
      const createRange = vi.spyOn(document, 'createRange')

      expect(collectPdfTextRuns(container)).toEqual([])
      expect(createRange).not.toHaveBeenCalled()
      createRange.mockRestore()
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
