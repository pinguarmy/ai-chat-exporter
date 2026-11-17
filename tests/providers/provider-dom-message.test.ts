import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildDomMessageExtras,
  collectAuthorRoleMessages,
  collectClassCandidateMessages,
  extractCleanMessageText,
  parseAuthorRoleElement
} from '../../src/providers/dom-message'
import { detectRoleFromClassName, detectRoleFromIndicators } from '../../src/providers/dom-roles'

const clean = (el: Element) => extractCleanMessageText(el)

describe('provider DOM message helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('extractCleanMessageText', () => {
    it('removes provider UI chrome from a clone without touching the live page', () => {
      document.body.innerHTML =
        '<div id="m">Answer<button>Copy</button><div class="toolbar-x">tools</div><span class="regenerate">again</span></div>'
      const el = document.getElementById('m')!
      expect(extractCleanMessageText(el)).toBe('Answer')
      expect(el.querySelector('button')).not.toBeNull()
    })

    it('accepts provider-specific removal selectors', () => {
      document.body.innerHTML =
        '<div id="m">Keep<i class="crumb">drop</i><button>Stay</button></div>'
      expect(extractCleanMessageText(document.getElementById('m')!, ['.crumb'])).toContain('Stay')
      expect(extractCleanMessageText(document.getElementById('m')!, ['.crumb'])).not.toContain(
        'drop'
      )
    })

    it('keeps images as Markdown at their position', () => {
      document.body.innerHTML =
        '<div id="m">Before<img src="https://example.com/a.png" alt="pic">After</div>'
      const text = extractCleanMessageText(document.getElementById('m')!)
      expect(text.indexOf('Before')).toBeLessThan(text.indexOf('![pic]'))
      expect(text.indexOf('![pic]')).toBeLessThan(text.indexOf('After'))
    })
  })

  describe('buildDomMessageExtras', () => {
    it('omits empty attachment and code block lists', () => {
      document.body.innerHTML = '<div id="m">plain</div>'
      const extras = buildDomMessageExtras(document.getElementById('m')!, 'user')
      expect(extras.attachments).toBeUndefined()
      expect(extras.codeBlocks).toBeUndefined()
    })

    it('marks images as uploaded only for user turns and extracts code blocks', () => {
      document.body.innerHTML =
        '<div id="m"><img src="https://example.com/a.png" alt="pic"><pre><code class="language-ts">const a = 1</code></pre></div>'
      const el = document.getElementById('m')!
      expect(buildDomMessageExtras(el, 'user').attachments).toEqual([
        { type: 'image', url: 'https://example.com/a.png', name: 'pic', uploaded: true }
      ])
      expect(buildDomMessageExtras(el, 'assistant').attachments?.[0].uploaded).toBe(false)
      expect(buildDomMessageExtras(el, 'assistant').codeBlocks?.[0].code).toContain('const a = 1')
    })
  })

  describe('parseAuthorRoleElement', () => {
    const options = { extractContent: clean }

    it('parses user and assistant turns and prefers the markdown child', () => {
      document.body.innerHTML =
        '<div id="a" data-message-author-role="assistant" data-message-id="m1">menu<div class="markdown">Answer</div></div>'
      expect(parseAuthorRoleElement(document.getElementById('a')!, options)).toMatchObject({
        id: 'm1',
        role: 'assistant',
        content: 'Answer'
      })
    })

    it('skips system/tool roles, missing roles and empty turns', () => {
      document.body.innerHTML =
        '<div id="s" data-message-author-role="system">x</div>' +
        '<div id="t" data-message-author-role="tool">x</div>' +
        '<div id="n">x</div>' +
        '<div id="e" data-message-author-role="user">   </div>'
      for (const id of ['s', 't', 'n', 'e']) {
        expect(parseAuthorRoleElement(document.getElementById(id)!, options)).toBeNull()
      }
    })

    it('only sets timestamp when a timestamp reader is supplied', () => {
      document.body.innerHTML = '<div id="u" data-message-author-role="user">hi</div>'
      const el = document.getElementById('u')!
      expect('timestamp' in parseAuthorRoleElement(el, options)!).toBe(false)
      expect(parseAuthorRoleElement(el, { ...options, getTimestamp: () => 123 })?.timestamp).toBe(
        123
      )
      expect(
        'timestamp' in parseAuthorRoleElement(el, { ...options, getTimestamp: () => undefined })!
      ).toBe(true)
    })

    it('generates an id when the element has none', () => {
      document.body.innerHTML = '<div id="u" data-message-author-role="user">hi</div>'
      expect(parseAuthorRoleElement(document.getElementById('u')!, options)?.id).toBeTruthy()
    })
  })

  describe('collectAuthorRoleMessages', () => {
    it('returns null when the page has no author-role markup so a fallback can run', () => {
      document.body.innerHTML = '<div class="message-user">x</div>'
      expect(collectAuthorRoleMessages(document, () => null)).toBeNull()
    })

    it('returns an empty list (no fallback) when markup exists but nothing parses', () => {
      document.body.innerHTML = '<div data-message-author-role="system">x</div>'
      expect(collectAuthorRoleMessages(document, () => null)).toEqual([])
    })

    it('preserves interleaved document order', () => {
      document.body.innerHTML =
        '<div data-message-author-role="user">1</div><div data-message-author-role="assistant">2</div>' +
        '<div data-message-author-role="user">3</div><div data-message-author-role="assistant">4</div>'
      const messages = collectAuthorRoleMessages(document, el =>
        parseAuthorRoleElement(el, { extractContent: clean })
      )
      expect(messages?.map(m => `${m.role}:${m.content}`)).toEqual([
        'user:1',
        'assistant:2',
        'user:3',
        'assistant:4'
      ])
    })
  })

  describe('collectClassCandidateMessages', () => {
    const resolveRole = (el: Element) => detectRoleFromClassName(el, ['assistant'])

    it('keeps user and assistant turns interleaved from one query', () => {
      document.body.innerHTML =
        '<div class="message-user">q1</div><div class="message-assistant">a1</div>' +
        '<div class="message-user">q2</div><div class="message-assistant">a2</div>'
      const messages = collectClassCandidateMessages(document, {
        selector: '[class*="message-user"], [class*="message-assistant"]',
        resolveRole,
        extractContent: clean
      })
      expect(messages.map(m => `${m.role}:${m.content}`)).toEqual([
        'user:q1',
        'assistant:a1',
        'user:q2',
        'assistant:a2'
      ])
    })

    it('skips a generic wrapper that contains a more specific role-bearing child', () => {
      document.body.innerHTML =
        '<div class="turn"><div class="message-user">q</div><div class="message-assistant">a</div></div>'
      const messages = collectClassCandidateMessages(document, {
        selector: '[class*="message-user"], [class*="message-assistant"], [class*="turn"]',
        resolveRole,
        extractContent: clean
      })
      expect(messages.map(m => m.content)).toEqual(['q', 'a'])
    })

    it('skips candidates without a role or without text', () => {
      document.body.innerHTML =
        '<div class="message">no role</div><div class="message-user">   </div>'
      expect(
        collectClassCandidateMessages(document, {
          selector: '[class*="message"]',
          resolveRole,
          extractContent: clean
        })
      ).toEqual([])
    })

    it('records visited elements in a caller-supplied set so a later fallback can skip them', () => {
      document.body.innerHTML = '<div class="message">no role</div>'
      const seen = new Set<Element>()
      collectClassCandidateMessages(document, {
        selector: '[class*="message"]',
        resolveRole,
        extractContent: clean,
        seen
      })
      expect(seen.has(document.querySelector('.message')!)).toBe(true)
    })

    it('uses data-message-id when present', () => {
      document.body.innerHTML = '<div class="message-user" data-message-id="keep">q</div>'
      expect(
        collectClassCandidateMessages(document, {
          selector: '[class*="message-user"]',
          resolveRole,
          extractContent: clean
        })[0].id
      ).toBe('keep')
    })
  })

  describe('detectRoleFromClassName', () => {
    it('lets user win over assistant terms and ignores unrelated classes', () => {
      const el = document.createElement('div')
      el.className = 'user assistant'
      expect(detectRoleFromClassName(el, ['assistant'])).toBe('user')
      el.className = 'bot-bubble'
      expect(detectRoleFromClassName(el, ['assistant', 'bot'])).toBe('assistant')
      el.className = 'bubble'
      expect(detectRoleFromClassName(el, ['assistant', 'bot'])).toBeNull()
    })

    it('returns null for non-string class names (SVG elements)', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('class', 'user')
      expect(detectRoleFromClassName(svg, ['assistant'])).toBeNull()
    })
  })

  describe('detectRoleFromIndicators', () => {
    const base = {
      assistantIndicatorSelector: '[class*="assistant"], [data-role="assistant"], [class*="bot"]',
      assistantAriaTerms: ['assistant', 'ai']
    }
    const el = (html: string, attrs: Record<string, string> = {}) => {
      const node = document.createElement('div')
      node.innerHTML = html
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v))
      return node
    }

    it('prefers a user indicator over an assistant indicator', () => {
      expect(
        detectRoleFromIndicators(el('<i class="bot"></i><i class="user-badge"></i>'), base)
      ).toBe('user')
      expect(detectRoleFromIndicators(el('<i data-role="assistant"></i>'), base)).toBe('assistant')
    })

    it('falls back to aria-label, case-insensitively', () => {
      expect(detectRoleFromIndicators(el('', { 'aria-label': 'You said' }), base)).toBe('user')
      expect(detectRoleFromIndicators(el('', { 'aria-label': 'AI response' }), base)).toBe(
        'assistant'
      )
      expect(detectRoleFromIndicators(el('', { 'aria-label': 'status' }), base)).toBeNull()
    })

    it('uses the provider specific assistant words (DeepSeek ai/deepseek vs Grok grok)', () => {
      const deepseek = {
        assistantIndicatorSelector: '[class*="ai"]',
        assistantAriaTerms: ['assistant', 'ai', 'deepseek']
      }
      const grok = {
        assistantIndicatorSelector: '[class*="grok"]',
        assistantAriaTerms: ['assistant', 'grok', 'ai']
      }
      expect(detectRoleFromIndicators(el('', { 'aria-label': 'DeepSeek' }), deepseek)).toBe(
        'assistant'
      )
      expect(detectRoleFromIndicators(el('', { 'aria-label': 'DeepSeek' }), grok)).toBeNull()
      expect(detectRoleFromIndicators(el('<i class="grok-logo"></i>'), grok)).toBe('assistant')
      expect(detectRoleFromIndicators(el('<i class="grok-logo"></i>'), deepseek)).toBeNull()
    })

    it('supports ChatGPT-style avatar fallbacks after the aria-label', () => {
      const options = {
        ...base,
        descendantFallbacks: {
          user: '[class*="avatar-user"]',
          assistant: '[class*="avatar-assistant"], [class*="logo"]'
        }
      }
      expect(detectRoleFromIndicators(el('<i class="avatar-user"></i>'), options)).toBe('user')
      expect(detectRoleFromIndicators(el('<i class="site-logo"></i>'), options)).toBe('assistant')
      expect(
        detectRoleFromIndicators(el('<i class="site-logo"></i>', { 'aria-label': 'user' }), options)
      ).toBe('user')
      expect(detectRoleFromIndicators(el('<i class="site-logo"></i>'), base)).toBeNull()
    })

    it('checks the element class name last when requested (Grok)', () => {
      const options = { ...base, classNameAssistantTerms: ['assistant', 'grok', 'bot'] }
      const node = el('')
      node.className = 'grok-turn'
      expect(detectRoleFromIndicators(node, options)).toBe('assistant')
      expect(detectRoleFromIndicators(node, base)).toBeNull()
    })
  })
})
