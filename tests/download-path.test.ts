import { describe, expect, it } from 'vitest'
import { buildDownloadFilename, sanitizeDownloadFolderName } from '../src/lib/download-path'

describe('download path generation', () => {
  it('keeps requested filename at root by default', () => {
    expect(buildDownloadFilename('父亲体检报告分析与病情评估', 'claude', '.md', 'default', 'Ignored'))
      .toBe('父亲体检报告分析与病情评估.md')
  })

  it('does not double-add extensions', () => {
    expect(buildDownloadFilename('report.md', 'chatgpt', '.md', 'default', 'Ignored')).toBe('report.md')
    expect(buildDownloadFilename('report.pdf', 'chatgpt', '.pdf', 'default', 'Ignored')).toBe('report.pdf')
  })

  it('routes platform folder downloads for every platform', () => {
    expect(buildDownloadFilename('one', 'chatgpt', '.md', 'by-platform', 'Ignored')).toBe('ChatGPT/one.md')
    expect(buildDownloadFilename('one', 'gemini', '.md', 'by-platform', 'Ignored')).toBe('Gemini/one.md')
    expect(buildDownloadFilename('one', 'claude', '.md', 'by-platform', 'Ignored')).toBe('Claude/one.md')
    expect(buildDownloadFilename('one', 'deepseek', '.md', 'by-platform', 'Ignored')).toBe('DeepSeek/one.md')
    expect(buildDownloadFilename('one', 'grok', '.md', 'by-platform', 'Ignored')).toBe('Grok/one.md')
    expect(buildDownloadFilename('one', 'custom' as never, '.md', 'by-platform', 'Ignored')).toBe('custom/one.md')
  })

  it('preserves unicode custom folder names', () => {
    expect(buildDownloadFilename('report', 'claude', '.md', 'custom', '我的导出'))
      .toBe('我的导出/report.md')
  })

  it('sanitizes unsafe folder characters and prevents path traversal', () => {
    expect(sanitizeDownloadFolderName('../Bad/Folder:Name*?')).toBe('_Bad_Folder_Name_')
    expect(buildDownloadFilename('report', 'claude', '.md', 'custom', '../Bad/Folder:Name*?'))
      .toBe('_Bad_Folder_Name_/report.md')
  })

  it('falls back when folder name becomes empty', () => {
    expect(buildDownloadFilename('report', 'claude', '.md', 'custom', '...'))
      .toBe('AI Chat Exports/report.md')
  })
})
