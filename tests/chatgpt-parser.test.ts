/**
 * ChatGPT Parser Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock DOM utilities
vi.mock('../src/core/dom-utils', () => ({
  generateId: () => 'test-id-123',
  extractTextContent: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithBreaks: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithMedia: (element: Element | null) => element?.textContent?.trim() || '',
  extractCodeBlocks: () => [],
  extractImages: () => [],
  cleanText: (text: string) => text.replace(/\s+/g, ' ').trim()
}))

describe('ChatGPT Parser', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = ''
  })

  describe('isConversationPage', () => {
    it('should detect conversation page with message roles', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">Hello</div>
        <div data-message-author-role="assistant">Hi there</div>
      `
      
      const hasMessages = document.querySelectorAll('[data-message-author-role]').length > 0
      expect(hasMessages).toBe(true)
    })

    it('should detect conversation page with articles', () => {
      document.body.innerHTML = `
        <article>Message 1</article>
        <article>Message 2</article>
      `
      
      const hasArticles = document.querySelectorAll('article').length > 0
      expect(hasArticles).toBe(true)
    })

    it('should return false for non-conversation pages', () => {
      document.body.innerHTML = `
        <div>Just a regular page</div>
      `
      
      const hasMessages = document.querySelectorAll('[data-message-author-role]').length > 0
      const hasArticles = document.querySelectorAll('article').length > 0
      expect(hasMessages || hasArticles).toBe(false)
    })

    it('should handle empty DOM', () => {
      document.body.innerHTML = ''
      
      const hasMessages = document.querySelectorAll('[data-message-author-role]').length > 0
      expect(hasMessages).toBe(false)
    })

    it('should handle multiple message types', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">User message</div>
        <div data-message-author-role="assistant">Assistant message</div>
        <div data-message-author-role="system">System message</div>
      `
      
      const messages = document.querySelectorAll('[data-message-author-role]')
      expect(messages.length).toBe(3)
    })
  })

  describe('Message Parsing', () => {
    it('should extract user messages', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div class="content">Hello, how are you?</div>
        </div>
      `
      
      const userMessage = document.querySelector('[data-message-author-role="user"]')
      expect(userMessage).not.toBeNull()
      expect(userMessage?.textContent).toContain('Hello, how are you?')
    })

    it('should extract assistant messages', () => {
      document.body.innerHTML = `
        <div data-message-author-role="assistant">
          <div class="markdown">I'm doing well, thank you!</div>
        </div>
      `
      
      const assistantMessage = document.querySelector('[data-message-author-role="assistant"]')
      expect(assistantMessage).not.toBeNull()
      expect(assistantMessage?.textContent).toContain("I'm doing well, thank you!")
    })

    it('should handle messages with code blocks', () => {
      document.body.innerHTML = `
        <div data-message-author-role="assistant">
          <div class="markdown">
            Here's some code:
            <pre><code>const x = 1;</code></pre>
          </div>
        </div>
      `
      
      const codeBlock = document.querySelector('pre code')
      expect(codeBlock).not.toBeNull()
      expect(codeBlock?.textContent).toBe('const x = 1;')
    })

    it('should handle messages with images', () => {
      document.body.innerHTML = `
        <div data-message-author-role="assistant">
          <div class="markdown">
            <img src="https://example.com/image.png" alt="Test image" />
          </div>
        </div>
      `
      
      const image = document.querySelector('img')
      expect(image).not.toBeNull()
      expect(image?.getAttribute('src')).toBe('https://example.com/image.png')
    })

    it('should handle empty messages', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user"></div>
      `
      
      const message = document.querySelector('[data-message-author-role="user"]')
      expect(message).not.toBeNull()
      expect(message?.textContent?.trim()).toBe('')
    })
  })

  describe('Title Extraction', () => {
    it('should extract title from h1', () => {
      document.body.innerHTML = `
        <h1>My Conversation Title</h1>
        <div>Content</div>
      `
      
      const title = document.querySelector('h1')?.textContent
      expect(title).toBe('My Conversation Title')
    })

    it('should fallback to page title', () => {
      document.title = 'My Conversation - ChatGPT'
      
      const pageTitle = document.title.replace(/[-–|]\s*ChatGPT.*$/i, '').trim()
      expect(pageTitle).toBe('My Conversation')
    })

    it('should handle missing title', () => {
      document.body.innerHTML = '<div>Just content</div>'
      
      const title = document.querySelector('h1')?.textContent
      expect(title).toBeUndefined()
    })
  })

  describe('Special Characters', () => {
    it('should handle HTML entities', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div>Test &amp; special &lt;characters&gt;</div>
        </div>
      `
      
      const content = document.querySelector('[data-message-author-role="user"]')?.textContent
      expect(content).toContain('&')
      expect(content).toContain('<')
      expect(content).toContain('>')
    })

    it('should handle unicode characters', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div>Hello 世界 🌍</div>
        </div>
      `
      
      const content = document.querySelector('[data-message-author-role="user"]')?.textContent
      expect(content).toContain('世界')
      expect(content).toContain('🌍')
    })

    it('should handle very long messages', () => {
      const longText = 'A'.repeat(10000)
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div>${longText}</div>
        </div>
      `
      
      const content = document.querySelector('[data-message-author-role="user"]')?.textContent
      expect(content?.length).toBeGreaterThanOrEqual(10000)
    })
  })
})
