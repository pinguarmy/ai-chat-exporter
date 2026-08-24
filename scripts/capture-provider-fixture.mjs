#!/usr/bin/env node
/**
 * Capture a real provider API fixture through the local Kimi WebBridge daemon.
 *
 * Drives the user's logged-in browser (WebBridge at http://127.0.0.1:10086) to
 * run the same list+detail requests the extension parsers use, writes the RAW
 * capture to the gitignored captures-raw/ directory, then runs the sanitizer
 * and commits only the sanitized fixture under tests/fixtures/providers/.
 *
 * Raw captures contain private data and NEVER leave captures-raw/.
 *
 * Usage:
 *   node scripts/capture-provider-fixture.mjs --provider <chatgpt|claude|gemini|deepseek|grok> \
 *     [--conversation-url <url>] [--scenario normal]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { sanitizeCapture, scanForResidualSecrets } from './sanitize-provider-fixture.mjs'

const BRIDGE_URL = 'http://127.0.0.1:10086/command'
const SESSION = 'provider-fixture-capture'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAW_DIR = path.join(REPO_ROOT, 'captures-raw')
const FIXTURE_ROOT = path.join(REPO_ROOT, 'tests', 'fixtures', 'providers')

/** How many conversation details to capture when no --conversation-url is given. */
const DEFAULT_DETAIL_COUNT = 3

// ---------------------------------------------------------------------------
// In-page capture snippets. Each mirrors the fetch shapes used by the
// extension parsers in src/contents/ (read-only reference; do not drift).
// Every snippet returns a compact JSON string.
// ---------------------------------------------------------------------------

const CHATGPT_SNIPPET = String.raw`
(async () => {
  const origin = location.origin
  const targetId = __TARGET_ID__
  const out = { session: null, listPages: [], details: [] }

  const sessionRes = await fetch(origin + '/api/auth/session', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  })
  if (sessionRes.status === 401 || sessionRes.status === 403) {
    return JSON.stringify({ error: 'login_required', status: sessionRes.status })
  }
  out.session = await sessionRes.json().catch(() => null)
  const token = out.session && out.session.accessToken
  const headers = {
    'Accept': 'application/json',
    'oai-language': 'en-US'
  }
  if (token) headers['Authorization'] = 'Bearer ' + token

  const limit = 100
  let offset = 0
  for (let page = 0; page < 200; page++) {
    const res = await fetch(
      origin + '/backend-api/conversations?offset=' + offset + '&limit=' + limit + '&order=updated',
      { credentials: 'include', headers }
    )
    if (res.status === 401 || res.status === 403) {
      return JSON.stringify({ error: 'login_required', status: res.status })
    }
    if (!res.ok) return JSON.stringify({ error: 'api_error', status: res.status, partial: out })
    const data = await res.json()
    out.listPages.push(data)
    const items = data.items || data.conversations || []
    if (items.length < limit) break
    offset += limit
  }

  let ids = []
  if (targetId) {
    ids = [targetId]
  } else if (out.listPages[0]) {
    ids = (out.listPages[0].items || out.listPages[0].conversations || [])
      .slice(0, __DETAIL_COUNT__)
      .map(item => item.id)
      .filter(Boolean)
  }
  for (const id of ids) {
    const res = await fetch(origin + '/backend-api/conversation/' + id, {
      credentials: 'include',
      headers
    })
    if (res.ok) out.details.push(await res.json())
  }
  return JSON.stringify(out)
})()
`

