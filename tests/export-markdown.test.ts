/**
 * Export Markdown Tests
 */

import { describe, it, expect } from 'vitest'
import { conversationToMarkdown, generateMarkdownFilename } from '../src/lib/export-markdown'
import type { Conversation, ExportOptions } from '../src/lib/types'

describe('Export Markdown', () => {
  const defaultOptions: ExportOptions = {
    format: 'markdown',
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

  describe('conversationToMarkdown', () => {
    it('should generate markdown with metadata', () => {
      const conv = createConversation()
      const markdown = conversationToMarkdown(conv, defaultOptions)
      
      expect(markdown).toContain('# Test Conversation')
      expect(markdown).toContain('**Platform:** ChatGPT')
      expect(markdown).toContain('**Visible messages:** 2')
    })

    it('renders structured references according to the privacy mode', () => {
      const conv = createConversation({
        source: 'api',
        sourceCompleteness: 'verified',
        messages: [{
          id: 'answer',
          role: 'assistant',
          content: 'Answer',
          references: [
            { type: 'web', title: 'Public source', url: 'https://example.com/source', private: false },
            { type: 'file', title: 'Private mail thread', url: 'https://mail.google.com/mail/u/0/#all/abc', private: true }
          ]
        }]
      })

      const titles = conversationToMarkdown(conv, { ...defaultOptions, referenceExportMode: 'titles' })
      expect(titles).toContain('**Sources:**')
      expect(titles).toContain('- Public source')
      expect(titles).toContain('- Private mail thread')
      expect(titles).not.toContain('https://example.com/source')
      expect(titles).not.toContain('mail.google.com')
      expect(titles).toContain('**Transcript source:** Provider API')
      expect(titles).toContain('**Source verification:** Verified by provider structure')

      const safeLinks = conversationToMarkdown(conv, { ...defaultOptions, referenceExportMode: 'safe-links' })
      expect(safeLinks).toContain('[Public source](https://example.com/source)')
      expect(safeLinks).toContain('- Private mail thread')
      expect(safeLinks).not.toContain('mail.google.com')

      const allLinks = conversationToMarkdown(conv, { ...defaultOptions, referenceExportMode: 'all-links' })
      expect(allLinks).toContain('[Private mail thread](https://mail.google.com/mail/u/0/#all/abc)')

      const off = conversationToMarkdown(conv, { ...defaultOptions, referenceExportMode: 'off' })
      expect(off).not.toContain('**Sources:**')
    })

    it('should generate markdown without metadata', () => {
      const conv = createConversation()
      const options = { ...defaultOptions, includeMetadata: false }
      const markdown = conversationToMarkdown(conv, options)
      
      expect(markdown).not.toContain('# Test Conversation')
      expect(markdown).not.toContain('**Platform:**')
    })

    it('should format user messages correctly', () => {
      const conv = createConversation()
      const markdown = conversationToMarkdown(conv, defaultOptions)
      
      expect(markdown).toContain('### 👤 User')
      expect(markdown).toContain('Hello, how are you?')
    })

    it('should format assistant messages correctly', () => {
      const conv = createConversation()
      const markdown = conversationToMarkdown(conv, defaultOptions)
      
      expect(markdown).toContain('### 🤖 Assistant')
      expect(markdown).toContain("I'm doing well, thank you!")
    })

    it('should handle messages with code blocks', () => {
      const conv = createConversation({
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Here is some code:',
            codeBlocks: [
              {
                language: 'javascript',
                code: 'console.log("hello");'
              }
            ]
          }
        ]
      })
      
      const markdown = conversationToMarkdown(conv, defaultOptions)
      
      expect(markdown).toContain('```javascript')
      expect(markdown).toContain('console.log("hello");')
    })

    it('should handle messages with images', () => {
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
      
      const markdown = conversationToMarkdown(conv, defaultOptions)
      
      expect(markdown).toContain('![Test image](https://example.com/image.png)')
    })

    it('should handle empty conversation', () => {
      const conv = createConversation({ messages: [] })
      const markdown = conversationToMarkdown(conv, defaultOptions)
      
      expect(markdown).toContain('# Test Conversation')
      expect(markdown).toContain('**Visible messages:** 0')
    })

    it('should handle special characters', () => {
      const conv = createConversation({
        title: 'Test <script>alert("xss")</script>',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello & welcome to "our" service!'
          }
        ]
      })
      
      const markdown = conversationToMarkdown(conv, defaultOptions)
      
      // Markdown should preserve the content (not escape HTML like HTML would)
      expect(markdown).toContain('Hello & welcome')
    })

    it('should add footer with export info', () => {
      const conv = createConversation()
      const markdown = conversationToMarkdown(conv, defaultOptions)
      
      expect(markdown).toContain('---')
      expect(markdown).toContain('Exported from ChatGPT')
    })

    it('should handle Gemini platform', () => {
      const conv = createConversation({ platform: 'gemini' })
      const markdown = conversationToMarkdown(conv, defaultOptions)
      
      expect(markdown).toContain('**Platform:** Google Gemini')
      expect(markdown).toContain('Exported from Google Gemini')
    })

    it('localizes generated document labels and suppresses unsafe attachment URLs', () => {
      const conv = createConversation({
        title: '',
        messages: [
          { id: 'm1', role: 'user', content: '你好' },
          {
            id: 'm2',
            role: 'system',
            content: '规则',
            attachments: [{ type: 'link', url: 'javascript:alert(1)' }]
          }
        ]
      })

      const markdown = conversationToMarkdown(conv, { ...defaultOptions, locale: 'zh-CN' })

      expect(markdown).toContain('# 未命名对话')
      expect(markdown).toContain('## 元数据')
      expect(markdown).toContain('**平台:** ChatGPT')
      expect(markdown).toContain('### 👤 用户')
      expect(markdown).toContain('### ⚙️ 系统')
      expect(markdown).toContain('**附件:**')
      expect(markdown).toContain('- 附件')
      expect(markdown).not.toContain('javascript:')
    })

    it('removes provider-only Grok citation markup while preserving the answer', () => {
      const conv = createConversation({
        platform: 'grok',
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: 'Claim.<grok:render card_id="abc"><argument name="citation_id">92</argument></grok:render> Next'
        }]
      })
      const markdown = conversationToMarkdown(conv, defaultOptions)

      expect(markdown).toContain('Claim. Next')
      expect(markdown).not.toContain('grok:render')
      expect(markdown).not.toContain('citation_id')
    })

    it('emits a separate "## Artifacts" section when exportArtifacts is true', () => {
      const conv = createConversation({
        messages: [
          { id: 'm1', role: 'user', content: 'Make a report' },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Here is the report.',
            attachments: [{ type: 'file', url: 'https://example.com/report.pdf', name: 'report.pdf' }]
          }
        ]
      })
      const markdown = conversationToMarkdown(conv, { ...defaultOptions, exportArtifacts: true })
      expect(markdown).toContain('## Artifacts')
      expect(markdown).toContain('[report.pdf](https://example.com/report.pdf)')
    })

    it('omits the "## Artifacts" section when exportArtifacts is false', () => {
      const conv = createConversation({
        messages: [
          { id: 'm1', role: 'user', content: 'Make a report' },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Here is the report.',
            attachments: [{ type: 'file', url: 'https://example.com/report.pdf', name: 'report.pdf' }]
          }
        ]
      })
      const markdown = conversationToMarkdown(conv, { ...defaultOptions, exportArtifacts: false })
      expect(markdown).not.toContain('## Artifacts')
    })

    it('keeps uploaded-file references when includeUploadedFiles is true', () => {
      const conv = createConversation({
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Here is my file',
            attachments: [{ type: 'file', url: 'https://example.com/essay.docx', name: 'essay.docx', uploaded: true }]
          }
        ]
      })
      const markdown = conversationToMarkdown(conv, { ...defaultOptions, includeUploadedFiles: true })
      expect(markdown).toContain('essay.docx')
    })

    it('strips uploaded-file references when includeUploadedFiles is false', () => {
      const conv = createConversation({
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Here is my file',
            attachments: [{ type: 'file', url: 'https://example.com/essay.docx', name: 'essay.docx', uploaded: true }]
          }
        ]
      })
      const markdown = conversationToMarkdown(conv, { ...defaultOptions, includeUploadedFiles: false })
      expect(markdown).not.toContain('essay.docx')
    })
  })

  describe('generateMarkdownFilename', () => {
    it('should generate filename from title', () => {
      const conv = createConversation({ title: 'My Test Conversation' })
      const filename = generateMarkdownFilename(conv)
      
      expect(filename).toBe('My-Test-Conversation.md')
    })

    it('should sanitize special characters', () => {
      const conv = createConversation({ title: 'Test: File (v2.0)!' })
      const filename = generateMarkdownFilename(conv)
      
      // Only filesystem-unsafe chars are removed: <>:"/\|?* 
      expect(filename).toBe('Test-File-(v2.0)!.md')
    })

    it('should handle long titles', () => {
      const conv = createConversation({ 
        title: 'A'.repeat(300) 
      })
      const filename = generateMarkdownFilename(conv)
      
      expect(filename.length).toBeLessThanOrEqual(204) // 200 + '.md'
    })

    it('should handle empty title', () => {
      const conv = createConversation({ title: '' })
      const filename = generateMarkdownFilename(conv)
      
      expect(filename).toBe('conversation.md')
    })

    it('should handle whitespace-only titles', () => {
      const conv = createConversation({ title: '   ' })
      const filename = generateMarkdownFilename(conv)
      
      // Whitespace-only titles get sanitized to empty, fallback to 'conversation.md'
      expect(filename).toBe('conversation.md')
    })

    it('should preserve Chinese characters in title', () => {
      const conv = createConversation({ title: '父亲体检报告分析' })
      const filename = generateMarkdownFilename(conv)
      
      expect(filename).toBe('父亲体检报告分析.md')
    })
  })

  describe('Paragraph Break Preservation', () => {
    it('should preserve double newlines as paragraph breaks', () => {
      const conv = createConversation({
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
        }]
      })
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.')
    })

    it('should not merge content from different paragraphs', () => {
      const conv = createConversation({
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: 'Para one.\n\nPara two.'
        }]
      })
      const md = conversationToMarkdown(conv, defaultOptions)
      
      // Verify the two paragraphs are separated by a blank line
      expect(md).toContain('Para one.\n\nPara two.')
    })

    it('should preserve headers within message content', () => {
      const conv = createConversation({
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: '# Title\n\nBody text.\n\n## Subheading\n\nMore text.'
        }]
      })
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('# Title')
      expect(md).toContain('## Subheading')
    })

    it('should preserve inline code and bold/italic within paragraphs', () => {
      const conv = createConversation({
        messages: [{
          id: 'msg-1',
          role: 'assistant',
          content: 'This has **bold**, *italic*, and `code` inline.'
        }]
      })
      const md = conversationToMarkdown(conv, defaultOptions)
      
      expect(md).toContain('**bold**')
      expect(md).toContain('*italic*')
      expect(md).toContain('`code`')
    })
  })

  describe('Artifacts section (exportArtifacts) regression coverage', () => {
    it('emits the "## Artifacts" section from conversation.artifacts (real store, item B)', () => {
      const conv = createConversation({
        artifacts: [
          { type: 'code', title: 'My Script', content: 'print(1)', language: 'python' },
          { type: 'html', title: 'Page', content: '<html></html>', url: 'https://example.com/artifact.html' }
        ]
      })
      const md = conversationToMarkdown(conv, { ...defaultOptions, exportArtifacts: true })
      expect(md).toContain('## Artifacts')
      // The code artifact has no url -> not listed as a reference; the html one does.
      expect(md).toContain('[Page](https://example.com/artifact.html)')
    })

    it('includes inline artifact metadata and content after tool blocks are hidden', () => {
      const conv = createConversation({
        artifacts: [{
          type: 'html',
          title: 'Core dashboard',
          content: '<html><body>dashboard</body></html>',
          language: 'html',
          mimeType: 'text/html'
        }]
      })
      const md = conversationToMarkdown(conv, { ...defaultOptions, exportArtifacts: true })

      expect(md).toContain('### Core dashboard')
      expect(md).toContain('- **Type:** html')
      expect(md).toContain('- **Language:** html')
      expect(md).toContain('- **MIME type:** text/html')
      expect(md).toContain('```html\n<html><body>dashboard</body></html>\n```')
    })

    it('does NOT emit the section when exportArtifacts is off', () => {
      const conv = createConversation({
        artifacts: [{ type: 'html', title: 'Page', content: '<html></html>', url: 'https://example.com/a.html' }]
      })
      const md = conversationToMarkdown(conv, { ...defaultOptions, exportArtifacts: false })
      expect(md).not.toContain('## Artifacts')
    })

    it('escapes crafted artifact titles so markdown injection cannot occur', () => {
      const conv = createConversation({
        artifacts: [{ type: 'html', title: '[click me](javascript:alert(1))', content: 'x', url: 'https://safe.example/doc' }]
      })
      const md = conversationToMarkdown(conv, { ...defaultOptions, exportArtifacts: true })
      const section = md.slice(md.indexOf('## Artifacts'))
      // The injected title must be escaped so it cannot form a second link.
      expect(section).toContain('\\]')          // escaped ']' so [..](..) can't close
      expect(section).toContain('\\(')          // escaped '('
      // The link target must be the safe https url, and no javascript: scheme
      // can ever reach a markdown link target (sanitizeUrl rejects non-http(s)).
      expect(section).toMatch(/\]\(https:\/\/safe\.example\/doc\)/)
      expect(section).not.toMatch(/\]\(javascript:/)
    })

    it('rejects non-http(s) artifact urls', () => {
      const conv = createConversation({
        artifacts: [{ type: 'html', title: 'Bad', content: 'x', url: 'javascript:evil()' }]
      })
      const md = conversationToMarkdown(conv, { ...defaultOptions, exportArtifacts: true })
      const section = md.slice(md.indexOf('## Artifacts'))
      expect(section).not.toContain('javascript:evil()')
    })

    it('does NOT list user-uploaded document files when includeUploadedFiles is off', () => {
      const conv = createConversation({
        artifacts: [
          // AI-generated artifact (has content) — always listed when it has a url
          { type: 'html', title: 'Page', content: '<html></html>', url: 'https://safe.example/a.html' },
          // User upload (document, no content) — must respect includeUploadedFiles
          { type: 'document', title: 'my-upload.pdf', content: '', url: 'https://files.example/my-upload.pdf' }
        ]
      })
      const md = conversationToMarkdown(conv, { ...defaultOptions, exportArtifacts: true, includeUploadedFiles: false })
      const section = md.slice(md.indexOf('## Artifacts'))
      expect(section).toContain('https://safe.example/a.html')        // AI artifact kept
      expect(section).not.toContain('my-upload.pdf')                   // upload dropped
    })
  })

  describe('includeUploadedFiles toggle regression coverage', () => {
    const convWithUpload = createConversation({
      messages: [
        {
          id: 'm1', role: 'user', content: 'here is a screenshot and a file',
          attachments: [
            { type: 'image', url: 'https://img.example/shot.png', name: 'shot', uploaded: true },
            { type: 'file', url: 'https://files.example/doc.pdf', name: 'doc.pdf', uploaded: true }
          ]
        }
      ]
    })

    it('when OFF, keeps genuine images but drops uploaded-file references', () => {
      const md = conversationToMarkdown(convWithUpload, { ...defaultOptions, includeUploadedFiles: false })
      expect(md).toContain('![shot](https://img.example/shot.png)') // image kept
      expect(md).not.toContain('doc.pdf') // uploaded file removed
    })

    it('when ON, keeps both images and uploaded files', () => {
      const md = conversationToMarkdown(convWithUpload, { ...defaultOptions, includeUploadedFiles: true })
      expect(md).toContain('![shot](https://img.example/shot.png)')
      expect(md).toContain('doc.pdf')
    })

    it('uses the same uploaded-file rule in the message and Artifacts sections', () => {
      const off = conversationToMarkdown(convWithUpload, {
        ...defaultOptions,
        exportArtifacts: true,
        includeUploadedFiles: false
      })
      const on = conversationToMarkdown(convWithUpload, {
        ...defaultOptions,
        exportArtifacts: true,
        includeUploadedFiles: true
      })

      expect(off).not.toContain('doc.pdf')
      expect(off).not.toContain('## Artifacts')
      expect(on).toContain('doc.pdf')
      expect(on).toContain('## Artifacts')
      expect(on).toContain('[doc.pdf](https://files.example/doc.pdf)')
    })
  })
})
