import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import worker, { REASONS, equalStrings } from './worker.mjs'

const ORIGIN = 'https://feedback.example.workers.dev'
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return sqlite.prepare(sql).get(...args) || null
            },
            async all() {
              return { results: sqlite.prepare(sql).all(...args) }
            },
            async run() {
              return sqlite.prepare(sql).run(...args)
            }
          }
        }
      }
    },
    async batch(statements) {
      return Promise.all(statements.map(s => s.run()))
    }
  }
  return {
    env: {
      DB,
      FEEDBACK_SECRET: 'test-only-secret-key-with-at-least-32-chars',
      ADMIN_PASSWORD: 'test-only-admin-password'
    },
    sqlite
  }
}
const data = () => ({
  id: crypto.randomUUID(),
  reasons: [REASONS[0]],
  text: 'Some feedback',
  locale: 'en',
  honeypot: ''
})
function request(
  path,
  {
    method = 'POST',
    body = data(),
    origin = 'https://pinguarmy.github.io',
    ip = '192.0.2.1',
    cookie,
    type = 'application/json'
  } = {}
) {
  return new Request(ORIGIN + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      'CF-Connecting-IP': ip,
      ...(type ? { 'Content-Type': type } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(method === 'GET' || method === 'OPTIONS'
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body) })
  })
}
async function login(env) {
  const response = await worker.fetch(
    request('/api/login', { origin: ORIGIN, body: { password: env.ADMIN_PASSWORD } }),
    env
  )
  assert.equal(response.status, 200)
  return response.headers.get('set-cookie').split(';')[0]
}

test('save, parameterized injection text, UUID idempotency and no raw IP storage', async () => {
  const { env, sqlite } = setup()
  const body = { ...data(), text: "'); DROP TABLE feedback; -- <script>alert(1)</script> 中文" }
  const first = await worker.fetch(request('/api/feedback', { body }), env)
  assert.equal(first.status, 201)
  assert.deepEqual(await first.json(), { ok: true, id: body.id })
  assert.equal(first.headers.get('access-control-allow-origin'), 'https://pinguarmy.github.io')
  assert.equal(first.headers.get('cache-control'), 'no-store')
  assert.equal((await worker.fetch(request('/api/feedback', { body }), env)).status, 201)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 1)
  assert.equal(sqlite.prepare('SELECT text FROM feedback').get().text, body.text)
  assert.ok(
    !JSON.stringify(sqlite.prepare('SELECT * FROM rate_limits').all()).includes('192.0.2.1')
  )
  sqlite.close()
})

test('optional contact persists privately, defaults empty and is displayed as plain text', async () => {
  const { env, sqlite } = setup()
  const body = { ...data(), contact: '  person@example.test / @handle <script>alert(1)</script>  ' }
  const response = await worker.fetch(request('/api/feedback', { body }), env)
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { ok: true, id: body.id })
  assert.equal(
    sqlite.prepare('SELECT contact FROM feedback WHERE id = ?').get(body.id).contact,
    body.contact.trim()
  )
  const noContact = data()
  assert.equal((await worker.fetch(request('/api/feedback', { body: noContact }), env)).status, 201)
  assert.equal(
    sqlite.prepare('SELECT contact FROM feedback WHERE id = ?').get(noContact.id).contact,
    ''
  )
  assert.equal(
    (await worker.fetch(request('/api/admin/feedback', { method: 'GET', origin: null }), env))
      .status,
    401
  )
  const cookie = await login(env)
  const list = await worker.fetch(
    request('/api/admin/feedback', { method: 'GET', origin: ORIGIN, cookie }),
    env
  )
  const rows = (await list.json()).feedback
  assert.equal(rows.find(row => row.id === body.id).contact, body.contact.trim())
  assert.equal(rows.find(row => row.id === noContact.id).contact, '')
  const html = await (
    await worker.fetch(request('/admin', { method: 'GET', origin: null, cookie }), env)
  ).text()
  assert.ok(html.includes("contact.textContent=t('contact')+': '+item.contact"))
  assert.ok(html.includes("contact:['Contact','联系方式']"))
  assert.ok(!html.includes('mailto:'))
  assert.ok(!html.includes('innerHTML'))
  sqlite.close()
})

test('contact accepts 200 Unicode characters but rejects longer, nonstring and control characters', async () => {
  const { env, sqlite } = setup()
  const contact = '联'.repeat(200)
  assert.equal(
    (await worker.fetch(request('/api/feedback', { body: { ...data(), contact } }), env)).status,
    201
  )
  for (const invalid of [
    'x'.repeat(201),
    '联'.repeat(201),
    null,
    1,
    {},
    'name\nhandle',
    'name\tvalue',
    'bad\u0000value',
    'bad\u007fvalue',
    'bad\u0085value'
  ]) {
    const response = await worker.fetch(
      request('/api/feedback', { body: { ...data(), contact: invalid } }),
      env
    )
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { ok: false, error: 'invalid_contact' })
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 1)
  sqlite.close()
})

