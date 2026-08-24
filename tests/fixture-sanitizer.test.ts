import { beforeAll, describe, expect, it } from 'vitest'

let sanitizeCapture: any
let schemaFingerprint: any
let scanForResidualSecrets: any

beforeAll(async () => {
  ;({ sanitizeCapture, schemaFingerprint, scanForResidualSecrets } = await import(
    '../scripts/sanitize-provider-fixture.mjs'
  ))
})

describe('provider fixture sanitizer', () => {
  it('redacts token, cookie, session and authorization keys', () => {
    const fixture = sanitizeCapture(
      {
        accessToken: 'secret-token-value',
        cookie: 'session=abc123',
        sessionKey: 'xyz',
        authorization: 'Bearer abcdefghij',
        csrf_token: 'csrf-value',
        api_key: 'key-value',
        role: 'assistant',
      },
      { provider: 'chatgpt' }
    )
    const payload = fixture.payload as Record<string, unknown>
    expect(payload.accessToken).toBe('[redacted]')
    expect(payload.cookie).toBe('[redacted]')
    expect(payload.sessionKey).toBe('[redacted]')
    expect(payload.authorization).toBe('[redacted]')
    expect(payload.csrf_token).toBe('[redacted]')
    expect(payload.api_key).toBe('[redacted]')
    expect(payload.role).toBe('assistant')
    expect(JSON.stringify(payload)).not.toContain('secret-token-value')
  })

  it('redacts email addresses', () => {
    const fixture = sanitizeCapture({ email: 'real.person@example.com' }, { provider: 'claude' })
    const email = (fixture.payload as Record<string, unknown>).email as string
    expect(email).not.toContain('real.person')
    expect(email).toMatch(/^user_[0-9a-f]{8}@example\.invalid$/)
  })

  it('maps the same original ID to the same pseudonym everywhere', () => {
    const fixture = sanitizeCapture(
      {
        conversation_id: 'conv-abc123def456',
        message: { id: 'msg-abc123def456', conversation_id: 'conv-abc123def456' },
      },
      { provider: 'grok' }
    )
    const payload = fixture.payload as {
      conversation_id: string
      message: { id: string; conversation_id: string }
    }
    expect(payload.conversation_id).toMatch(/^id_[0-9a-f]{8}$/)
    expect(payload.message.conversation_id).toBe(payload.conversation_id)
    expect(payload.message.id).toMatch(/^id_[0-9a-f]{8}$/)
    expect(payload.message.id).not.toBe(payload.conversation_id)
  })

  it('keeps a ChatGPT-style mapping graph internally consistent', () => {
    const root = '11111111-1111-4111-8111-111111111111'
    const child = '22222222-2222-4222-8222-222222222222'
    const fixture = sanitizeCapture(
      {
        mapping: {
          [root]: {
            id: root,
            parent: null,
            children: [child],
            message: { content: { parts: ['private user text'] } },
          },
          [child]: {
            id: child,
            parent: root,
            children: [],
            message: { content: { parts: ['private assistant text'] } },
          },
        },
        current_node: child,
      },
      { provider: 'chatgpt' }
    )
    const mapping = (fixture.payload as { mapping: Record<string, any> }).mapping
    const keys = Object.keys(mapping)
    expect(keys).toHaveLength(2)
    const [newRoot, newChild] = keys
    // Node keys were pseudonymized, not leaked.
    expect(newRoot).not.toBe(root)
    expect(newChild).not.toBe(child)
    // References resolve: child.parent points at the root key, root.children at the child key.
    expect(mapping[newChild].parent).toBe(newRoot)
    expect(mapping[newRoot].children).toEqual([newChild])
    expect(mapping[newRoot].id).toBe(newRoot)
    expect(mapping[newChild].id).toBe(newChild)
    // Message text was replaced.
    expect(mapping[newRoot].message.content.parts[0]).toMatch(/^Synthetic message \d+$/)
    expect(JSON.stringify(fixture.payload)).not.toContain('private user text')
  })

  it('preserves array lengths and key names', () => {
    const fixture = sanitizeCapture(
      {
        items: [
          { id: 'aaaaaaaaaaaaaaaa1', role: 'user' },
          { id: 'bbbbbbbbbbbbbbbb2', role: 'assistant' },
          { id: 'cccccccccccccccc3', role: 'user' },
        ],
        total: 3,
        has_more: false,
      },
      { provider: 'deepseek' }
    )
    const payload = fixture.payload as { items: unknown[]; total: number; has_more: boolean }
    expect(Object.keys(payload)).toEqual(['items', 'total', 'has_more'])
    expect(payload.items).toHaveLength(3)
    expect(payload.total).toBe(3)
    expect(payload.has_more).toBe(false)
    expect(Object.keys(payload.items[0] as object)).toEqual(['id', 'role'])
  })

  it('replaces message text under content-ish keys without leaking it', () => {
    const secret = 'my very private question about health'
    const fixture = sanitizeCapture(
      {
        messages: [
          { text: secret },
          { content: 'assistant private answer' },
          { parts: ['part one', 'part two'] },
        ],
      },
      { provider: 'claude' }
    )
    const payload = fixture.payload as { messages: Array<Record<string, unknown>> }
    expect(payload.messages[0].text).toMatch(/^Synthetic message \d+$/)
    expect(payload.messages[1].content).toMatch(/^Synthetic message \d+$/)
    expect(payload.messages[2].parts).toEqual([
      expect.stringMatching(/^Synthetic message \d+$/),
      expect.stringMatching(/^Synthetic message \d+$/),
    ])
    expect(JSON.stringify(fixture.payload)).not.toContain(secret)
  })

  it('replaces URLs with example.invalid pseudonyms and drops attachment keys', () => {
    const fixture = sanitizeCapture(
      {
        url: 'https://chatgpt.com/c/conv-abc123def456',
        attachments: [{ url: 'https://files.example.com/private.pdf' }],
        avatar_url: 'https://example.com/avatar.png',
      },
      { provider: 'chatgpt' }
    )
    const payload = fixture.payload as Record<string, any>
    expect(payload.url).toMatch(/^https:\/\/example\.invalid\/[0-9a-f]{8}$/)
    expect(payload.avatar_url).toMatch(/^https:\/\/example\.invalid\/[0-9a-f]{8}$/)
    expect('attachments' in payload).toBe(false)
    expect(JSON.stringify(fixture.payload)).not.toContain('private.pdf')
  })

  it('pseudonymizes organization and account identifiers', () => {
    const fixture = sanitizeCapture(
      {
        organization_id: '33333333-3333-4333-8333-333333333333',
        user_id: 'user_abcdef1234567890',
        account: { account_id: 'acct_abcdef1234567890' },
      },
      { provider: 'claude' }
    )
    const payload = fixture.payload as Record<string, any>
    expect(payload.organization_id).toMatch(/^id_[0-9a-f]{8}$/)
    expect(payload.user_id).toMatch(/^id_[0-9a-f]{8}$/)
    expect(payload.account.account_id).toMatch(/^id_[0-9a-f]{8}$/)
    expect(JSON.stringify(fixture.payload)).not.toContain('33333333-3333')
  })

  it('shifts timestamps to a fixed epoch while preserving order', () => {
    const earlier = 1_750_000_000_000
    const later = 1_760_000_000_000
    const fixture = sanitizeCapture(
      {
        create_time: 1_750_000_000, // unix seconds under a time-ish key
        updated_at: later,
        messages: [{ created: earlier }, { created: later }],
        iso: '2026-01-15T10:30:00.000Z',
      },
      { provider: 'chatgpt' }
    )
    const payload = fixture.payload as any
    expect(payload.messages[0].created).toBeLessThan(payload.messages[1].created)
    expect(payload.updated_at).toBe(payload.messages[1].created)
    expect(payload.create_time).toBeLessThan(payload.updated_at / 1000)
    expect(payload.iso).toMatch(/^2023-11-14T22:1/) // anchored at the fixed epoch
    expect(payload.iso).not.toContain('2026-01-15')
  })

  it('wraps output in the fixture envelope', () => {
    const fixture = sanitizeCapture({ a: 1 }, {
      provider: 'grok',
      scenario: 'branched',
      capturedAt: '2026-08-24',
    })
    expect(fixture.provider).toBe('grok')
    expect(fixture.source).toBe('real-sanitized')
    expect(fixture.scenario).toBe('branched')
    expect(fixture.capturedAt).toBe('2026-08-24')
    expect(fixture.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(fixture.payload).toEqual({ a: 1 })
  })
})

describe('schemaFingerprint', () => {
  it('is deterministic across runs', () => {
    const value = { b: [1, 'two'], a: { c: null } }
    expect(schemaFingerprint(value)).toBe(schemaFingerprint(value))
    expect(schemaFingerprint(value)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores value changes but reacts to key renames', () => {
    const base = { items: [{ id: 'x', role: 'user' }] }
    const sameShape = { items: [{ id: 'y', role: 'assistant' }] }
    const renamed = { items: [{ uuid: 'x', role: 'user' }] }
    expect(schemaFingerprint(base)).toBe(schemaFingerprint(sameShape))
    expect(schemaFingerprint(base)).not.toBe(schemaFingerprint(renamed))
  })
})

describe('scanForResidualSecrets', () => {
  it('detects a planted JWT-shaped string', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const findings = scanForResidualSecrets({ payload: { note: jwt } })
    expect(findings.some(f => f.pattern === 'jwt')).toBe(true)
  })

  it('detects planted api keys, bearer tokens and emails', () => {
    const findings = scanForResidualSecrets({
      key: 'sk-abcdefghijklmnopqrstuvwxyz',
      header: 'Bearer abcdefghijklmnopqrstuvwxyz',
      contact: 'reach me at real@company.org',
    })
    const patterns = findings.map(f => f.pattern)
    expect(patterns).toContain('api-key')
    expect(patterns).toContain('bearer-token')
    expect(patterns).toContain('email')
  })

  it('reports a fully sanitized fixture as clean', () => {
    const fixture = sanitizeCapture(
      {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        email: 'person@realdomain.com',
        url: 'https://chatgpt.com/c/conv-abc123def456',
        text: 'contact me at person@realdomain.com please',
      },
      { provider: 'chatgpt' }
    )
    expect(scanForResidualSecrets(fixture)).toEqual([])
  })
})
