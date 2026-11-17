// @vitest-environment jsdom
/**
 * Exported documents take an explicit locale. The interactive export flow must
 * load that locale's catalogue first, and must still export (in English) when
 * the catalogue cannot be loaded.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { zhCN } from '../../src/core/i18n/locales/zh-CN'
import type { Conversation, ExportOptions } from '../../src/core/types'

const conversation: Conversation = {
  id: 'locale-1',
  title: 'Synthetic chat',
  platform: 'chatgpt',
  url: 'https://chatgpt.com/c/locale-1',
  source: 'api',
  sourceCompleteness: 'verified',
  messages: [
    { id: 'u', role: 'user', content: 'Question' },
    { id: 'a', role: 'assistant', content: 'Answer' }
  ]
} as unknown as Conversation

const options = (locale: ExportOptions['locale']): ExportOptions => ({
  format: 'markdown',
  includeMetadata: true,
  includeCodeBlocks: true,
  includeImages: true,
  locale
})

let blobs: Blob[]

beforeEach(() => {
  vi.resetModules()
  blobs = []
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: vi.fn(async () => ({ data: {} })), getManifest: () => ({}) },
    downloads: { search: vi.fn(async () => []) }
  })
  URL.createObjectURL = (blob: Blob) => {
    blobs.push(blob)
    return 'blob:synthetic'
  }
  URL.revokeObjectURL = vi.fn()
  vi.doMock('../../src/platform/download-completion', () => ({
    downloadAndWait: vi.fn(async () => 1),
    resolveDownloadedFilename: vi.fn(async (_id: number, name: string) => name)
  }))
})

afterEach(() => {
  vi.doUnmock('../../src/platform/download-completion')
  vi.unstubAllGlobals()
})

const textOf = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader()
    reader.onload = () => done(String(reader.result))
    reader.onerror = () => fail(reader.error)
    reader.readAsText(blob)
  })

it('loads the requested locale before building the exported Markdown', async () => {
  const { setLocaleSource, isLocaleLoaded } = await import('../../src/core/i18n')
  const source = vi.fn(async (locale: string) =>
    JSON.parse(
      readFileSync(resolve(__dirname, '../../src/core/i18n/generated', `${locale}.catalog`), 'utf8')
    )
  )
  setLocaleSource(source)
  const { exportConversationFile } = await import('../../src/platform/export-download')

  expect(isLocaleLoaded('zh-CN')).toBe(false)
  await exportConversationFile(conversation, options('zh-CN'), { filenamePattern: '{title}' })

  expect(source).toHaveBeenCalledWith('zh-CN')
  const markdown = await textOf(blobs[0])
  expect(markdown).toContain(`**${zhCN['Visible messages']}:**`)
})

it('exports in English when the requested locale cannot be loaded', async () => {
  const { setLocaleSource } = await import('../../src/core/i18n')
  setLocaleSource(async () => {
    throw new Error('chunk missing')
  })
  const { exportConversationFile } = await import('../../src/platform/export-download')

  await exportConversationFile(conversation, options('zh-CN'), { filenamePattern: '{title}' })

  const markdown = await textOf(blobs[0])
  expect(markdown).toContain('**Visible messages:**')
})