test('non-destructive contact migration preserves existing submissions with an empty default', () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    "CREATE TABLE feedback (id TEXT PRIMARY KEY, reasons TEXT NOT NULL, text TEXT NOT NULL, locale TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at INTEGER NOT NULL)"
  )
  const id = crypto.randomUUID()
  sqlite
    .prepare('INSERT INTO feedback VALUES (?,?,?,?,?,?)')
    .run(id, '["Other"]', 'Existing feedback', 'en', 'read', 123)
  sqlite.exec(readFileSync(new URL('./migrations/0002-contact.sql', import.meta.url), 'utf8'))
  assert.deepEqual(
    { ...sqlite.prepare('SELECT * FROM feedback WHERE id = ?').get(id) },
    {
      id,
      reasons: '["Other"]',
      text: 'Existing feedback',
      locale: 'en',
      status: 'read',
      created_at: 123,
      contact: ''
    }
  )
  sqlite.close()
})

test('only allowed origins get CORS, with narrow preflight and strict body bounds', async () => {
  const { env, sqlite } = setup()
  for (const origin of ['https://evil.example', 'null', undefined]) {
    const response = await worker.fetch(request('/api/feedback', { origin: origin || null }), env)
    assert.equal(response.status, 403)
    assert.equal(response.headers.has('access-control-allow-origin'), false)
  }
  const preflight = new Request(ORIGIN + '/api/feedback', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://pinguarmy.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  })
  assert.equal((await worker.fetch(preflight, env)).status, 204)
  assert.equal((await worker.fetch(request('/api/feedback', { origin: ORIGIN }), env)).status, 201)
  assert.equal(
    (await worker.fetch(request('/api/feedback', { type: 'text/plain' }), env)).status,
    415
  )
  assert.equal(
    (await worker.fetch(request('/api/feedback', { body: ' '.repeat(8193) }), env)).status,
    413
  )
  assert.equal((await worker.fetch(request('/api/feedback', { body: '{' }), env)).status, 400)
  for (const patch of [
    { id: 'not-a-uuid' },
    { reasons: ['not allowed'] },
    { reasons: [], text: '  ' },
    { text: 'x'.repeat(601) },
    { locale: 'ko' }
  ]) {
    assert.equal(
      (await worker.fetch(request('/api/feedback', { body: { ...data(), ...patch } }), env)).status,
      400
    )
  }
  sqlite.close()
})

test('honeypot returns success but never 201 or saves; DB failures never claim saved', async () => {
  const { env, sqlite } = setup()
  const response = await worker.fetch(
    request('/api/feedback', { body: { ...data(), honeypot: 'bot' } }),
    env
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 0)
  env.DB.prepare = () => {
    throw Error('SQL failure with private content')
  }
  const failed = await worker.fetch(request('/api/feedback'), env)
  assert.equal(failed.status, 503)
  assert.deepEqual(await failed.json(), { ok: false, error: 'service_unavailable' })
  sqlite.close()
})

test('atomic counter limits are 10/hour per IP and 300/day globally', async () => {
  const { env, sqlite } = setup()
  for (let i = 0; i < 10; i++)
    assert.equal((await worker.fetch(request('/api/feedback'), env)).status, 201)
  assert.equal((await worker.fetch(request('/api/feedback'), env)).status, 429)
  for (let i = 10; i < 300; i++)
    assert.equal(
      (await worker.fetch(request('/api/feedback', { ip: '192.0.2.' + (i + 1) }), env)).status,
      201
    )
  assert.equal(
    (await worker.fetch(request('/api/feedback', { ip: '192.0.2.255' }), env)).status,
    429
  )
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 300)
  sqlite.close()
})

