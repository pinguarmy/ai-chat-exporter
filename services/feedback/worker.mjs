import { adminPage } from './admin-page.mjs'
const PUBLIC_ORIGIN = 'https://pinguarmy.github.io'
const MAX_BYTES = 8192
const COOKIE = 'feedback_admin'
const HOURS = 3600
const encoder = new TextEncoder()
export const REASONS = Object.freeze([
  'Export failed or content was missing', 'Formatting did not meet my needs',
  'Missing platform or feature', 'Hard to use', 'No longer needed', 'Other',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
async function hmac(secret, input) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(input))))
}
export function equalStrings(a, b) {
  // Callers compare fixed-length SHA-256 digests, not variable-length passwords.
  let diff = a.length ^ b.length
  for (let i = 0; i < 64; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } })
}
async function bodyJson(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(request.headers.get('content-type') || '')) throw { status: 415, code: 'json_required' }
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw { status: 413, code: 'request_too_large' }
  if (!request.body) throw { status: 400, code: 'invalid_json' }
  const reader = request.body.getReader()
  const chunks = []
  let length = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_BYTES) { await reader.cancel(); throw { status: 413, code: 'request_too_large' } }
    chunks.push(value)
  }
  try {
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error()
    return body
  } catch { throw { status: 400, code: 'invalid_json' } }
}
export function validateFeedback(body) {
  if (typeof body.id !== 'string' || !UUID.test(body.id)) throw { status: 400, code: 'invalid_id' }
  if (body.honeypot !== undefined && typeof body.honeypot !== 'string') throw { status: 400, code: 'invalid_feedback' }
  if (body.honeypot) return null
  if (!Array.isArray(body.reasons) || body.reasons.length > 6 || body.reasons.some(r => !REASONS.includes(r))) throw { status: 400, code: 'invalid_reasons' }
  if (typeof body.text !== 'string' || [...body.text].length > 600 || !['en', 'zh-CN'].includes(body.locale)) throw { status: 400, code: 'invalid_feedback' }
  const contact = body.contact === undefined ? '' : body.contact
  // eslint-disable-next-line no-control-regex -- rejects control characters in the contact field on purpose
  if (typeof contact !== 'string' || [...contact].length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(contact)) throw { status: 400, code: 'invalid_contact' }
  const text = body.text.trim()
  const reasons = [...new Set(body.reasons)]
  if (!text && !reasons.length) throw { status: 400, code: 'empty_feedback' }
  return { id: body.id.toLowerCase(), reasons, text, contact: contact.trim(), locale: body.locale }
}
async function counter(env, key, max, expires) {
  // SQLite serializes this single statement: competing requests cannot both
  // pass an application-side read-then-increment check at the boundary.
  return env.DB.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = rate_limits.count + 1 WHERE rate_limits.count < ? RETURNING count')
    .bind(key, expires, max).first()
}
async function privateIp(env, request, bucket) {
  // Raw address exists only transiently; DB receives a bucket-specific HMAC.
  return hmac(env.FEEDBACK_SECRET, `ip:${bucket}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`)
}
async function loggedIn(request, env, now) {
  const cookie = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1)
  if (!cookie || !/^\d{10}\.[0-9a-f]{32}\.[0-9a-f]{64}$/.test(cookie)) return false
  const [expiry, nonce, signature] = cookie.split('.')
  if (Number(expiry) <= now || Number(expiry) > now + 8 * HOURS) return false
  return equalStrings(signature, await hmac(env.FEEDBACK_SECRET, `session:${expiry}.${nonce}`))
}
function cookieHeader(value, age) { return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}` }
function ownOrigin(request) { return request.headers.get('origin') === new URL(request.url).origin }
function publicAllowed(request) { const origin = request.headers.get('origin'); return origin === PUBLIC_ORIGIN || ownOrigin(request) }
function cors(request) { return { 'Access-Control-Allow-Origin': request.headers.get('origin'), Vary: 'Origin' } }
function requireOwn(request) { if (!ownOrigin(request)) throw { status: 403, code: 'origin_denied' } }
function requireAuth(configured) { if (!configured) throw { status: 401, code: 'unauthorized' } }

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const now = Math.floor(Date.now() / 1000)
    let headers = {}
    try {
      if (url.pathname === '/api/feedback') {
        if (!publicAllowed(request)) return json({ ok: false, error: 'origin_denied' }, 403)
        headers = cors(request)
        if (request.method === 'OPTIONS') {
          if (request.headers.get('access-control-request-method') !== 'POST' || (request.headers.get('access-control-request-headers') || '').split(',').some(h => h.trim() && h.trim().toLowerCase() !== 'content-type')) return json({ ok: false, error: 'preflight_denied' }, 403, headers)
          return new Response(null, { status: 204, headers: { ...headers, 'Cache-Control': 'no-store', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } })
        }
        if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, headers)
      }
      if (!env.DB || typeof env.FEEDBACK_SECRET !== 'string' || env.FEEDBACK_SECRET.length < 32 || typeof env.ADMIN_PASSWORD !== 'string' || env.ADMIN_PASSWORD.length < 12) return json({ ok: false, error: 'service_unavailable' }, 503, headers)
      if (url.pathname === '/api/feedback') {
        const body = await bodyJson(request)
        const feedback = validateFeedback(body)
        // Deliberate bot trap: success shape without a claim of persistence (201).
        if (!feedback) return json({ ok: true, id: body.id }, 200, headers)
        const existing = await env.DB.prepare('SELECT id FROM feedback WHERE id = ?').bind(feedback.id).first()
        if (existing) return json({ ok: true, id: existing.id }, 201, headers)
        const hour = Math.floor(now / HOURS)
        const ip = await privateIp(env, request, hour)
        if (!await counter(env, `submit:${hour}:${ip}`, 10, now + 48 * HOURS) || !await counter(env, `global:${Math.floor(now / 86400)}`, 300, now + 48 * HOURS)) return json({ ok: false, error: 'rate_limited' }, 429, { ...headers, 'Retry-After': '3600' })
        const saved = await env.DB.prepare('INSERT INTO feedback (id, reasons, text, locale, status, created_at, contact) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id')
          .bind(feedback.id, JSON.stringify(feedback.reasons), feedback.text, feedback.locale, 'new', now, feedback.contact).first()
        // A concurrent retry can have inserted the same UUID after our first read.
        const confirmed = saved || await env.DB.prepare('SELECT id FROM feedback WHERE id = ?').bind(feedback.id).first()
        if (!confirmed) throw Error('save_failed')
        return json({ ok: true, id: confirmed.id }, 201, headers)
      }
      if (url.pathname === '/api/login' && request.method === 'POST') {
        requireOwn(request)
        const body = await bodyJson(request)
        const bucket = Math.floor(now / 900)
        const ip = await privateIp(env, request, bucket)
        if (!await counter(env, `login:${bucket}:${ip}`, 10, now + 48 * HOURS)) return json({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '900' })
        if (typeof body.password !== 'string' || !equalStrings(await hmac(env.FEEDBACK_SECRET, `password:${body.password}`), await hmac(env.FEEDBACK_SECRET, `password:${env.ADMIN_PASSWORD}`))) return json({ ok: false, error: 'unauthorized' }, 401)
        const value = `${now + 8 * HOURS}.${crypto.randomUUID().replaceAll('-', '')}`
        const signed = `${value}.${await hmac(env.FEEDBACK_SECRET, `session:${value}`)}`
        return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(signed, 8 * HOURS) })
      }
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        requireOwn(request)
        return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) })
      }
      const authenticated = await loggedIn(request, env, now)
      if (url.pathname === '/admin' && request.method === 'GET') return adminPage(authenticated)
      if (url.pathname === '/api/admin/feedback' && request.method === 'GET') {
        requireAuth(authenticated)
        if (request.headers.get('origin') && !ownOrigin(request)) throw { status: 403, code: 'origin_denied' }
        const result = await env.DB.prepare('SELECT id, reasons, text, locale, status, created_at, contact FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?').bind(100).all()
        return json({ ok: true, feedback: result.results || [] })
      }
      const statusMatch = url.pathname.match(/^\/api\/admin\/feedback\/([0-9a-f-]+)$/i)
      if (statusMatch && request.method === 'PATCH') {
        requireOwn(request); requireAuth(authenticated)
        if (!UUID.test(statusMatch[1])) throw { status: 400, code: 'invalid_id' }
        const body = await bodyJson(request)
        if (!['new', 'read', 'resolved'].includes(body.status)) throw { status: 400, code: 'invalid_status' }
        const row = await env.DB.prepare('UPDATE feedback SET status = ? WHERE id = ? RETURNING id').bind(body.status, statusMatch[1].toLowerCase()).first()
        return row ? json({ ok: true }) : json({ ok: false, error: 'not_found' }, 404)
      }
      return json({ ok: false, error: 'not_found' }, 404)
    } catch (error) {
      return json({ ok: false, error: error?.code || 'service_unavailable' }, error?.status || 503, headers)
    }
  },
  async scheduled(_event, env) {
    const now = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM feedback WHERE created_at < ?').bind(now - 180 * 86400),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
    ])
  },
}
