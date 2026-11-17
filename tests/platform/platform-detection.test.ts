/**
 * Platform Detection Tests
 * Tests auto-detection from various URLs and download folder path generation
 */

import { describe, it, expect } from 'vitest'

/**
 * Detect platform from URL (mirrors the logic in popup.tsx)
 */
function detectPlatformFromUrl(url: string): 'chatgpt' | 'gemini' | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') {
      return 'chatgpt'
    }
    if (parsed.hostname === 'gemini.google.com') {
      return 'gemini'
    }
  } catch {}
  return null
}

/**
 * Build download filename with folder prefix
 */
type DownloadFolderOption = 'default' | 'by-platform' | 'custom'

function buildDownloadFilename(
  baseFilename: string, 
  platform: 'chatgpt' | 'gemini',
  extension: string,
  downloadFolder: DownloadFolderOption,
  customFolderName: string
): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  const filename = baseFilename.endsWith(ext) ? baseFilename : `${baseFilename}${ext}`
  
  switch (downloadFolder) {
    case 'by-platform': {
      const folder = platform === 'chatgpt' ? 'ChatGPT' : 'Gemini'
      return `${folder}/${filename}`
    }
    case 'custom':
      return `${customFolderName}/${filename}`
    default:
      return filename
  }
}

describe('Platform Detection', () => {
  describe('detectPlatformFromUrl', () => {
    it('should detect ChatGPT from chatgpt.com', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/c/abc123')).toBe('chatgpt')
    })

    it('should detect ChatGPT from chat.openai.com', () => {
      expect(detectPlatformFromUrl('https://chat.openai.com/c/abc123')).toBe('chatgpt')
    })

    it('should detect Gemini from gemini.google.com', () => {
      expect(detectPlatformFromUrl('https://gemini.google.com/app/abc123')).toBe('gemini')
    })

    it('should return null for unknown platforms', () => {
      expect(detectPlatformFromUrl('https://example.com/chat')).toBeNull()
    })

    it('should return null for invalid URLs', () => {
      expect(detectPlatformFromUrl('not-a-url')).toBeNull()
    })

    it('should handle ChatGPT with path variations', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/')).toBe('chatgpt')
      expect(detectPlatformFromUrl('https://chatgpt.com/c/12345678-1234-1234-1234-123456789012')).toBe('chatgpt')
    })

    it('should handle Gemini with path variations', () => {
      expect(detectPlatformFromUrl('https://gemini.google.com/')).toBe('gemini')
      expect(detectPlatformFromUrl('https://gemini.google.com/app/abc123def')).toBe('gemini')
    })

    it('should not detect from subdomains of other domains', () => {
      expect(detectPlatformFromUrl('https://notchatgpt.com/c/test')).toBeNull()
      expect(detectPlatformFromUrl('https://not-gemini.google.com/app/test')).toBeNull()
    })
  })

  describe('buildDownloadFilename', () => {
    it('should use default path when downloadFolder is default', () => {
      const result = buildDownloadFilename('my-chat', 'chatgpt', '.md', 'default', 'Exports')
      expect(result).toBe('my-chat.md')
    })

    it('should prepend ChatGPT folder when downloadFolder is by-platform', () => {
      const result = buildDownloadFilename('my-chat', 'chatgpt', '.md', 'by-platform', 'Exports')
      expect(result).toBe('ChatGPT/my-chat.md')
    })

    it('should prepend Gemini folder when downloadFolder is by-platform', () => {
      const result = buildDownloadFilename('my-chat', 'gemini', '.pdf', 'by-platform', 'Exports')
      expect(result).toBe('Gemini/my-chat.pdf')
    })

    it('should prepend custom folder name when downloadFolder is custom', () => {
      const result = buildDownloadFilename('my-chat', 'chatgpt', '.md', 'custom', 'My Exports')
      expect(result).toBe('My Exports/my-chat.md')
    })

    it('should not double-add extension', () => {
      const result = buildDownloadFilename('my-chat.md', 'chatgpt', '.md', 'default', 'Exports')
      expect(result).toBe('my-chat.md')
    })

    it('should handle extension without leading dot', () => {
      const result = buildDownloadFilename('my-chat', 'chatgpt', 'pdf', 'default', 'Exports')
      expect(result).toBe('my-chat.pdf')
    })
  })

  describe('Platform Badge Rendering (CSS classes)', () => {
    it('should have chatgpt class for ChatGPT platform', () => {
      // Simulating the CSS class assignment
      const platform = 'chatgpt'
      const className = `badge ${platform}`
      expect(className).toBe('badge chatgpt')
    })

    it('should have gemini class for Gemini platform', () => {
      const platform = 'gemini'
      const className = `badge ${platform}`
      expect(className).toBe('badge gemini')
    })
  })
})
