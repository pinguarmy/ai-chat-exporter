#!/usr/bin/env node

/**
 * Provider canary: runs the built extension's real content-script paths
 * against the maintainer's own logged-in provider sessions and reports
 * invariants only.
 *
 * Run locally, never in CI:
 *   npm run build
 *   npm run canary:providers -- --setup --profile ~/canary-profile    # log in once
 *   npm run canary:providers -- --profile ~/canary-profile --out ~/canary-out
 *
 * The profile directory is the maintainer's explicit grant of a logged-in
 * session; it is used in place, never copied, and only read-only requests
 * (the same list/detail reads the extension makes) are issued. The report
 * contains no conversation text, titles, IDs, URLs, account data, cookies or
 * tokens (see scripts/lib/provider-canary.mjs and docs/MAINTENANCE.md).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

import {
  CanaryUsageError,
  EXIT,
  PROVIDERS,
  STATUS,
  USAGE,
  assertNoPrivateStrings,
  buildReport,
  classifyResponseError,
  collectPrivateStrings,
  computeExitCode,
  errorClassOf,
  evaluateConversation,
  evaluateListFirstPage,
  evaluateListPagination,
  evaluateMarkdown,
  evaluateOrderAgreement,
  isLoggedOutLocation,
  parseArgs,
  pickMostRecent,
  renderTable,
  validateOutDir,
  validateProfileDir
} from './lib/provider-canary.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// Core TypeScript modules (the same integrity and export code the extension
// ships), bundled on the fly so the canary cannot drift from them.
// ---------------------------------------------------------------------------

async function loadCoreModules() {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aice-canary-core-'))
  const outfile = path.join(dir, 'core.mjs')
  const abs = p => JSON.stringify(path.join(repoRoot, p))
  try {
    await esbuild.build({
      stdin: {
        contents: [
          `export { analyzeConversationIntegrity, isConversationExportable, isTranscriptVerified } from ${abs('src/core/conversation-integrity.ts')}`,
          `export { conversationToMarkdown } from ${abs('src/core/export-markdown.ts')}`,
          `export { buildExportOptions } from ${abs('src/core/export-options.ts')}`
        ].join('\n'),
        resolveDir: repoRoot,
        loader: 'ts'
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'silent'
    })
    return await import(pathToFileURL(outfile).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Extension + browser
// ---------------------------------------------------------------------------

function resolveExtensionDir(explicit) {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [path.join(repoRoot, 'ai-chat-exporter'), path.join(repoRoot, 'build', 'chrome-mv3')]
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'manifest.json'))) return dir
  }
  throw new CanaryUsageError(
    'extension_not_built',
    'Unpacked extension not found. Run `npm run build` first (or pass --extension <dir>).'
  )
}

async function launch(profileDir, extDir, headless) {
  const { chromium } = await import('playwright')
  try {
    return await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless,
      args: [
        `--disable-extensions-except=${extDir}`,
        `--load-extension=${extDir}`,
        ...(headless ? ['--headless=new'] : [])
      ],
      ignoreDefaultArgs: ['--disable-extensions']
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/executable doesn't exist|browserType\.launch.*install/i.test(message)) {
      throw new CanaryUsageError(
        'chromium_missing',
        'Playwright Chromium is not installed. Run `npx playwright install chromium`.'
      )
    }
    if (/ProcessSingleton|profile.*in use|already running/i.test(message)) {
      throw new CanaryUsageError(
        'profile_in_use',
        'The profile is already open in another browser.'
      )
    }
    throw new CanaryUsageError(
      'launch_failed',
      `Could not launch Chromium (${errorClassOf(error)}).`
    )
  }
}

async function waitForServiceWorker(context) {
  const existing = context.serviceWorkers()[0]
  if (existing) return existing
  try {
    return await context.waitForEvent('serviceworker', { timeout: 20_000 })
  } catch {
    throw new CanaryUsageError(
      'extension_not_started',
      'The extension service worker did not start. Rebuild with `npm run build`.'
    )
  }
}

// ---------------------------------------------------------------------------
// Messaging: an extension page forwards the real content-script protocol
// (DETECT_PLATFORM, FETCH_ALL_CONVERSATIONS, ...) via chrome.tabs.sendMessage.
// Raw error text is mapped to a fixed kind inside the page and never returned.
// ---------------------------------------------------------------------------

async function findTabId(extPage, patterns) {
  return extPage.evaluate(async urls => {
    const tabs = await chrome.tabs.query({ url: urls })
    return tabs.length === 1 && typeof tabs[0].id === 'number' ? tabs[0].id : null
  }, patterns)
}

async function sendToTab(extPage, tabId, message, timeoutMs) {
  return extPage.evaluate(
    async ({ tabId, message, timeoutMs }) => {
      let timer
      try {
        const response = await Promise.race([
          chrome.tabs.sendMessage(tabId, message),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('canary_timeout')), timeoutMs)
          })
        ])
        return { ok: true, response: response ?? null }
      } catch (error) {
        const text = error instanceof Error ? error.message : ''
        return {
          ok: false,
          kind: text === 'canary_timeout' ? 'timeout' : 'content_script_unreachable'
        }
      } finally {
        clearTimeout(timer)
      }
    },
    { tabId, message, timeoutMs }
  )
}

async function waitForContentScript(extPage, cfg, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const tabId = await findTabId(extPage, cfg.matchPatterns).catch(() => null)
    if (tabId !== null) {
      const result = await sendToTab(extPage, tabId, { type: 'DETECT_PLATFORM' }, 3000)
      if (result.ok && result.response?.data?.platform) {
        return { tabId, detect: result.response.data }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return null
}

async function hasLoggedOutSignal(page) {
  try {
    if (await page.locator('input[type="password"]').count()) return true
    const control = page
      .getByRole('button', { name: /^(log ?in|sign ?in|登录|登入)/i })
      .or(page.getByRole('link', { name: /^(log ?in|sign ?in|登录|登入)/i }))
    return (await control.count()) > 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Check recorder
// ---------------------------------------------------------------------------

class Recorder {
  constructor() {
    this.checks = []
  }

  async run(name, fn) {
    const started = performance.now()
    let result
    try {
      result = await fn()
    } catch (error) {
      result = { status: STATUS.FAIL, reason: 'unexpected_error', errorClass: errorClassOf(error) }
    }
    const durationMs = Math.round(performance.now() - started)
    const status =
      result.status || (result.failed && result.failed.length ? STATUS.FAIL : STATUS.PASS)
    const check = { name, durationMs, ...result, status }
    this.checks.push(check)
    console.log(`  ${name}: ${status}`)
    return check
  }

  skip(name, reason) {
    this.checks.push({ name, status: STATUS.SKIPPED, reason, durationMs: 0 })
    console.log(`  ${name}: SKIPPED`)
  }

  skipRemaining(names, reason) {
    for (const name of names) this.skip(name, reason)
  }
}

const AFTER_LIST = [
  'list_first_page',
  'list_pagination',
  'detect_conversation',
  'current_parse',
  'detail_fetch',
  'order_agreement',
  'markdown_export'
]

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// One provider
// ---------------------------------------------------------------------------

async function runProvider(key, { context, extPage, options, core, privates }) {
  const cfg = PROVIDERS[key]
  const rec = new Recorder()
  let loggedIn = null
  const page = await context.newPage()
  const nav = url => page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs })
  const result = () => ({ provider: key, loggedIn, checks: rec.checks })
  try {
    // 1. Home: content script present and detects the right platform.
    let navError = null
    try {
      await nav(cfg.home)
    } catch (error) {
      navError = error
    }
    const homeLoggedOut = !navError && isLoggedOutLocation(key, page.url())
    const homeSignal = homeLoggedOut || (!navError && (await hasLoggedOutSignal(page)))
    const ready =
      !navError && !homeLoggedOut ? await waitForContentScript(extPage, cfg, 20_000) : null

    await rec.run('detect_home', async () => {
      if (navError) {
        return {
          status: STATUS.FAIL,
          reason: 'navigation_failed',
          errorClass: errorClassOf(navError)
        }
      }
      if (homeLoggedOut) {
        return {
          status: STATUS.SKIPPED,
          reason: 'not_logged_in',
          metrics: { loggedOutSignal: true }
        }
      }
      if (!ready) return { status: STATUS.FAIL, failed: ['content_script_unreachable'] }
      const platformMatches = ready.detect.platform === key
      return {
        failed: platformMatches ? [] : ['platform_mismatch'],
        metrics: {
          platformMatches,
          isConversationPage: ready.detect.isConversationPage === true,
          loggedOutSignal: homeSignal
        }
      }
    })
    if (!ready) {
      if (homeLoggedOut) loggedIn = false
      const reason = homeLoggedOut ? 'not_logged_in' : 'upstream_failed'
      rec.skip('session', reason)
      rec.skipRemaining(AFTER_LIST, reason)
      return result()
    }

    // 2. History list through the extension's own FETCH_ALL_CONVERSATIONS path.
    const listResult = await sendToTab(
      extPage,
      ready.tabId,
      { type: 'FETCH_ALL_CONVERSATIONS' },
      options.listTimeoutMs
    )
    const listResponse = listResult.ok ? listResult.response : null
    const items = Array.isArray(listResponse?.data) ? listResponse.data : []
    const meta = listResponse?.meta || {}
    privates.listItems.push(...items)
    const responseErrorKind = listResponse?.error ? classifyResponseError(listResponse.error) : null
    const listUsable = items.length > 0 && meta.source === 'api'
    const authRequired = meta.authRequired === true || responseErrorKind === 'auth_required'
    const loggedOutNow = !listUsable && (authRequired || homeSignal)

    const session = await rec.run('session', async () => {
      if (listUsable) {
        loggedIn = true
        return { status: STATUS.PASS }
      }
      if (loggedOutNow) {
        loggedIn = false
        return {
          status: STATUS.SKIPPED,
          reason: 'not_logged_in',
          metrics: { loggedOutSignal: true }
        }
      }
      if (responseErrorKind === 'rate_limited') {
        return { status: STATUS.SKIPPED, reason: 'rate_limited' }
      }
      // No usable API list and no logout signal: not a pass, and not hidden.
      return { status: STATUS.FAIL, failed: ['session_unconfirmed'] }
    })
    if (session.status !== STATUS.PASS) {
      rec.skipRemaining(AFTER_LIST, session.reason || 'upstream_failed')
      return result()
    }

    await rec.run('list_first_page', async () => evaluateListFirstPage(items, meta, key))
    await rec.run('list_pagination', async () => evaluateListPagination(items, meta, key))

    // 3. Target: user-chosen conversation, else the most recent in the list.
    const explicitUrl = options.conversations[key]
    const picked = explicitUrl ? null : pickMostRecent(items)
    const targetUrl = explicitUrl || picked?.url
    let convTab = null
    const detectConv = await rec.run('detect_conversation', async () => {
      if (typeof targetUrl !== 'string') {
        return { status: STATUS.FAIL, failed: ['no_target_conversation'] }
      }
      try {
        await nav(targetUrl)
      } catch (error) {
        return {
          status: STATUS.FAIL,
          reason: 'navigation_failed',
          errorClass: errorClassOf(error)
        }
      }
      if (isLoggedOutLocation(key, page.url())) {
        return { status: STATUS.FAIL, failed: ['redirected_to_login_after_session_ok'] }
      }
      convTab = await waitForContentScript(extPage, cfg, 20_000)
      if (!convTab) return { status: STATUS.FAIL, failed: ['content_script_unreachable'] }
      const platformMatches = convTab.detect.platform === key
      const isConversationPage = convTab.detect.isConversationPage === true
      return {
        failed: [
          ...(platformMatches ? [] : ['platform_mismatch']),
          ...(isConversationPage ? [] : ['not_detected_as_conversation_page'])
        ],
        metrics: { platformMatches, isConversationPage }
      }
    })
    if (!convTab || detectConv.status === STATUS.FAIL) {
      rec.skipRemaining(
        ['current_parse', 'detail_fetch', 'order_agreement', 'markdown_export'],
        'upstream_failed'
      )
      return result()
    }

    // 4. Current-conversation parse (the popup's PARSE_CONVERSATION path).
    let parseConv = null
    let parseMeta = {}
    await rec.run('current_parse', async () => {
      const deadline = Date.now() + 30_000
      let last = null
      while (Date.now() < deadline) {
        last = await sendToTab(
          extPage,
          convTab.tabId,
          { type: 'PARSE_CONVERSATION', data: { forceVerify: true } },
          options.timeoutMs
        )
        const body = last.ok ? last.response : null
        if (body?.data?.messages?.length > 0 || body?.error) break
        await sleep(1500)
      }
      if (!last?.ok) {
        return {
          status: STATUS.FAIL,
          failed: [last?.kind === 'timeout' ? 'parse_timeout' : 'content_script_unreachable']
        }
      }
      const body = last.response || {}
      parseMeta = body.meta || {}
      if (body.error) {
        return {
          status: STATUS.FAIL,
          failed: [`parse_${classifyResponseError(body.error)}`],
          metrics: {
            domMessageCount: parseMeta.domMessageCount,
            apiMessageCount: parseMeta.apiMessageCount,
            apiIntegrityStatus: parseMeta.apiIntegrityStatus,
            reasonCodes: parseMeta.apiIntegrityReasons
          }
        }
      }
      parseConv = body.data || null
      if (parseConv) privates.conversations.push(parseConv)
      const evaluated = evaluateConversation(parseConv, core, { provider: key })
      return {
        ...evaluated,
        metrics: {
          ...evaluated.metrics,
          domMessageCount: parseMeta.domMessageCount,
          apiMessageCount: parseMeta.apiMessageCount,
          source: parseMeta.source
        }
      }
    })

    // 5. Detail fetch (FETCH_CONVERSATION_DETAIL) for the same conversation.
    let detailConv = null
    await rec.run('detail_fetch', async () => {
      const id = picked?.id || parseConv?.id
      if (typeof id !== 'string' || !id) {
        return { status: STATUS.FAIL, failed: ['no_conversation_id'] }
      }
      const res = await sendToTab(
        extPage,
        convTab.tabId,
        { type: 'FETCH_CONVERSATION_DETAIL', data: { id } },
        options.timeoutMs
      )
      if (!res.ok) {
        return {
          status: STATUS.FAIL,
          failed: [res.kind === 'timeout' ? 'detail_timeout' : 'content_script_unreachable']
        }
      }
      if (res.response?.error) {
        return {
          status: STATUS.FAIL,
          failed: [`detail_${classifyResponseError(res.response.error)}`]
        }
      }
      detailConv = res.response?.data || null
      if (detailConv) privates.conversations.push(detailConv)
      const evaluated = evaluateConversation(detailConv, core, {
        provider: key,
        requireVerified: true
      })
      const sameConversation = Boolean(parseConv && detailConv && parseConv.id === detailConv.id)
      if (parseConv && detailConv && !sameConversation) {
        evaluated.failed.push('detail_is_different_conversation')
      }
      return { ...evaluated, metrics: { ...evaluated.metrics, sameConversation } }
    })

    // 6. API-vs-DOM order agreement.
    if (!parseConv || !detailConv) {
      rec.skip('order_agreement', 'upstream_failed')
    } else {
      await rec.run('order_agreement', async () => {
        const agreement = evaluateOrderAgreement(parseConv, detailConv, {
          parseSource: parseMeta.source
        })
        if (agreement.skipped) {
          return { status: STATUS.SKIPPED, reason: agreement.skipped, metrics: agreement.metrics }
        }
        return agreement
      })
    }

    // 7. Markdown export in memory, from the authoritative detail when present.
    const exportSubject = detailConv || parseConv
    if (!exportSubject) {
      rec.skip('markdown_export', 'upstream_failed')
    } else {
      await rec.run('markdown_export', async () => {
        const markdown = core.conversationToMarkdown(
          exportSubject,
          core.buildExportOptions('markdown')
        )
        return evaluateMarkdown(exportSubject, markdown)
      })
    }
    return result()
  } finally {
    await page.close().catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Setup mode: lets the maintainer log in once. Performs no checks and sends
// no extension messages.
// ---------------------------------------------------------------------------

async function runSetup(options, profileDir, extDir) {
  console.log(
    'Setup mode: log in to the providers in the opened tabs, then close the browser window.'
  )
  console.log('No checks are run and nothing is read from the pages.')
  const context = await launch(profileDir, extDir, false)
  const closed = new Promise(resolve => context.on('close', resolve))
  for (const key of options.providers) {
    const page = await context.newPage()
    await page.goto(PROVIDERS[key].home, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
  }
  await closed
  return EXIT.OK
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return EXIT.OK
  }
  const profileDir = validateProfileDir(options.profile, { repoRoot, setup: options.setup })
  const outDir = options.setup ? null : validateOutDir(options.out, { profileDir })
  const extDir = resolveExtensionDir(options.extension)
  if (options.setup) {
    mkdirSync(profileDir, { recursive: true })
    return runSetup(options, profileDir, extDir)
  }
  const manifest = JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8'))
  const optionsPage = manifest.options_ui?.page || manifest.options_page || 'options.html'
  const core = await loadCoreModules()

  console.log(
    `Provider canary: extension ${manifest.version}; providers: ${options.providers.join(', ')}`
  )
  const context = await launch(profileDir, extDir, options.headless)
  const privates = { conversations: [], listItems: [] }
  const results = []
  try {
    const serviceWorker = await waitForServiceWorker(context)
    const extensionId = new URL(serviceWorker.url()).hostname
    // Tabs restored from the profile would make tab lookup ambiguous. Closing
    // them does not modify the logged-in session.
    for (const stale of context.pages()) await stale.close().catch(() => undefined)
    const extPage = await context.newPage()
    await extPage.goto(`chrome-extension://${extensionId}/${optionsPage}`, {
      waitUntil: 'domcontentloaded'
    })

    for (const key of options.providers) {
      console.log(`${key}:`)
      try {
        results.push(await runProvider(key, { context, extPage, options, core, privates }))
      } catch (error) {
        results.push({
          provider: key,
          loggedIn: null,
          checks: [
            {
              name: 'provider_run',
              status: STATUS.FAIL,
              reason: 'unexpected_error',
              errorClass: errorClassOf(error)
            }
          ]
        })
        console.log('  provider_run: FAIL')
      }
    }
  } finally {
    await context.close().catch(() => undefined)
  }

  const report = buildReport({
    extensionVersion: manifest.version,
    providers: results,
    generatedAt: new Date().toISOString(),
    requested: options.providers
  })
  const json = `${JSON.stringify(report, null, 2)}\n`
  const table = renderTable(report)
  // Last line of defense: nothing from the tested conversations may appear in output.
  assertNoPrivateStrings(json + table, collectPrivateStrings(privates))

  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, 'provider-canary-report.json'), json)
  writeFileSync(path.join(outDir, 'provider-canary-report.txt'), table)
  console.log('')
  process.stdout.write(table)
  console.log(`Report written to ${path.join(outDir, 'provider-canary-report.{json,txt}')}`)
  return computeExitCode(report, { requireAll: options.requireAll })
}

main().then(
  code => {
    process.exitCode = code
  },
  error => {
    // Print only fixed text or a class name: raw errors can embed page content.
    if (error instanceof CanaryUsageError) {
      console.error(`provider-canary: ${error.message}`)
      if (error.code === 'profile_required' || error.code === 'out_required') {
        console.error(`\n${USAGE}`)
      }
    } else {
      console.error(`provider-canary: unexpected failure (${errorClassOf(error)}).`)
    }
    process.exitCode = EXIT.USAGE
  }
)