test('admin authentication, private list, same-origin status changes and logout', async () => {
  const { env, sqlite } = setup()
  const body = data()
  await worker.fetch(request('/api/feedback', { body }), env)
  const unauthenticated = await worker.fetch(
    request('/api/admin/feedback', { method: 'GET', origin: null }),
    env
  )
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.headers.has('access-control-allow-origin'), false)
  const landing = await worker.fetch(request('/admin', { method: 'GET', origin: null }), env)
  assert.ok((await landing.text()).includes('type="password"'))
  const cookie = await login(env)
  const list = await worker.fetch(
    request('/api/admin/feedback', { method: 'GET', origin: ORIGIN, cookie }),
    env
  )
  assert.equal((await list.json()).feedback.length, 1)
  const admin = await worker.fetch(request('/admin', { method: 'GET', origin: null, cookie }), env)
  const html = await admin.text()
  assert.ok(html.includes('text.textContent=item.text'))
  assert.ok(!html.includes('innerHTML'))
  assert.ok(admin.headers.get('content-security-policy').includes("frame-ancestors 'none'"))
  const external = await worker.fetch(
    request('/api/admin/feedback/' + body.id, {
      method: 'PATCH',
      body: { status: 'read' },
      cookie
    }),
    env
  )
  assert.equal(external.status, 403)
  assert.equal(external.headers.has('access-control-allow-origin'), false)
  assert.equal(
    (
      await worker.fetch(
        request('/api/admin/feedback/' + body.id, {
          method: 'PATCH',
          origin: ORIGIN,
          body: { status: 'read' },
          cookie
        }),
        env
      )
    ).status,
    200
  )
  assert.equal(sqlite.prepare('SELECT status FROM feedback').get().status, 'read')
  const logout = await worker.fetch(request('/api/logout', { origin: ORIGIN, cookie }), env)
  assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'))
  for (const required of ['HttpOnly', 'Secure', 'SameSite=Strict'])
    assert.ok(logout.headers.get('set-cookie').includes(required))
  assert.equal(
    (
      await worker.fetch(
        request('/api/admin/feedback', {
          method: 'GET',
          origin: ORIGIN,
          cookie: cookie + 'tamper'
        }),
        env
      )
    ).status,
    401
  )
  sqlite.close()
})

test('password attempts throttle at ten; constant-loop comparison rejects changes', async () => {
  const { env, sqlite } = setup()
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await worker.fetch(
          request('/api/login', { origin: ORIGIN, body: { password: 'bad' } }),
          env
        )
      ).status,
      401
    )
  assert.equal(
    (
      await worker.fetch(
        request('/api/login', { origin: ORIGIN, body: { password: env.ADMIN_PASSWORD } }),
        env
      )
    ).status,
    429
  )
  assert.equal(equalStrings('a'.repeat(64), 'a'.repeat(64)), true)
  assert.equal(equalStrings('a'.repeat(64), 'a'.repeat(63) + 'b'), false)
  sqlite.close()
})

test('admin session expires after eight hours and listing is bounded to 100', async () => {
  const { env, sqlite } = setup()
  const cookie = await login(env)
  const insert = sqlite.prepare(
    'INSERT INTO feedback (id, reasons, text, locale, status, created_at) VALUES (?,?,?,?,?,?)'
  )
  const now = Math.floor(Date.now() / 1000)
  for (let i = 0; i < 105; i++)
    insert.run(crypto.randomUUID(), '[]', String(i), 'en', 'new', now + i)
  const response = await worker.fetch(
    request('/api/admin/feedback', { method: 'GET', origin: ORIGIN, cookie }),
    env
  )
  const rows = (await response.json()).feedback
  assert.equal(rows.length, 100)
  assert.equal(rows[0].text, '104')
  const originalNow = Date.now
  try {
    Date.now = () => originalNow() + 8 * 3600 * 1000 + 1000
    assert.equal(
      (
        await worker.fetch(
          request('/api/admin/feedback', { method: 'GET', origin: ORIGIN, cookie }),
          env
        )
      ).status,
      401
    )
  } finally {
    Date.now = originalNow
  }
  sqlite.close()
})

test('malformed admin changes, foreign login and missing configuration fail closed', async () => {
  const { env, sqlite } = setup()
  assert.equal(
    (await worker.fetch(request('/api/login', { body: { password: env.ADMIN_PASSWORD } }), env))
      .status,
    403
  )
  const cookie = await login(env)
  assert.equal(
    (
      await worker.fetch(
        request('/api/admin/feedback/' + crypto.randomUUID(), {
          origin: ORIGIN,
          method: 'PATCH',
          cookie,
          body: { status: 'other' }
        }),
        env
      )
    ).status,
    400
  )
  assert.equal(
    (
      await worker.fetch(
        request('/api/admin/feedback/' + crypto.randomUUID(), {
          origin: ORIGIN,
          method: 'PATCH',
          cookie,
          body: { status: 'read' }
        }),
        env
      )
    ).status,
    404
  )
  const preflight = new Request(ORIGIN + '/api/feedback', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://pinguarmy.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization'
    }
  })
  assert.equal((await worker.fetch(preflight, env)).status, 403)
  assert.equal(
    (await worker.fetch(request('/api/feedback'), { ...env, FEEDBACK_SECRET: '' })).status,
    503
  )
  sqlite.close()
})

test('scheduled removes old feedback and expired anonymous counters', async () => {
  const { env, sqlite } = setup()
  const now = Math.floor(Date.now() / 1000)
  sqlite
    .prepare(
      'INSERT INTO feedback (id, reasons, text, locale, status, created_at) VALUES (?,?,?,?,?,?)'
    )
    .run(crypto.randomUUID(), '[]', 'old', 'en', 'new', now - 181 * 86400)
  sqlite.prepare('INSERT INTO rate_limits VALUES (?,?,?)').run('expired-hash', 1, now - 1)
  await worker.scheduled({}, env)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM rate_limits').get().n, 0)
  sqlite.close()
})
