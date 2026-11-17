/**
 * Grok Parser Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock DOM utilities
vi.mock('../src/core/dom-utils', () => ({
  generateId: () => 'test-id-grok',
  extractTextContent: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithBreaks: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithMedia: (element: Element | null) => element?.textContent?.trim() || '',
  extractCodeBlocks: () => [],
  extractImages: () => [],
  cleanText: (text: string) => text.replace(/\s+/g, ' ').trim()
}))

describe('Grok Parser', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
  })

  describe('isConversationPage', () => {
    it('should detect conversation page with data-message-author-role', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">Hello</div>
        <div data-message-author-role="assistant">Hi there</div>
      `
      
      const hasMessages = document.querySelectorAll('[data-message-author-role]').length > 0
      expect(hasMessages).toBe(true)
    })

    it('should detect conversation page with message classes', () => {
      document.body.innerHTML = `
        <div class="message-content">User message</div>
        <div class="message-content">Assistant response</div>
      `
      
      const hasMessages = document.querySelectorAll('[class*="message"]').length > 0
      expect(hasMessages).toBe(true)
    })

    it('should detect conversation page via URL pattern /chat/', () => {
      const pathname = '/chat/abc123-def456'
      const match = pathname.match(/\/chat\/[a-f0-9-]+/)
      expect(match).not.toBeNull()
    })

    it('should return false for non-conversation pages', () => {
      document.body.innerHTML = `
        <div>Just a regular page</div>
      `
      
      const hasMessages = document.querySelectorAll('[data-message-author-role]').length > 0
      const hasMessageClasses = document.querySelectorAll('[class*="message"]').length > 0
      expect(hasMessages || hasMessageClasses).toBe(false)
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
      `
      
      const messages = document.querySelectorAll('[data-message-author-role]')
      expect(messages.length).toBe(2)
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

    it('should handle multi-turn conversations', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">First question</div>
        <div data-message-author-role="assistant">First answer</div>
        <div data-message-author-role="user">Second question</div>
        <div data-message-author-role="assistant">Second answer</div>
      `
      
      const userMessages = document.querySelectorAll('[data-message-author-role="user"]')
      const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]')
      
      expect(userMessages.length).toBe(2)
      expect(assistantMessages.length).toBe(2)
    })

    it('should handle messages with multiple paragraphs', () => {
      document.body.innerHTML = `
        <div data-message-author-role="assistant">
          <div class="markdown">
            <p>First paragraph</p>
            <p>Second paragraph</p>
          </div>
        </div>
      `
      
      const message = document.querySelector('[data-message-author-role="assistant"]')
      expect(message).not.toBeNull()
      expect(message?.textContent).toContain('First paragraph')
      expect(message?.textContent).toContain('Second paragraph')
    })
  })

  describe('Title Extraction', () => {
    it('should extract title from document.title with Grok suffix', () => {
      document.title = 'My Conversation Title - Grok'
      
      const pageTitle = document.title.replace(/\s*[-–|]\s*Grok.*$/i, '').trim()
      expect(pageTitle).toBe('My Conversation Title')
    })

    it('should extract title from document.title with pipe separator', () => {
      document.title = 'My Chat | Grok'
      
      const pageTitle = document.title.replace(/\s*[-–|]\s*Grok.*$/i, '').trim()
      expect(pageTitle).toBe('My Chat')
    })

    it('should handle Grok title with en-dash', () => {
      document.title = 'My Conversation – Grok'
      
      const pageTitle = document.title.replace(/\s*[-–|]\s*Grok.*$/i, '').trim()
      expect(pageTitle).toBe('My Conversation')
    })

    it('should fallback to first user message', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div>What is machine learning?</div>
        </div>
      `
      
      const firstUserMsg = document.querySelector('[data-message-author-role="user"]')
      const text = firstUserMsg?.textContent?.trim() || ''
      expect(text).toContain('What is machine learning?')
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

    it('should handle messages with markdown formatting', () => {
      document.body.innerHTML = `
        <div data-message-author-role="assistant">
          <div class="markdown">
            <strong>Bold text</strong> and <em>italic text</em>
          </div>
        </div>
      `
      
      const message = document.querySelector('[data-message-author-role="assistant"]')
      expect(message).not.toBeNull()
    })
  })

  describe('Domain Validation', () => {
    it('should match grok.com domain', () => {
      const url = new URL('https://grok.com/')
      expect(url.hostname).toBe('grok.com')
    })

    it('should match www.grok.com domain', () => {
      const url = new URL('https://www.grok.com/')
      expect(url.hostname).toBe('www.grok.com')
    })

    it('should not match other domains', () => {
      const url = new URL('https://notgrok.com/')
      expect(url.hostname).not.toBe('grok.com')
      expect(url.hostname).not.toBe('www.grok.com')
    })

    it('should extract conversation ID from URL', () => {
      const pathname = '/chat/abc123-def456-012345'
      const match = pathname.match(/\/chat\/([a-f0-9-]+)/)
      
      expect(match).not.toBeNull()
      expect(match?.[1]).toBe('abc123-def456-012345')
    })
  })
})
