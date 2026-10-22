#!/usr/bin/env node
/** Native Chrome names/conflictAction; no provider requests or personal files. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ext = path.join(root, 'ai-chat-exporter')
const profile = mkdtempSync(path.join(os.tmpdir(), 'aice-native-download-'))
const destination = path.join(profile, 'downloads')
mkdirSync(path.join(profile, 'Default'), { recursive: true })
mkdirSync(destination)
writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: destination, prompt_for_download: false, directory_upgrade: true } }))
let context
try {
  // acceptDownloads:false avoids Playwright's allowAndName UUID renaming. The
  // browser CDP policy below explicitly allows native downloads to our temp dir.
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, acceptDownloads: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--headless=new'],
    ignoreDefaultArgs: ['--disable-extensions'],
  })
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).hostname
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  const session = await context.newCDPSession(page)
  await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true })
  await worker.evaluate(async () => {
    globalThis.__revision = 'Revision one'
    chrome.tabs.create = async () => ({ id: 876543, status: 'complete' })
    chrome.tabs.get = async () => ({ id: 876543, status: 'complete', url: 'https://chatgpt.com/' })
    chrome.tabs.remove = async () => {}
    chrome.tabs.sendMessage = async (_id, message) => {
      if (message.type === 'DETECT_PLATFORM') return { data: { platform: 'chatgpt' } }
      if (message.type === 'FETCH_ALL_CONVERSATIONS') return { data: [{ id: 'repeat-synthetic-full-id', title: 'Synthetic scheduled chat', platform: 'chatgpt', url: 'https://chatgpt.com/c/repeat-synthetic-full-id' }], meta: { source: 'api', complete: true } }
      return { data: { id: 'repeat-synthetic-full-id', title: 'Synthetic scheduled chat', platform: 'chatgpt', url: 'https://chatgpt.com/c/repeat-synthetic-full-id', source: 'api', sourceCompleteness: 'verified', messages: [{ id: 'a', role: 'assistant', content: globalThis.__revision, timestamp: Date.parse('2026-10-22T00:30:00Z') }] } }
    }
    const { settings } = await chrome.storage.local.get('settings')
    const platforms = Object.fromEntries(['chatgpt','claude','gemini','deepseek','grok'].map(platform => [platform, { enabled: platform === 'chatgpt', frequency: 'daily', skipAlreadyExported: false, overwriteExistingFiles: true, maxPerRun: 1, maxConcurrentConversations: 1 }]))
    await chrome.storage.local.set({ settings: { ...settings, locale: 'en', includeMetadata: true, filenamePattern: '{platform}-{full_id}-{last_message_datetime}', downloadFolder: 'custom', customFolderName: 'scheduled-review', scheduledExport: { enabled: false, checkIntervalMinutes: 15, platforms, defaultFormat: 'markdown', closeTabAfterExport: true, requestDelayMs: 1000, maxTotalPerRun: 1, maxConcurrentPlatforms: 1 } } })
  })
  async function run(revision, overwrite) {
    const marker = await worker.evaluate(async ({ revision, overwrite }) => {
      globalThis.__revision = revision
      const { settings } = await chrome.storage.local.get('settings')
      settings.scheduledExport.platforms.chatgpt.overwriteExistingFiles = overwrite
      await chrome.storage.local.set({ settings })
      return (await chrome.downloads.search({})).reduce((max, row) => Math.max(max, row.id), 0)
    }, { revision, overwrite })
    const start = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SCHEDULED_EXPORT_RUN' }))
    if (start?.data !== true) throw new Error('Run did not start')
    await page.evaluate(async marker => {
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        const rows = await chrome.downloads.search({})
        const status = (await chrome.storage.local.get('scheduledExportStatus')).scheduledExportStatus
        if (rows.some(row => row.id > marker && row.state === 'complete') && status?.isRunning === false) return
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Native scheduled download timed out')
    }, marker)
    const rows = await worker.evaluate(async marker => (await chrome.downloads.search({})).filter(row => row.id > marker), marker)
    if (rows.length !== 1 || rows[0].state !== 'complete') throw new Error('Expected exactly one completed download: ' + JSON.stringify(rows.map(row => ({ id: row.id, filename: row.filename, state: row.state }))))
    const filename = path.resolve(rows[0].filename)
    if (!filename.startsWith(path.resolve(profile) + path.sep)) throw new Error('Download escaped isolated profile')
    const text = readFileSync(filename, 'utf8')
    if (!text.includes(revision)) throw new Error('Downloaded stale content')
    console.log(`Completed ${revision}: ${path.basename(filename)}`)
    return filename
  }
  const first = await run('Revision one', true)
  const second = await run('Revision two', true)
  if (first !== second || readFileSync(first, 'utf8').includes('Revision one')) throw new Error('Native overwrite failed')
  const third = await run('Revision three', false)
  if (third === second || !readFileSync(second, 'utf8').includes('Revision two')) throw new Error('Opt-out did not preserve previous file')
  const files = readdirSync(path.dirname(second)).filter(name => name.endsWith('.md'))
  if (files.length !== 2 || !path.basename(second).includes('repeat-synthetic-full-id') || !/2026-10-22T\d{6}[+-]\d{4}/.test(second)) throw new Error('Filename tokens or file count wrong')
  console.log('Native scheduled download smoke passed: same-path overwrite, fresh bytes, opt-out uniquify, full ID and local last-message timestamp.')
} finally {
  if (context) await context.close()
  if (!path.resolve(profile).startsWith(path.join(os.tmpdir(), 'aice-native-download-'))) throw new Error('Unexpected cleanup path')
  rmSync(profile, { recursive: true, force: true })
}