const CLAUDE_SNIPPET = String.raw`
(async () => {
  const targetId = __TARGET_ID__
  const out = { session: null, listPages: [], details: [] }

  const sessionRes = await fetch('https://claude.ai/api/auth/session', { credentials: 'include' })
  if (sessionRes.status === 401 || sessionRes.status === 403) {
    return JSON.stringify({ error: 'login_required', status: sessionRes.status })
  }
  out.session = await sessionRes.json().catch(() => null)

  const html = document.documentElement ? document.documentElement.innerHTML : ''
  const apiMatch = html.match(/\/api\/organizations\/([a-f0-9-]{36})\/chat_conversations/i)
  let orgId = apiMatch && apiMatch[1]
  if (!orgId && out.session && out.session.organization && out.session.organization.id) {
    orgId = out.session.organization.id
  }
  if (!orgId) {
    // Fallback: /api/bootstrap lists all memberships; pick the first that responds 200
    const boot = await fetch('/api/bootstrap', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null)
    const memberships = (boot && boot.account && boot.account.memberships) || []
    for (const m of memberships) {
      const candidate = m.organization && m.organization.uuid
      if (!candidate) continue
      const probe = await fetch('/api/organizations/' + candidate + '/chat_conversations?limit=1&offset=0', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      if (probe.ok) { orgId = candidate; break }
    }
  }
  if (!orgId) return JSON.stringify({ error: 'no_organization_id', partial: out })

  const headers = { 'Accept': 'application/json' }
  const limit = 100
  let offset = 0
  for (let page = 0; page < 200; page++) {
    const res = await fetch(
      'https://claude.ai/api/organizations/' + orgId + '/chat_conversations?limit=' + limit + '&offset=' + offset,
      { credentials: 'include', headers }
    )
    if (res.status === 401 || res.status === 403) {
      return JSON.stringify({ error: 'login_required', status: res.status })
    }
    if (!res.ok) return JSON.stringify({ error: 'api_error', status: res.status, partial: out })
    const data = await res.json()
    out.listPages.push(data)
    const items = Array.isArray(data) ? data : (data.conversations || data.items || [])
    if (items.length < limit) break
    offset += limit
  }

  const firstPage = out.listPages[0]
  const firstItems = firstPage ? (Array.isArray(firstPage) ? firstPage : (firstPage.conversations || firstPage.items || [])) : []
  const ids = targetId
    ? [targetId]
    : firstItems.slice(0, __DETAIL_COUNT__).map(item => item.uuid || item.id).filter(Boolean)
  for (const id of ids) {
    const res = await fetch(
      'https://claude.ai/api/organizations/' + orgId + '/chat_conversations/' + id +
        '?tree=True&rendering_mode=messages&render_all_tools=true',
      { credentials: 'include', headers }
    )
    if (res.ok) out.details.push(await res.json())
  }
  return JSON.stringify(out)
})()
`

const DEEPSEEK_SNIPPET = String.raw`
(async () => {
  const targetId = __TARGET_ID__
  const out = { listPages: [], details: [] }
  const headers = { 'Accept': 'application/json' }

  let cursor = ''
  let offset = 0
  let endpoint = ''
  const endpoints = [
    'https://chat.deepseek.com/api/v0/chat_session/fetch_page',
    'https://chat.deepseek.com/api/v0/chat/history'
  ]
  for (let page = 0; page < 100; page++) {
    let res = null
    const bases = endpoint ? [endpoint] : endpoints
    for (const base of bases) {
      const query = new URLSearchParams()
      if (base.indexOf('fetch_page') !== -1) {
        query.set('lte_cursor.pinned', 'false')
        if (cursor) query.set('lte_cursor.id', cursor)
      } else {
        if (cursor) query.set('cursor', cursor)
        else if (offset > 0) query.set('offset', String(offset))
        query.set('limit', '100')
      }
      res = await fetch(base + '?' + query.toString(), {
        method: 'GET',
        credentials: 'include',
        headers
      })
      if (res.status === 401 || res.status === 403) {
        return JSON.stringify({ error: 'login_required', status: res.status })
      }
      if (res.ok) { endpoint = base; break }
      res = null
    }
    if (!res) return JSON.stringify({ error: 'api_error', status: 0, partial: out })
    const data = await res.json()
    out.listPages.push(data)
    const biz = data && data.data && data.data.biz_data ? data.data.biz_data : (data && data.data) || {}
    const sessions = biz.chat_sessions || biz.sessions || biz.items || []
    const nextCursor = biz.cursor || biz.next_cursor || biz.lte_cursor
    const hasMore = biz.has_more
    if (nextCursor && nextCursor !== cursor) {
      cursor = nextCursor
    } else if (hasMore === true && sessions.length > 0) {
      offset += sessions.length
      cursor = ''
    } else {
      break
    }
  }

  const firstPage = out.listPages[0]
  const firstBiz = firstPage && firstPage.data && firstPage.data.biz_data
    ? firstPage.data.biz_data
    : (firstPage && firstPage.data) || {}
  const firstItems = firstBiz.chat_sessions || firstBiz.sessions || firstBiz.items || []
  const ids = targetId
    ? [targetId]
    : firstItems.slice(0, __DETAIL_COUNT__).map(item => item.id || item.chat_session_id).filter(Boolean)
  for (const id of ids) {
    const res = await fetch(
      'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=' + encodeURIComponent(id),
      { method: 'GET', credentials: 'include', headers }
    )
    if (res.ok) out.details.push(await res.json())
  }
  return JSON.stringify(out)
})()
`

