#!/usr/bin/env node

/**
 * Chromium smoke for the unpacked MV3 extension.
 *
 * Loads ai-chat-exporter/ (fallback: build/chrome-mv3-prod/), asserts the
 * service worker starts, and opens popup / options / preview. It never visits
 * chatgpt.com, claude.ai, or any other provider, and it never logs in.
 *
 * Requires a prior `npm run build` so the unpacked mirror exists.
 *
 * Usage:
 *   npm run test:browser
 *   EXTENSION_SMOKE_HEADED=1 npm run test:browser
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROVIDER_HOST_RE =
  /chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|deepseek\.com|grok\.com/i

function fail(message) {
  throw new Error(message)
}

function resolveExtensionDir() {
  const candidates = [
    path.join(repoRoot, 'ai-chat-exporter'),
    path.join(repoRoot, 'build', 'chrome-mv3-prod'),
  ]
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'manifest.json'))) return dir
  }
  fail(
    'Unpacked extension not found (looked for manifest.json in ai-chat-exporter/ and build/chrome-mv3-prod/). Run `npm run build` first.'
  )
}

function requirePageFile(extDir, relativePath) {
  const filePath = path.join(extDir, ...relativePath.split('/'))
  if (!existsSync(filePath)) {
    fail(
      `Built extension is missing ${relativePath} under ${path.relative(repoRoot, extDir) || extDir}. Run \`npm run build\` first.`
    )
  }
  return relativePath
}

function isBenignConsoleError(text) {
  return (
    /favicon\.ico/i.test(text) ||
    /Download the React DevTools/i.test(text) ||
    /net::ERR_FILE_NOT_FOUND/i.test(text)
  )
}

function recordConsoleError(label, msg, errors) {
  if (msg.type() !== 'error') return
  const text = msg.text()
  if (isBenignConsoleError(text)) return
  errors.push(`${label} console error: ${text}`)
}

function attachContextGuards(context, errors) {
  context.on('console', (msg) => recordConsoleError('extension', msg, errors))
  context.on('weberror', (webError) => {
    const error = webError.error()
    errors.push(`extension weberror: ${error instanceof Error ? error.message : String(error)}`)
  })
}

function attachPageGuards(page, label, errors) {
  page.on('pageerror', (error) => {
    errors.push(`${label} pageerror: ${error instanceof Error ? error.message : String(error)}`)
  })
  page.on('crash', () => {
    errors.push(`${label} crashed`)
  })
  page.on('framenavigated', (frame) => {
    const url = frame.url()
    if (PROVIDER_HOST_RE.test(url)) {
      errors.push(`${label} navigated to a provider: ${url}`)
    }
  })
}

function assertNoProviderUrl(url, label) {
  if (PROVIDER_HOST_RE.test(url)) {
    fail(`${label} loaded a provider URL: ${url}`)
  }
}

async function waitForServiceWorker(context) {
  const existing = context.serviceWorkers()
  if (existing[0]) return existing[0]
  try {
    return await context.waitForEvent('serviceworker', { timeout: 20_000 })
  } catch {
    const retry = context.serviceWorkers()
    if (retry[0]) return retry[0]
    fail(
      'MV3 service worker did not start. Chromium may have refused --load-extension, or the unpacked build is invalid.'
    )
  }
}

async function assertVisibleText(page, text, label) {
  const locator = page.getByText(text, { exact: false }).first()
  try {
    await locator.waitFor({ state: 'visible', timeout: 15_000 })
  } catch {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 500)
    fail(`${label} did not render visible text ${JSON.stringify(text)}. Body starts with: ${body || '(empty)'}`)
  }
}

async function openExtensionPage(context, extensionId, relativePath, errors, label) {
  const url = `chrome-extension://${extensionId}/${relativePath}`
  assertNoProviderUrl(url, label)
  const page = await context.newPage()
  attachPageGuards(page, label, errors)
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  if (!response) fail(`${label} navigation produced no response (${url})`)
  if (response.status() >= 400) fail(`${label} HTTP ${response.status()} for ${url}`)
  assertNoProviderUrl(page.url(), label)
  return page
}

async function main() {
  const extDir = resolveExtensionDir()
  const manifest = JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8'))
  const popupPath = requirePageFile(extDir, manifest.action?.default_popup || 'popup.html')
  const optionsPath = requirePageFile(
    extDir,
    manifest.options_ui?.page || manifest.options_page || 'options.html'
  )
  const previewPath = requirePageFile(extDir, 'tabs/preview.html')

  const headed = process.env.EXTENSION_SMOKE_HEADED === '1'
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'ai-chat-exporter-smoke-'))
  const errors = []
  let context

  console.log(`Loading unpacked extension from ${path.relative(repoRoot, extDir) || extDir}`)

  try {
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: !headed,
        args: [
          `--disable-extensions-except=${extDir}`,
          `--load-extension=${extDir}`,
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/executable doesn't exist|browserType\.launch/i.test(message)) {
        fail(
          'Playwright Chromium is not installed. Run `npx playwright install chromium` (CI: `npx playwright install --with-deps chromium`).'
        )
      }
      throw error
    }

    attachContextGuards(context, errors)

    const serviceWorker = await waitForServiceWorker(context)
    const extensionId = new URL(serviceWorker.url()).hostname
    if (!extensionId) fail(`Could not parse extension id from service worker URL: ${serviceWorker.url()}`)
    console.log(`Service worker started (${path.basename(new URL(serviceWorker.url()).pathname)}) id=${extensionId}`)

    const popup = await openExtensionPage(context, extensionId, popupPath, errors, 'popup')
    await assertVisibleText(popup, 'AI Chat Exporter', 'popup')
    await assertVisibleText(popup, 'Current Chat', 'popup')
    await assertVisibleText(popup, 'No Chat Detected', 'popup')
    console.log('popup.html rendered')

    const options = await openExtensionPage(context, extensionId, optionsPath, errors, 'options')
    await assertVisibleText(options, 'Extension Settings', 'options')
    const storageRoundTrip = await options.evaluate(async () => {
      const key = '__browser_smoke_roundtrip'
      const value = `ok-${Date.now()}`
      await chrome.storage.local.set({ [key]: value })
      const stored = await chrome.storage.local.get(key)
      await chrome.storage.local.remove(key)
      return stored[key] === value
    })
    if (!storageRoundTrip) fail('chrome.storage.local round-trip failed on the options page')
    console.log('options.html rendered; chrome.storage.local round-trip ok')

    const preview = await openExtensionPage(context, extensionId, previewPath, errors, 'preview')
    await assertVisibleText(preview, 'No conversation to preview', 'preview')
    console.log('tabs/preview.html rendered')

    if (errors.length) {
      fail(`Extension pages reported fatal errors:\n- ${errors.join('\n- ')}`)
    }

    console.log('Extension browser smoke passed (no provider login).')
  } finally {
    if (context) await context.close().catch(() => undefined)
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
