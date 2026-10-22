import { afterEach, describe, expect, it, vi } from 'vitest'
import { FILENAME_PREVIEW_VARS, generateFilename } from '../src/lib/filename'
import { transcriptMetadata } from '../src/lib/transcript-metadata'
import { conversationToMarkdown } from '../src/lib/export-markdown'
import { conversationToHtml } from '../src/lib/export-html'
import { buildArchive } from '../src/lib/export-archive'
import { webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Conversation, ExportOptions } from '../src/lib/types'

const options: ExportOptions = { format: 'markdown', includeMetadata: true, includeImages: false, includeCodeBlocks: true }
const conversation = (timestamps: Array<number | undefined>): Conversation => ({
  id: 'synthetic-recency', title: 'Synthetic timestamp test', url: '', platform: 'claude', source: 'api',
  createdAt: Date.parse('2026-01-01T00:00:00Z'),
  messages: timestamps.map((timestamp, index) => ({ id: String(index), role: 'user', content: 'Synthetic message', timestamp })),
})

function localTimes(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const offset = -date.getTimezoneOffset()
  return {
    date: day,
    datetime: `${day}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`,
  }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('last visible message filename times', () => {
  it('uses the maximum message timestamp, not array order, creation or export time', () => {
    const latest = Date.parse('2026-10-22T11:53:50+09:00')
    const conv = conversation([latest, Date.parse('2026-10-22T11:00:00+09:00')])
    vi.useFakeTimers()
    vi.setSystemTime('2026-10-23T00:00:00Z')
    const pattern = '{last_message_date}-{last_message_datetime}'
    const expected = localTimes(latest)
    expect(generateFilename(pattern, conv)).toBe(`${expected.date}-${expected.datetime}`)
    vi.setSystemTime('2026-11-01T00:00:00Z')
    expect(generateFilename(pattern, conv)).toBe(`${expected.date}-${expected.datetime}`)
    expect(FILENAME_PREVIEW_VARS.last_message_datetime(conv)).toBe(expected.datetime)
    expect(transcriptMetadata(conv).last_visible_message_at).toBe('2026-10-22T02:53:50.000Z')
  })

  it('changes only when the latest known message time changes', () => {
    const conv = conversation([Date.parse('2026-10-22T02:53:50Z')])
    const before = generateFilename('{last_message_datetime}', conv)
    conv.messages[0].content = 'An older message edit does not prove a new timestamp'
    expect(generateFilename('{last_message_datetime}', conv)).toBe(before)
    conv.messages.push({ id: 'new', role: 'assistant', content: 'Synthetic reply', timestamp: Date.parse('2026-10-22T03:53:50Z') })
    expect(generateFilename('{last_message_datetime}', conv)).toBe(localTimes(Date.parse('2026-10-22T03:53:50Z')).datetime)
  })

  it('stays unknown for missing/invalid times even with chat creation or provider update fields', () => {
    const conv = Object.assign(conversation([undefined, NaN, Infinity, -1, 8.64e15 + 1]), {
      updatedAt: Date.parse('2026-10-22T03:00:00Z'),
      updated_at: '2026-10-22T03:00:00Z',
    })
    expect(generateFilename('{last_message_date}-{last_message_datetime}', conv)).toBe('unknown-unknown')
    expect(FILENAME_PREVIEW_VARS.last_message_date(conv)).toBe('unknown')
    expect(transcriptMetadata(conv)).toMatchObject({
      last_visible_message_at: 'unknown', last_visible_message_at_source: 'unknown', message_timestamp_coverage: '0/5',
    })
    expect(transcriptMetadata(conversation([])).last_visible_message_at).toBe('unknown')
  })

  it('accepts the epoch and reports incomplete message timestamp coverage', () => {
    const conv = conversation([0, undefined])
    expect(generateFilename('{last_message_datetime}', conv)).toBe(localTimes(0).datetime)
    expect(transcriptMetadata(conv)).toMatchObject({
      last_visible_message_at: '1970-01-01T00:00:00.000Z',
      last_visible_message_at_source: 'max-exported-message-timestamp', message_timestamp_coverage: '1/2',
    })
  })

  it('keeps unknown/source/coverage explicit in Markdown, HTML and archive metadata', async () => {
    const conv = conversation([undefined])
    expect(conversationToMarkdown(conv, options)).toContain('**last_visible_message_at:** unknown')
    expect(conversationToHtml(conv, options)).toContain('last_visible_message_at:</strong> unknown')
    vi.stubGlobal('crypto', webcrypto)
    expect((await buildArchive(conv, options, 'synthetic-test')).manifest).toMatchObject({
      last_visible_message_at: 'unknown', last_visible_message_at_source: 'unknown', message_timestamp_coverage: '0/1',
    })
  })

  it.each([
    ['Asia/Tokyo', '2026-10-22', '2026-10-22T093000+0900'],
    ['UTC', '2026-10-22', '2026-10-22T003000+0000'],
    ['America/Los_Angeles', '2026-10-21', '2026-10-21T173000-0700'],
  ])('uses device-local dates and explicit offsets in %s', (timezone, date, datetime) => {
    // Separate processes exercise real Date timezone rules without changing
    // the timezone of concurrently running Vitest workers. No provider I/O.
    const script = `
      const ts = require('typescript'), fs = require('node:fs');
      require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, path);
      const { generateFilename } = require(process.argv[1]);
      const conversation = JSON.parse(process.argv[2]);
      process.stdout.write(JSON.stringify([generateFilename('{last_message_date}', conversation), generateFilename('{last_message_datetime}', conversation)]));
    `
    const actual = execFileSync(process.execPath, ['-e', script, resolve(__dirname, '../src/lib/filename.ts'), JSON.stringify(conversation([Date.parse('2026-10-22T00:30:00Z')]))], {
      cwd: resolve(__dirname, '..'), env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    })
    expect(JSON.parse(actual)).toEqual([date, datetime])
  })
})