const GEMINI_SNIPPET = String.raw`
(async () => {
  const targetId = __TARGET_ID__
  const wiz = window.WIZ_global_data || window.__WIZ_global_data || {}
  const authToken = wiz.SNlM0e
  const sessionId = wiz.FdrFJe || ''
  if (!authToken) return JSON.stringify({ error: 'login_required' })

  const buildUrl = (rpcids, sourcePath) => {
    const params = new URLSearchParams({
      rpcids,
      'source-path': sourcePath,
      'f.sid': sessionId,
      '_reqid': String(Math.floor(Math.random() * 100000)),
      'rt': 'c'
    })
    return 'https://gemini.google.com/_/BardChatUi/data/batchexecute?' + params.toString()
  }
  const rpcRequest = (rpcId, args) => JSON.stringify([[ [rpcId, JSON.stringify(args), null, 'generic'] ]])
  const call = async (rpcids, sourcePath, payload) => {
    const body = new URLSearchParams()
    body.set('f.req', payload)
    body.set('at', authToken)
    const res = await fetch(buildUrl(rpcids, sourcePath), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Same-Domain': '1'
      },
      body: body.toString()
    })
    if (res.status === 401 || res.status === 403) return { error: 'login_required', status: res.status }
    if (!res.ok) return { error: 'api_error', status: res.status }
    const text = await res.text()
    // Parse the batchexecute envelope into plain JSON so the sanitizer can
    // walk it: strip the XSSI prefix, split framed lines, decode inner payloads.
    const payloads = []
    for (const line of text.replace(/^\)\]\}'\s*/, '').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || /^\d+$/.test(trimmed)) continue
      let frame
      try { frame = JSON.parse(trimmed) } catch { continue }
      if (!Array.isArray(frame)) continue
      for (const entry of frame) {
        if (Array.isArray(entry) && entry[0] === 'wrb.fr' && typeof entry[2] === 'string') {
          try { payloads.push(JSON.parse(entry[2])) } catch { payloads.push(entry[2]) }
        }
      }
    }
    return { payloads }
  }

  const out = { listStreams: [], details: [] }
  for (const mode of [1, 0]) {
    const stream = { mode, pages: [] }
    let pageToken = null
    const seen = new Set()
    for (let page = 0; page < 200; page++) {
      const result = await call('MaZiqc', '/app', rpcRequest('MaZiqc', [25, pageToken, [mode, null, 1]]))
      if (result.error) return JSON.stringify({ error: result.error, status: result.status, partial: out })
      stream.pages.push(result.payloads)
      const payload = result.payloads[0]
      const nested = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : []
      const next = (Array.isArray(payload) && typeof payload[1] === 'string' && payload[1]) ||
        (typeof nested[1] === 'string' && nested[1]) || null
      if (!next || seen.has(next)) break
      seen.add(next)
      pageToken = next
    }
    out.listStreams.push(stream)
  }

  const ids = []
  if (targetId) {
    ids.push(targetId)
  } else {
    const findIds = (node) => {
      if (ids.length >= __DETAIL_COUNT__ || !node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        if (node.length >= 2 && typeof node[0] === 'string' && /^c_[a-zA-Z0-9_-]+$/.test(node[0])) {
          ids.push(node[0].replace(/^c_/, ''))
        }
        for (const item of node) findIds(item)
      } else {
        for (const key of Object.keys(node)) findIds(node[key])
      }
    }
    for (const stream of out.listStreams) for (const page of stream.pages) findIds(page)
  }
  for (const id of ids.slice(0, __DETAIL_COUNT__)) {
    const result = await call('hNvQHb', '/app/' + id, rpcRequest('hNvQHb', ['c_' + id, 1000, null, 1, [1], [4], null, 1]))
    if (!result.error) out.details.push(result.payloads)
  }
  return JSON.stringify(out)
})()
`

