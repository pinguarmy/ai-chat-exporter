import { describe, expect, it } from 'vitest'
import {
  isPrivateReferenceUrl,
  renderableMessageReferences,
  sanitizeReferenceUrl,
} from '../src/lib/message-references'

describe('message reference privacy', () => {
  it('accepts only HTTP(S) URLs and removes credentials', () => {
    expect(sanitizeReferenceUrl('javascript:alert(1)')).toBeUndefined()
    expect(sanitizeReferenceUrl('file:///tmp/private')).toBeUndefined()
    expect(sanitizeReferenceUrl('https://user:pass@example.com/doc')).toBe('https://example.com/doc')
  })

  it('classifies account-scoped connector links as private', () => {
    expect(isPrivateReferenceUrl('https://mail.google.com/mail/u/0/#all/abc')).toBe(true)
    expect(isPrivateReferenceUrl('https://tenant.sharepoint.com/sites/private/doc')).toBe(true)
    expect(isPrivateReferenceUrl('https://example.com/public')).toBe(false)
  })

  it('keeps unknown connector URLs out of safe-links exports', () => {
    expect(renderableMessageReferences([
      { type: 'unknown', title: 'Internal wiki', url: 'https://wiki.corp/page', private: true },
    ], 'safe-links')).toEqual([
      { title: 'Internal wiki' },
    ])
  })

  it('does not treat unset private as a public safe-links URL', () => {
    expect(renderableMessageReferences([
      { type: 'file', title: 'Account file', url: 'https://files.corp.example/doc' },
    ], 'safe-links')).toEqual([
      { title: 'Account file' },
    ])
  })

  it('defaults to titles and only exposes private URLs after explicit opt-in', () => {
    const references = [
      { type: 'web' as const, title: 'Public', url: 'https://example.com/public', private: false },
      { type: 'file' as const, title: 'Private', url: 'https://mail.google.com/mail/#all/abc', private: true },
    ]

    expect(renderableMessageReferences(references)).toEqual([
      { title: 'Public' },
      { title: 'Private' },
    ])
    expect(renderableMessageReferences(references, 'safe-links')).toEqual([
      { title: 'Public', url: 'https://example.com/public' },
      { title: 'Private' },
    ])
    expect(renderableMessageReferences(references, 'all-links')).toEqual([
      { title: 'Public', url: 'https://example.com/public' },
      { title: 'Private', url: 'https://mail.google.com/mail/#all/abc' },
    ])
  })
})
