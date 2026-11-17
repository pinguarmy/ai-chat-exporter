/**
 * DOM Utilities Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  generateId,
  extractTextContent,
  extractTextWithBreaks,
  extractTextWithMedia,
  extractCodeBlocks,
  extractImages,
  cleanText,
  stripProviderArtifacts,
  escapeHtml
} from '../../src/core/dom-utils'

describe('DOM Utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId()
      const id2 = generateId()
      
      expect(id1).not.toBe(id2)
    })

    it('should start with msg- prefix', () => {
      const id = generateId()
      
      expect(id).toMatch(/^msg-/)
    })

    it('should generate IDs of reasonable length', () => {
      const id = generateId()
      
      expect(id.length).toBeGreaterThan(10)
      expect(id.length).toBeLessThan(50)
    })

    it('should generate IDs with alphanumeric characters', () => {
      const id = generateId()
      
      expect(id).toMatch(/^msg-\d+-[a-z0-9]+$/)
    })

    it('should generate multiple unique IDs', () => {
      const ids = Array.from({ length: 100 }, () => generateId())
      const uniqueIds = new Set(ids)
      
      expect(uniqueIds.size).toBe(100)
    })
  })

  describe('extractTextContent', () => {
    it('should extract text from element', () => {
      document.body.innerHTML = '<div>Hello World</div>'
      const element = document.querySelector('div')
      
      expect(extractTextContent(element)).toBe('Hello World')
    })

    it('should return empty string for null element', () => {
      expect(extractTextContent(null)).toBe('')
    })

    it('should clean up whitespace', () => {
      document.body.innerHTML = '<div>  Hello   World  </div>'
      const element = document.querySelector('div')
      
      expect(extractTextContent(element)).toBe('Hello World')
    })

    it('should handle nested elements', () => {
      document.body.innerHTML = '<div><span>Hello</span> <span>World</span></div>'
      const element = document.querySelector('div')
      
      expect(extractTextContent(element)).toBe('Hello World')
    })

    it('should handle empty elements', () => {
      document.body.innerHTML = '<div></div>'
      const element = document.querySelector('div')
      
      expect(extractTextContent(element)).toBe('')
    })
  })

  describe('extractTextWithBreaks', () => {
    it('should preserve line breaks', () => {
      document.body.innerHTML = '<div><p>Line 1</p><p>Line 2</p></div>'
      const element = document.querySelector('div')
      
      const text = extractTextWithBreaks(element)
      expect(text).toContain('Line 1')
      expect(text).toContain('Line 2')
    })

    it('should return empty string for null element', () => {
      expect(extractTextWithBreaks(null)).toBe('')
    })

    it('should handle inline elements', () => {
      document.body.innerHTML = '<div>Hello <strong>World</strong></div>'
      const element = document.querySelector('div')
      
      expect(extractTextWithBreaks(element)).toBe('Hello World')
    })

    it('should handle lists', () => {
      document.body.innerHTML = '<div><ul><li>Item 1</li><li>Item 2</li></ul></div>'
      const element = document.querySelector('div')
      
      const text = extractTextWithBreaks(element)
      expect(text).toContain('Item 1')
      expect(text).toContain('Item 2')
    })

    it('should collapse multiple newlines', () => {
      document.body.innerHTML = '<div><p>A</p><p></p><p></p><p>B</p></div>'
      const element = document.querySelector('div')
      
      const text = extractTextWithBreaks(element)
      expect(text).toContain('A')
      expect(text).toContain('B')
    })
  })

  describe('extractTextWithMedia', () => {
    it('keeps an image between the surrounding transcript blocks', () => {
      document.body.innerHTML = `
        <div id="answer">
          <p>Before the place card.</p>
          <img data-original="https://images.example/store-full.png" src="placeholder.png" alt="Storefront" />
          <p>After the place card.</p>
        </div>
      `

      const text = extractTextWithMedia(document.querySelector('#answer'))

      expect(text).toContain('![Storefront](https://images.example/store-full.png)')
      expect(text.indexOf('Before the place card.')).toBeLessThan(text.indexOf('![Storefront]'))
      expect(text.indexOf('![Storefront]')).toBeLessThan(text.indexOf('After the place card.'))
    })
  })

  describe('extractCodeBlocks', () => {
    it('should extract code blocks from pre elements', () => {
      document.body.innerHTML = '<pre><code>const x = 1;</code></pre>'
      const container = document.body
      
      const blocks = extractCodeBlocks(container)
      
      expect(blocks.length).toBe(1)
      expect(blocks[0].code).toBe('const x = 1;')
    })

    it('should detect language from class', () => {
      document.body.innerHTML = '<pre><code class="language-python">print("hello")</code></pre>'
      const container = document.body
      
      const blocks = extractCodeBlocks(container)
      
      expect(blocks[0].language).toBe('python')
    })

    it('should handle multiple code blocks', () => {
      document.body.innerHTML = `
        <pre><code>Block 1</code></pre>
        <pre><code>Block 2</code></pre>
      `
      const container = document.body
      
      const blocks = extractCodeBlocks(container)
      
      expect(blocks.length).toBe(2)
    })

    it('should skip empty code blocks', () => {
      document.body.innerHTML = '<pre><code>   </code></pre>'
      const container = document.body
      
      const blocks = extractCodeBlocks(container)
      
      expect(blocks.length).toBe(0)
    })

    it('should handle code without language', () => {
      document.body.innerHTML = '<pre><code>echo "hello"</code></pre>'
      const container = document.body
      
      const blocks = extractCodeBlocks(container)
      
      expect(blocks[0].language).toBeUndefined()
    })
  })

  describe('extractImages', () => {
    it('should extract images', () => {
      document.body.innerHTML = '<img src="https://example.com/image.png" alt="Test">'
      const container = document.body
      
      const images = extractImages(container)
      
      expect(images.length).toBe(1)
      expect(images[0].url).toBe('https://example.com/image.png')
      expect(images[0].alt).toBe('Test')
    })

    it('should handle relative URLs', () => {
      document.body.innerHTML = '<img src="/images/photo.jpg" alt="Photo">'
      const container = document.body
      
      const images = extractImages(container)
      
      expect(images.length).toBe(1)
      expect(images[0].url).toContain('/images/photo.jpg')
    })

    it('should skip images without src', () => {
      document.body.innerHTML = '<img alt="No source">'
      const container = document.body
      
      const images = extractImages(container)
      
      expect(images.length).toBe(0)
    })

    it('should handle multiple images', () => {
      document.body.innerHTML = `
        <img src="img1.png" alt="Image 1">
        <img src="img2.png" alt="Image 2">
      `
      const container = document.body
      
      const images = extractImages(container)
      
      expect(images.length).toBe(2)
    })

    it('should handle images with data-src', () => {
      document.body.innerHTML = '<img data-src="lazy.png" alt="Lazy loaded">'
      const container = document.body
      
      const images = extractImages(container)
      
      expect(images.length).toBe(1)
      expect(images[0].url).toContain('lazy.png')
    })

    it('prefers a full-resolution lazy source over a transparent placeholder', () => {
      document.body.innerHTML = '<img src="placeholder.png" data-original="https://images.example/full.png" alt="Full image">'

      expect(extractImages(document.body)).toEqual([
        { url: 'https://images.example/full.png', alt: 'Full image' }
      ])
    })

    it('uses the largest srcset candidate when that is the only real source', () => {
      document.body.innerHTML = '<img src="transparent.gif" srcset="https://images.example/preview.png 1x, https://images.example/full.png 2x">'

      expect(extractImages(document.body)).toEqual([
        { url: 'https://images.example/full.png', alt: '' }
      ])
    })
  })

  describe('cleanText', () => {
    it('should normalize whitespace', () => {
      expect(cleanText('  Hello   World  ')).toBe('Hello World')
    })

    it('should handle multiple newlines', () => {
      expect(cleanText('A\n\n\n\nB')).toBe('A\n\nB')
    })

    it('should convert Windows line endings', () => {
      expect(cleanText('A\r\nB')).toBe('A\nB')
    })

    it('should convert old Mac line endings', () => {
      expect(cleanText('A\rB')).toBe('A\nB')
    })

    it('should handle non-breaking spaces', () => {
      expect(cleanText('Hello\u00A0World')).toBe('Hello World')
    })

    it('removes ChatGPT private citation markers', () => {
      expect(cleanText('Claim\uE200cite\uE202turn400395view0\uE201 continues')).toBe('Claim continues')
    })

    it('removes Grok citation-card markup', () => {
      expect(cleanText('Claim.<grok:render card_id="abc"><argument name="citation_id">92</argument></grok:render> Next')).toBe('Claim. Next')
    })

    it('should trim leading and trailing whitespace', () => {
      expect(cleanText('  Hello  ')).toBe('Hello')
    })
  })

  describe('stripProviderArtifacts', () => {
    it('removes Grok markup without changing Markdown whitespace', () => {
      expect(stripProviderArtifacts('A\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')).toBe('A\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')
    })

    it('removes ChatGPT internal image handles without removing nearby prose', () => {
      expect(stripProviderArtifacts('Before iturn447234image0 after')).toBe('Before  after')
      expect(cleanText('Before iturn447234image0 after')).toBe('Before after')
    })
  })

  describe('escapeHtml', () => {
    it('should escape ampersands', () => {
      expect(escapeHtml('A & B')).toBe('A &amp; B')
    })

    it('should escape angle brackets', () => {
      expect(escapeHtml('<div>')).toBe('&lt;div&gt;')
    })

    it('should escape quotes', () => {
      expect(escapeHtml('"Hello"')).toBe('&quot;Hello&quot;')
    })

    it('should escape single quotes', () => {
      expect(escapeHtml("It's")).toBe('It&#039;s')
    })

    it('should handle multiple special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      )
    })

    it('should return unchanged text without special characters', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World')
    })
  })
})