const GROK_SNIPPET = String.raw`
(async () => {
  const targetId = __TARGET_ID__
  const out = { listPages: [], details: [] }
  const init = { credentials: 'include', headers: { 'Accept': 'application/json' } }

  let pageToken = null
  for (let page = 0; page < 200; page++) {
    const url = 'https://grok.com/rest/app-chat/conversations?pageSize=100' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '')
    const res = await fetch(url, init)
    if (res.status === 401 || res.status === 403) {
      return JSON.stringify({ error: 'login_required', status: res.status })
    }
    if (!res.ok) return JSON.stringify({ error: 'api_error', status: res.status, partial: out })
    const data = await res.json()
    out.listPages.push(data)
    pageToken = data && typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : null
    if (!pageToken) break
  }

  const firstIds = []
  for (const pageData of out.listPages.slice(0, 1)) {
    for (const value of Object.values(pageData || {})) {
      if (!Array.isArray(value)) continue
      for (const record of value) {
        const id = record && (record.conversationId || record.id)
        if (typeof id === 'string' && id) firstIds.push(id)
      }
    }
  }
  const ids = targetId ? [targetId] : firstIds.slice(0, __DETAIL_COUNT__)

  for (const id of ids) {
    const encoded = encodeURIComponent(id)
    const detailRes = await fetch('https://grok.com/rest/app-chat/conversations_v2/' + encoded, init)
    if (!detailRes.ok) continue
    const detail = await detailRes.json()

    const nodeRes = await fetch('https://grok.com/rest/app-chat/conversations/' + encoded + '/response-node', init)
    if (!nodeRes.ok) continue
    const nodes = await nodeRes.json()
    const responseIds = Array.from(new Set(
      ((nodes && nodes.responseNodes) || [])
        .map(node => node && node.responseId)
        .filter(value => typeof value === 'string' && value)
    ))
    if (responseIds.length === 0) continue

    const messagesRes = await fetch(
      'https://grok.com/rest/app-chat/conversations/' + encoded + '/load-responses',
      {
        ...init,
        method: 'POST',
        headers: { ...init.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseIds })
      }
    )
    if (!messagesRes.ok) continue
    out.details.push({
      conversation: detail,
      responseNode: nodes,
      responses: await messagesRes.json()
    })
  }
  return JSON.stringify(out)
})()
`

const PROVIDERS = {
  chatgpt: { home: 'https://chatgpt.com/', snippet: CHATGPT_SNIPPET },
  claude: { home: 'https://claude.ai/', snippet: CLAUDE_SNIPPET },
  deepseek: { home: 'https://chat.deepseek.com/', snippet: DEEPSEEK_SNIPPET },
  gemini: { home: 'https://gemini.google.com/app', snippet: GEMINI_SNIPPET },
  grok: { home: 'https://grok.com/', snippet: GROK_SNIPPET },
}

/** Extract a conversation ID from a provider conversation URL. */
function conversationIdFromUrl(provider, url) {
  if (!url) return null
  try {
    const { pathname } = new URL(url)
    const match =
      pathname.match(/\/c\/([A-Za-z0-9_-]+)/) || // chatgpt, grok
      pathname.match(/\/chat\/([A-Za-z0-9-]+)/) || // claude
      pathname.match(/\/app\/([A-Za-z0-9_-]+)/) || // gemini
      pathname.match(/\/s\/([A-Za-z0-9-]+)/) // deepseek
    return match ? match[1] : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// WebBridge daemon client
// ---------------------------------------------------------------------------

async function callBridge(action, args = {}) {
  const response = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args, session: SESSION }),
  })
  if (!response.ok) {
    throw new Error(`WebBridge ${action} failed: HTTP ${response.status}`)
  }
  const body = await response.json().catch(() => null)
  if (body && body.error) {
    throw new Error(`WebBridge ${action} error: ${body.error}`)
  }
  return body
}

