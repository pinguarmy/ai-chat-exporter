#!/usr/bin/env node
// Isolated, synthetic UX scenarios. Never accesses a signed-in provider page.
import { chromium } from 'playwright'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const ext = path.join(root, 'ai-chat-exporter')
const proof = path.resolve(process.env.UX_PROOF_DIR || '/tmp/aice-ux-review-baseline')
const profile = mkdtempSync(path.join(tmpdir(), 'aice-ux-'))
const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'))
const errors = []
const results = []
mkdirSync(proof, { recursive: true })
let context
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--headless=new'],
    ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 380, height: 720 },
  })
  await context.route(/https?:\/\//, route => route.abort())
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
  const id = new URL(worker.url()).hostname
  const prefix = `chrome-extension://${id}`
  const checkKeyboardGuide = async page => {
    const summary = page.locator('.quick-start-guide > summary')
    await summary.focus()
    await page.keyboard.press('Space')
    const open = await page.locator('.quick-start-guide').evaluate(el => el.open)
    await page.keyboard.press('Space')
    if (await page.locator('.quick-start-guide').evaluate(el => el.open) === open) throw new Error('Quick-start keyboard disclosure did not toggle')
    results.push({ scenario: 'help-keyboard', toggledWithSpace: true, locale: await page.locator('html').getAttribute('lang') })
  }
  let recentDownload
  await worker.evaluate(() => {
    globalThis.__uxDownloads = []
    chrome.downloads.onChanged.addListener(async delta => {
      if (delta.state?.current === 'complete') {
        const [item] = await chrome.downloads.search({ id: delta.id })
        globalThis.__uxDownloads.push({ id: item.id, filename: item.filename, state: item.state })
      }
    })
  })
  const setup = await context.newPage()
  await setup.goto(`${prefix}/popup.html`)
  await setup.evaluate(async () => chrome.storage.local.set({ settings: { locale: 'en', theme: 'light', includeMetadata: true, filenamePattern: '{title}-{id}' } }))
  await setup.close()
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/popup.html')) return
    const scenario = new URLSearchParams(location.search).get('ux') || 'unsupported'
    const homepage = scenario === 'homepage'
    const blocked = scenario === 'blocked'
    const conversation = {
      id: 'ux-synthetic', title: 'Planning a weekend walk', platform: 'chatgpt', url: 'https://chatgpt.com/c/ux-synthetic',
      source: 'api', sourceCompleteness: 'verified', messages: [
        { id: 'u', role: 'user', content: 'Suggest a short weekend walk.' },
        { id: 'a', role: 'assistant', content: 'Start at the park entrance. Follow the river path and return before sunset.' },
      ],
    }
    chrome.tabs.get = async id => ({ id, title: conversation.title, url: scenario === 'unsupported' ? 'https://example.invalid/' : homepage ? 'https://chatgpt.com/' : conversation.url })
    chrome.tabs.sendMessage = async (_id, message) => message.type === 'PARSE_CONVERSATION'
      ? homepage ? { data: null, meta: { noConversation: true } } : blocked ? { error: 'ChatGPT did not return a verifiably complete active branch. Export was stopped.' } : { data: conversation }
      : message.type === 'FETCH_ALL_CONVERSATIONS'
        ? { data: [{ id: 'ux-synthetic', title: conversation.title, platform: 'chatgpt', url: conversation.url }], meta: { source: 'api', complete: true } }
        : { data: null }
  })
  for (const [scenario, expected] of [['unsupported', 'No Chat Detected'], ['homepage', 'No conversation open'], ['current', 'Planning a weekend walk'], ['blocked', 'could not verify']]) {
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(`${scenario}: ${error.message}`))
    await page.goto(`${prefix}/popup.html?sourceTab=70&ux=${scenario}`)
    await page.getByText(expected, { exact: false }).first().waitFor({ state: 'visible' })
    await page.locator('.popup-container').screenshot({ path: path.join(proof, `${scenario}.png`) })
    const body = await page.locator('body').innerText()
    const overflow = await page.locator('.popup-container').evaluate(el => el.scrollWidth > el.clientWidth)
    if (overflow) throw new Error(`${scenario} horizontal overflow`)
    results.push({ scenario, body, overflow })
    if (process.env.UX_REVIEW_PHASE !== 'baseline') {
      await checkKeyboardGuide(page)
      if (scenario === 'unsupported') {
        const urls = await page.locator('.provider-links a').evaluateAll(nodes => nodes.map(node => node.href))
        if (urls.length !== 5) throw new Error('First-use provider links missing')
      }
    }
    if (scenario === 'current') {
      const event = page.waitForEvent('download')
      await page.getByRole('button', { name: /^Export/ }).first().click()
      const download = await event
      await download.saveAs(path.join(proof, 'first-export.md'))
      const text = readFileSync(path.join(proof, 'first-export.md'), 'utf8')
      if (!text.includes('Follow the river path')) throw new Error('First export omitted answer')
      await page.getByRole('button', { name: 'Open download folder', exact: true }).waitFor({ state: 'visible' })
      await page.locator('.popup-container').screenshot({ path: path.join(proof, 'current-saved.png') })
      await worker.waitForFunction(() => globalThis.__uxDownloads.length > 0)
      recentDownload = await worker.evaluate(() => globalThis.__uxDownloads.at(-1))
      const actualFilename = path.basename(recentDownload.filename)
      const receipt = await page.locator('.message.success').innerText()
      if (!receipt.includes(actualFilename)) throw new Error(`Saved receipt did not match browser download: ${actualFilename}`)
      results.push({ scenario: 'first-export', playwrightSuggestedFilename: download.suggestedFilename(), browserFilename: actualFilename, receiptMatchesBrowser: true, containsAnswer: true })
    }
    if (scenario === 'homepage') {
      await page.getByRole('button', { name: 'Bulk Export', exact: true }).first().click()
      await page.getByRole('checkbox', { name: 'Planning a weekend walk', exact: true }).waitFor({ state: 'visible' })
      if (process.env.UX_REVIEW_PHASE !== 'baseline') {
        const format = page.getByRole('group', { name: 'Format:' })
        const contained = await format.evaluate(el => {
          const rect = el.getBoundingClientRect(), parent = el.closest('.popup-container').getBoundingClientRect()
          return rect.top >= parent.top && rect.bottom <= parent.bottom
        })
        if (!contained) throw new Error('Bulk format choice is not visible in popup')
        await page.getByRole('checkbox', { name: 'Planning a weekend walk', exact: true }).check()
        await page.getByRole('button', { name: 'Reading PDF', exact: true }).focus()
        await page.keyboard.press('Space')
        if (await page.getByRole('button', { name: 'Reading PDF', exact: true }).getAttribute('aria-pressed') !== 'true') throw new Error('Keyboard format choice failed')
        results.push({ scenario: 'bulk-format', visibleWithoutScrolling: true, keyboardSelectedPdf: true })
      }
      await page.locator('.popup-container').screenshot({ path: path.join(proof, 'homepage-bulk.png') })
    }
    await page.close()
  }
  if (process.env.UX_REVIEW_PHASE !== 'baseline') {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']) {
      const page = await context.newPage()
      await page.goto(`${prefix}/popup.html?sourceTab=70&ux=current`)
      await page.evaluate(async locale => {
        const { settings } = await chrome.storage.local.get('settings')
        await chrome.storage.local.set({ settings: { ...settings, locale } })
      }, locale)
      await page.reload()
      await page.getByText('Planning a weekend walk', { exact: true }).waitFor()
      await page.locator('.quick-start-guide > summary').click()
      await checkKeyboardGuide(page)
      const overflow = await page.locator('.popup-container').evaluate(el => el.scrollWidth > el.clientWidth)
      if (overflow) throw new Error(`${locale} onboarding overflow`)
      const focus = []
      await page.locator('.tab').first().focus()
      for (let count = 0; count < 14; count++) {
        await page.keyboard.press('Tab')
        focus.push(await page.evaluate(() => ({ tag: document.activeElement.tagName, label: document.activeElement.getAttribute('aria-label') || document.activeElement.textContent?.trim().slice(0, 80), visible: document.activeElement.getBoundingClientRect().width > 0 })))
      }
      if (focus.some(entry => !entry.visible)) throw new Error(`${locale} keyboard reached hidden element`)
      results.push({ scenario: 'locale-keyboard', locale, overflow, focus })
      await page.locator('.popup-body').evaluate(el => el.scrollTop = 0)
      await page.locator('.popup-container').screenshot({ path: path.join(proof, `current-${locale}.png`) })
      if (locale === 'en') {
        await page.getByRole('button', { name: 'Toggle Theme' }).click()
        await page.locator('.popup-container').screenshot({ path: path.join(proof, 'current-dark.png') })
      }
      await page.close()
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  writeFileSync(path.join(proof, 'evidence.json'), JSON.stringify({
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), version: manifest.version,
    syntheticTransport: true, providerNetworkBlocked: true, results, errors,
  }, null, 2))
  console.log(`UX scenarios and actual first Markdown download passed: ${proof}`)
} finally {
  await context?.close()
  // This exact path was created above for this run; no user profile is touched.
  if (path.dirname(profile) === tmpdir() && path.basename(profile).startsWith('aice-ux-')) rmSync(profile, { recursive: true, force: true })
}
