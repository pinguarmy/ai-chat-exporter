#!/usr/bin/env node
// Isolated, synthetic UX scenarios. Never accesses a signed-in provider page.
import { chromium } from 'playwright'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertBuildProvenance, createEvidenceRun, finishEvidenceRun, failEvidenceRun } from './lib/review-evidence.mjs'

const root = process.cwd()
const ext = path.join(root, 'ai-chat-exporter')
const proof = path.resolve(process.env.UX_PROOF_DIR || mkdtempSync(path.join(tmpdir(), 'aice-ux-proof-')))
const run = createEvidenceRun(proof, { command: 'node scripts/ux-experience-smoke.mjs', node: process.version, platform: process.platform, syntheticTransport: true, providerNetworkBlocked: true })
const profile = mkdtempSync(path.join(tmpdir(), 'aice-ux-'))
const destination = path.join(profile, 'downloads')
mkdirSync(path.join(profile, 'Default'), { recursive: true })
mkdirSync(destination)
writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: destination, prompt_for_download: false, directory_upgrade: true } }))
const errors = []
const results = []
mkdirSync(proof, { recursive: true })
let context
try {
  const provenance = assertBuildProvenance(root, ext)
  const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'))
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, acceptDownloads: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--headless=new'],
    ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 380, height: 720 },
  })
  await context.route(/https?:\/\//, route => route.abort())
  const settleTheme = async page => {
    await page.locator('.popup-container').evaluate(el => el.getBoundingClientRect())
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))))
  }
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
  const id = new URL(worker.url()).hostname
  const prefix = `chrome-extension://${id}`
  const assertContrast = async page => {
    const styles = await page.locator('.btn-primary').first().evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }))
    const luminance = css => css.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    const pair = [luminance(styles.color), luminance(styles.background)].sort((a, b) => a - b)
    const ratio = (pair[1] + .05) / (pair[0] + .05)
    if (ratio < 4.5) throw new Error(`Primary text contrast ${ratio.toFixed(2)} is below 4.5`)
    results.push({ scenario: 'primary-contrast', ...styles, ratio })
  }
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
  const setup = await context.newPage()
  await setup.goto(`${prefix}/popup.html`)
  const cdp = await context.newCDPSession(setup)
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true })
  await setup.evaluate(async () => chrome.storage.local.set({ settings: { locale: 'en', theme: 'light', includeMetadata: true, filenamePattern: '{title}-{id}' } }))
  await setup.close()
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/popup.html')) return
    const scenario = new URLSearchParams(location.search).get('ux') || 'unsupported'
    const homepage = scenario === 'homepage'
    const blocked = scenario === 'blocked'
    const unverified = scenario === 'unverified'
    const conversation = {
      id: 'ux-synthetic', title: 'Planning a weekend walk', platform: 'chatgpt', url: 'https://chatgpt.com/c/ux-synthetic',
      source: 'api', sourceCompleteness: unverified ? 'unverified' : 'verified', messages: [
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
  for (const [scenario, expected] of [['unsupported', 'No Chat Detected'], ['homepage', 'No conversation open'], ['current', 'Planning a weekend walk'], ['blocked', 'could not verify'], ['unverified', 'Planning a weekend walk']]) {
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
    if (scenario === 'unverified') {
      await page.getByText('Complete history could not be verified.', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'Save page snapshot Markdown', exact: true }).waitFor()
      if (await page.getByRole('button', { name: 'Archive ZIP', exact: true }).count()) throw new Error('Unverified source incorrectly offers complete ZIP')
      results.push({ scenario: 'unverified-preflight', limitedSnapshotAction: true, explainedBeforeSave: true })
    }
    if (scenario === 'current') {
      await page.getByRole('button', { name: /^Export/ }).first().click()
      await page.getByRole('button', { name: 'Open download folder', exact: true }).waitFor({ state: 'visible' })
      await page.locator('.popup-container').screenshot({ path: path.join(proof, 'current-saved.png') })
      recentDownload = await page.evaluate(async () => (await chrome.downloads.search({ state: 'complete', orderBy: ['-startTime'], limit: 1 }))[0])
      if (!path.resolve(recentDownload.filename).startsWith(destination + path.sep)) throw new Error('Download escaped the isolated profile')
      const text = readFileSync(recentDownload.filename, 'utf8')
      writeFileSync(path.join(proof, 'first-export.md'), text)
      if (!text.includes('Follow the river path')) throw new Error('First export omitted answer')
      const actualFilename = path.basename(recentDownload.filename)
      const receipt = await page.locator('.message.success').innerText()
      if (!receipt.includes(actualFilename)) throw new Error(`Saved receipt did not match browser download: ${actualFilename}`)
      results.push({ scenario: 'first-export', browserFilename: actualFilename, receiptMatchesBrowser: true, nativeDownloadPolicy: true, containsAnswer: true })
      const previousId = recentDownload.id
      await page.getByRole('button', { name: 'Export Successful', exact: true }).click()
      await page.waitForFunction(async id => {
        const rows = await chrome.downloads.search({ state: 'complete', orderBy: ['-startTime'], limit: 1 })
        return rows[0]?.id > id
      }, previousId)
      await page.getByRole('button', { name: 'Export Successful', exact: true }).waitFor()
      const repeated = await page.evaluate(async () => (await chrome.downloads.search({ state: 'complete', orderBy: ['-startTime'], limit: 1 }))[0])
      const repeatedName = path.basename(repeated.filename)
      if (repeatedName === actualFilename || !repeatedName.includes('(1)')) throw new Error('Native repeated download did not preserve both files')
      if (!(await page.locator('.message.success').innerText()).includes(repeatedName)) throw new Error('Repeated download receipt did not match actual browser filename')
      writeFileSync(path.join(proof, 'repeated-export.md'), readFileSync(repeated.filename))
      results.push({ scenario: 'native-repeat', browserFilename: repeatedName, firstFileRetained: readFileSync(recentDownload.filename, 'utf8') === text, receiptMatchesBrowser: true })
      const nextPage = context.waitForEvent('page')
      await page.getByRole('button', { name: 'Preview & select messages', exact: true }).click()
      const preview = await nextPage
      await preview.getByRole('button', { name: 'Select messages', exact: true }).waitFor()
      await preview.getByRole('button', { name: 'Select messages', exact: true }).focus()
      await preview.keyboard.press('Space')
      await preview.getByRole('checkbox', { name: 'Select message 2', exact: true }).focus()
      await preview.keyboard.press('Space')
      if (!await preview.getByRole('checkbox', { name: 'Select message 2', exact: true }).isChecked()) throw new Error('Preview keyboard selection failed')
      const notice = await preview.locator('.preview-partial-notice').innerText()
      if (!notice.includes('not a complete archive')) throw new Error('Preview selected scope notice missing')
      results.push({ scenario: 'preview-keyboard', sourceEntryOpenedRealTab: true, selectedAnswerWithSpace: true, partialNotice: notice })
      await preview.close()
      // Error/cancel replies here are explicit synthetic browser API failures,
      // not claims that an OS/network failure was triggered.
      for (const [message, expected] of [['Synthetic download failure', 'Synthetic download failure'], ['Export cancelled', 'Export stopped. Completed files were kept.']]) {
        await page.evaluate(message => { chrome.downloads.download = async () => { throw new Error(message) } }, message)
        await page.getByRole('button', { name: /^Export/ }).first().click()
        await page.getByText(expected, { exact: true }).waitFor()
        const enabled = await page.getByRole('button', { name: /^Export/ }).first().isEnabled()
        if (!enabled) throw new Error('Failed/cancelled export was not retryable')
        results.push({ scenario: 'synthetic-download-outcome', injectedApiError: message, visibleMessage: expected, retryEnabled: true, alerts: await page.getByRole('alert').count(), statuses: await page.getByRole('status').count() })
      }
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
        await chrome.storage.local.set({ settings: { ...settings, locale, theme: 'light' } })
      }, locale)
      await page.reload()
      await page.getByText('Planning a weekend walk', { exact: true }).waitFor()
      await page.locator('.quick-start-guide > summary').click()
      await checkKeyboardGuide(page)
      const overflow = await page.locator('.popup-container').evaluate(el => el.scrollWidth > el.clientWidth)
      if (overflow) throw new Error(`${locale} onboarding overflow`)
      const focus = []
      await page.reload()
      await page.getByText('Planning a weekend walk', { exact: true }).waitFor()
      // Start from a freshly loaded document, not a programmatic focus jump.
      for (let count = 0; count < 32; count++) {
        await page.keyboard.press('Tab')
        const entry = await page.evaluate(() => {
          const el = document.activeElement
          const rect = el.getBoundingClientRect()
          const css = getComputedStyle(el)
          return { tag: el.tagName, label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 80), visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight, outline: css.outlineStyle, outlineWidth: css.outlineWidth, isPrimary: el.classList.contains('btn-primary'), isGuide: el.matches('.quick-start-guide > summary') }
        })
        if (entry.tag === 'BODY') break
        focus.push(entry)
      }
      if (focus.some(entry => !entry.visible)) throw new Error(`${locale} keyboard reached an offscreen or hidden element`)
      if (!focus.some(entry => entry.isPrimary) || !focus.some(entry => entry.isGuide)) throw new Error(`${locale} keyboard did not reach primary action and guide from entry`)
      results.push({ scenario: 'locale-keyboard', locale, overflow, focus, startedFromFreshDocument: true })
      await page.locator('.popup-body').evaluate(el => el.scrollTop = 0)
      await settleTheme(page)
      await assertContrast(page)
      await page.locator('.popup-container').screenshot({ path: path.join(proof, `current-${locale}.png`) })
      if (locale === 'en') {
        await page.getByRole('button', { name: 'Toggle Theme' }).click()
        await settleTheme(page)
        await assertContrast(page)
        results.push({ scenario: 'dark-colors', colors: await page.locator('.format-btn').evaluateAll(nodes => nodes.map(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, label: el.textContent }))) })
        await page.locator('.popup-container').screenshot({ path: path.join(proof, 'current-dark.png') })
      }
      await page.close()
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  writeFileSync(path.join(proof, 'scenarios.json'), JSON.stringify({
    sourceCommit: provenance.sourceCommit, sourceTree: provenance.sourceTree, version: manifest.version,
    syntheticTransport: true, providerNetworkBlocked: true, results, errors,
  }, null, 2))
  finishEvidenceRun(run, { sourceCommit: provenance.sourceCommit, sourceTree: provenance.sourceTree, version: manifest.version, browser: context.browser().version(), scenarios: 'scenarios.json' }, readdirSync(proof).filter(name => name !== 'evidence.json'))
  console.log(`UX scenarios and actual first Markdown download passed: ${proof}`)
} catch (error) {
  failEvidenceRun(run, Object.assign(error, { code: 'UX_SCENARIO_FAILED' }))
  throw error
} finally {
  await context?.close()
  // This exact path was created above for this run; no user profile is touched.
  if (path.dirname(profile) === tmpdir() && path.basename(profile).startsWith('aice-ux-')) rmSync(profile, { recursive: true, force: true })
}