/** Unwrap the evaluate envelope ({type, value}, possibly nested). */
function unwrapEvaluate(body) {
  let node = body
  for (let depth = 0; depth < 4 && node && typeof node === 'object'; depth++) {
    if (typeof node.value === 'string') return node.value
    if (typeof node.result === 'string') return node.result
    node = node.result ?? node.data ?? node.value
  }
  return typeof node === 'string' ? node : null
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = { scenario: 'normal' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--provider' || arg === '--conversation-url' || arg === '--scenario') {
      flags[arg.slice(2)] = argv[++i]
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return flags
}

function fail(message) {
  console.error(`capture-provider-fixture: ${message}`)
  process.exit(1)
}

async function main(argv) {
  const flags = parseArgs(argv)
  const provider = flags.provider
  const config = PROVIDERS[provider]
  if (!config) {
    fail(`--provider is required and must be one of: ${Object.keys(PROVIDERS).join(', ')}`)
  }

  // 1. Daemon must be reachable and driving the user's browser.
  try {
    await callBridge('list_tabs')
  } catch (error) {
    fail(
      `WebBridge daemon unreachable at ${BRIDGE_URL} (${error.message}). ` +
        'Start the daemon and connect the user browser before capturing.'
    )
  }

  // 2. Open the provider page (or the requested conversation) in this session.
  const targetUrl = flags['conversation-url'] || config.home
  await callBridge('navigate', { url: targetUrl, newTab: true, group_title: 'Provider fixture capture' })

  // 3. Run the in-page capture snippet with the page's login session.
  const targetId = conversationIdFromUrl(provider, flags['conversation-url'])
  const code = config.snippet
    .replace('__TARGET_ID__', targetId ? JSON.stringify(targetId) : 'null')
    .replaceAll('__DETAIL_COUNT__', String(DEFAULT_DETAIL_COUNT))
  const evalBody = await callBridge('evaluate', { code })
  const rawText = unwrapEvaluate(evalBody)
  if (!rawText) {
    fail('capture snippet returned no data; the provider page may not have loaded')
  }
  let raw
  try {
    raw = JSON.parse(rawText)
  } catch {
    fail('capture snippet did not return valid JSON')
  }
  if (raw.error === 'login_required') {
    fail(
      `${provider} reports a login wall (status ${raw.status ?? 'unknown'}). ` +
        'Log in to the provider in the connected browser and retry.'
    )
  }
  if (raw.error) {
    fail(`${provider} capture failed: ${raw.error} (status ${raw.status ?? 'unknown'})`)
  }

  // 4. Raw capture goes to the gitignored captures-raw/ directory only.
  mkdirSync(RAW_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rawPath = path.join(RAW_DIR, `${provider}-${stamp}.json`)
  writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n')
  console.warn(`WARNING: raw capture written to ${rawPath}`)
  console.warn('This file contains PRIVATE data (tokens, message text, account IDs).')
  console.warn('It is gitignored and must never be committed or shared.')

  // 5. Sanitize into a commit-safe fixture.
  const capturedAt = new Date().toISOString().slice(0, 10)
  const fixture = sanitizeCapture(raw, { provider, scenario: flags.scenario, capturedAt })
  const findings = scanForResidualSecrets(fixture)
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`  residual [${finding.pattern}] at ${finding.path}: ${finding.excerpt}`)
    }
    fail('sanitized fixture still contains secret-looking patterns; fixture NOT written')
  }

  const fixtureDir = path.join(FIXTURE_ROOT, provider)
  mkdirSync(fixtureDir, { recursive: true })
  const fixturePath = path.join(fixtureDir, `${capturedAt}-${flags.scenario}.json`)
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`Sanitized fixture written to ${fixturePath}`)
  console.log(`schemaFingerprint: ${fixture.schemaFingerprint}`)

  await callBridge('close_tab').catch(() => {})
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main(process.argv.slice(2)).catch(error => fail(error.message))
}
