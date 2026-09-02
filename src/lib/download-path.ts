import type { Conversation, DownloadFolderOption } from './types'

type Platform = Conversation['platform']

export function sanitizeDownloadFolderName(folderName: string): string {
  return folderName
    .replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/^-|-$/g, '')
    .trim()
    .substring(0, 100) || 'AI Chat Exports'
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
      const folder = folderMap[platform]
        || (platform ? sanitizeDownloadFolderName(String(platform)) : 'AI Chat Exports')
      return `${folder}/${filename}`
    }
    case 'custom':
      return `${sanitizeDownloadFolderName(customFolderName)}/${filename}`
    default:
      return filename
  }
}
