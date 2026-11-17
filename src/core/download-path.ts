import type { Conversation, DownloadFolderOption } from './types'
import { truncateToUtf8Bytes } from './filename'

type Platform = Conversation['platform']

export function sanitizeDownloadFolderName(folderName: string): string {
  const sanitized = folderName
    // eslint-disable-next-line no-control-regex -- strips control characters (filesystem-unsafe) on purpose
    .replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_')
    // Bidi overrides and zero-width characters can disguise a folder name.
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/^-|-$/g, '')
    .trim()
  // Truncate on a character boundary and by bytes, not UTF-16 units: 100 CJK
  // characters are 300 bytes, over the 255-byte limit of one path component.
  return truncateToUtf8Bytes(sanitized, 200).trim() || 'AI Chat Exports'
}

export function buildDownloadFilename(
  baseFilename: string,
  platform: Platform,
  extension: string,
  downloadFolder: DownloadFolderOption,
  customFolderName: string
): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  const filename = baseFilename.endsWith(ext) ? baseFilename : `${baseFilename}${ext}`

  switch (downloadFolder) {
    case 'by-platform': {
      const folderMap: Record<Platform, string> = {
        chatgpt: 'ChatGPT',
        gemini: 'Gemini',
        claude: 'Claude',
        deepseek: 'DeepSeek',
        grok: 'Grok'
      }
      // An unrecognized platform value still becomes a path segment, so it
      // must go through the same sanitization as a custom folder name.
      const folder =
        folderMap[platform] ||
        (platform ? sanitizeDownloadFolderName(String(platform)) : 'AI Chat Exports')
      return `${folder}/${filename}`
    }
    case 'custom':
      return `${sanitizeDownloadFolderName(customFolderName)}/${filename}`
    default:
      return filename
  }
}
