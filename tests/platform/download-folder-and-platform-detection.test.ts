/**
 * Popup download-folder naming and platform detection for all five providers.
 */

import { describe, it, expect } from 'vitest'

// ─── Re-implement detectPlatformFromUrl from popup.tsx (mirrors production logic exactly) ───
function detectPlatformFromUrl(
  url: string
): 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok' | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') {
      return 'chatgpt'
    }
    if (parsed.hostname === 'gemini.google.com') {
      return 'gemini'
    }
    if (parsed.hostname === 'claude.ai') {
      return 'claude'
    }
    if (parsed.hostname === 'deepseek.com' || parsed.hostname === 'chat.deepseek.com') {
      return 'deepseek'
    }
    if (parsed.hostname === 'grok.com' || parsed.hostname === 'www.grok.com') {
      return 'grok'
    }
  } catch {
    // Not a parseable URL, so it cannot belong to a known provider.
  }
  return null
}

// ─── Re-implement buildDownloadFilename from popup.tsx ───
type DownloadFolderOption = 'default' | 'by-platform' | 'custom'

function buildDownloadFilename(
  baseFilename: string,
  platform: 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok',
  extension: string,
  downloadFolder: DownloadFolderOption,
  customFolderName: string
): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  const filename = baseFilename.endsWith(ext) ? baseFilename : `${baseFilename}${ext}`

  switch (downloadFolder) {
    case 'by-platform': {
      const folderMap: Record<string, string> = {
        chatgpt: 'ChatGPT',
        gemini: 'Gemini',
        claude: 'Claude',
        deepseek: 'DeepSeek',
        grok: 'Grok'
      }
      const folder = folderMap[platform] || platform
      return `${folder}/${filename}`
    }
    case 'custom': {
      const safeFolder =
        customFolderName
          .replace(/[\\:*?"<>|]/g, '_')
          .replace(/^\\.\./, '')
          .replace(/^-|-$/g, '')
          .substring(0, 100) || 'AI Chat Exports'
      return `${safeFolder}/${filename}`
    }
    default:
      return filename
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 4: Custom folder with special characters
// ══════════════════════════════════════════════════════════════════════════════
describe('CHECK 4: Custom folder with special characters', () => {
  it('should handle Chinese folder name "我的导出"', () => {
    const result = buildDownloadFilename('chat-export', 'claude', '.md', 'custom', '我的导出')

    expect(result).toBe('我的导出/chat-export.md')
    expect(result).toContain('我的导出')
    expect(result.endsWith('.md')).toBe(true)
  })

  it('should handle folder name with spaces "My Exports"', () => {
    const result = buildDownloadFilename('chat-export', 'chatgpt', '.md', 'custom', 'My Exports')

    expect(result).toBe('My Exports/chat-export.md')
  })

  it('should handle folder name with special chars "Exports (2026)"', () => {
    const result = buildDownloadFilename(
      'chat-export',
      'gemini',
      '.pdf',
      'custom',
      'Exports (2026)'
    )

    expect(result).toBe('Exports (2026)/chat-export.pdf')
  })

  it('should sanitize folder with backslashes', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', 'folder\\name')

    // Backslash gets replaced with underscore
    expect(result).toBe('folder_name/chat.md')
  })

  it('should sanitize folder with colons', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', 'C:\\exports')

    // Backslash and colon get replaced with underscore
    expect(result).toBe('C__exports/chat.md')
  })

  it('should sanitize folder with angle brackets', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', '<test>folder')

    expect(result).toBe('_test_folder/chat.md')
  })

  it('should sanitize folder with pipe', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', 'folder|name')

    expect(result).toBe('folder_name/chat.md')
  })

  it('should handle empty folder name with fallback', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', '')

    expect(result).toBe('AI Chat Exports/chat.md')
  })

  it('should truncate very long folder names to 100 chars', () => {
    const longFolder = 'A'.repeat(200)
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', longFolder)

    const folderPart = result.split('/')[0]
    expect(folderPart.length).toBeLessThanOrEqual(100)
  })

  it('should strip leading/trailing hyphens from folder name', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', '-my-folder-')

    expect(result).toBe('my-folder/chat.md')
  })

  it('should handle by-platform mode with all platforms', () => {
    expect(buildDownloadFilename('chat', 'chatgpt', '.md', 'by-platform', '')).toBe(
      'ChatGPT/chat.md'
    )
    expect(buildDownloadFilename('chat', 'gemini', '.md', 'by-platform', '')).toBe('Gemini/chat.md')
    expect(buildDownloadFilename('chat', 'claude', '.md', 'by-platform', '')).toBe('Claude/chat.md')
    expect(buildDownloadFilename('chat', 'deepseek', '.md', 'by-platform', '')).toBe(
      'DeepSeek/chat.md'
    )
    expect(buildDownloadFilename('chat', 'grok', '.md', 'by-platform', '')).toBe('Grok/chat.md')
  })

  it('should handle default mode (no folder prefix)', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'default', 'anything')

    expect(result).toBe('chat.md')
  })

  it('should handle extension without dot', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', 'pdf', 'default', '')

    expect(result).toBe('chat.pdf')
  })

  it('should not double-add extension', () => {
    const result = buildDownloadFilename('chat.md', 'chatgpt', '.md', 'default', '')

    expect(result).toBe('chat.md')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 5: All 5 platforms in popup detection
// ══════════════════════════════════════════════════════════════════════════════
describe('CHECK 5: All 5 platforms in popup detection', () => {
  describe('ChatGPT', () => {
    it('should detect chatgpt.com', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/c/abc123')).toBe('chatgpt')
    })

    it('should detect chat.openai.com', () => {
      expect(detectPlatformFromUrl('https://chat.openai.com/c/abc123')).toBe('chatgpt')
    })

    it('should detect chatgpt.com root', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/')).toBe('chatgpt')
    })
  })

  describe('Claude', () => {
    it('should detect claude.ai chat URL', () => {
      expect(detectPlatformFromUrl('https://claude.ai/chat/abc123')).toBe('claude')
    })

    it('should detect claude.ai root', () => {
      expect(detectPlatformFromUrl('https://claude.ai/')).toBe('claude')
    })

    it('should not detect not-claude.ai', () => {
      expect(detectPlatformFromUrl('https://not-claude.ai/chat/test')).toBeNull()
    })
  })

  describe('DeepSeek', () => {
    it('should detect chat.deepseek.com', () => {
      expect(detectPlatformFromUrl('https://chat.deepseek.com/a/chat/s/abc123')).toBe('deepseek')
    })

    it('should detect deepseek.com', () => {
      expect(detectPlatformFromUrl('https://deepseek.com/')).toBe('deepseek')
    })

    it('should not detect not-deepseek.com', () => {
      expect(detectPlatformFromUrl('https://not-deepseek.com/chat')).toBeNull()
    })
  })

  describe('Gemini', () => {
    it('should detect gemini.google.com', () => {
      expect(detectPlatformFromUrl('https://gemini.google.com/app/abc123')).toBe('gemini')
    })

    it('should detect gemini.google.com root', () => {
      expect(detectPlatformFromUrl('https://gemini.google.com/')).toBe('gemini')
    })

    it('should not detect subdomains of google.com', () => {
      expect(detectPlatformFromUrl('https://mail.google.com/')).toBeNull()
    })
  })

  describe('Grok', () => {
    it('should detect grok.com', () => {
      expect(detectPlatformFromUrl('https://grok.com/chat/abc123')).toBe('grok')
    })

    it('should detect www.grok.com', () => {
      expect(detectPlatformFromUrl('https://www.grok.com/chat/abc123')).toBe('grok')
    })

    it('should detect grok.com root', () => {
      expect(detectPlatformFromUrl('https://grok.com/')).toBe('grok')
    })

    it('should not detect not-grok.com', () => {
      expect(detectPlatformFromUrl('https://not-grok.com/chat')).toBeNull()
    })
  })

  describe('Unknown / Edge cases', () => {
    it('should return null for example.com', () => {
      expect(detectPlatformFromUrl('https://example.com')).toBeNull()
    })

    it('should return null for invalid URLs', () => {
      expect(detectPlatformFromUrl('not-a-url')).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(detectPlatformFromUrl('')).toBeNull()
    })

    it('should not detect from subdomains of target domains', () => {
      expect(detectPlatformFromUrl('https://chat.deepseek.com.evil.com/')).toBeNull()
      expect(detectPlatformFromUrl('https://grok.com.evil.com/chat')).toBeNull()
    })

    it('should handle URL with query params', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/c/abc123?foo=bar')).toBe('chatgpt')
      expect(detectPlatformFromUrl('https://claude.ai/chat/abc123?q=test')).toBe('claude')
    })

    it('should handle URL with hash', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/c/abc123#section')).toBe('chatgpt')
    })

    it('should handle HTTP (non-HTTPS) URLs', () => {
      // Note: current implementation uses new URL() which handles http:// just fine
      expect(detectPlatformFromUrl('http://chatgpt.com/c/abc123')).toBe('chatgpt')
    })
  })
})
