import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  analyzeConversationIntegrity,
  isConversationExportable,
  isTranscriptVerified
} from '../../src/core/conversation-integrity'
import { conversationToMarkdown } from '../../src/core/export-markdown'
import { buildExportOptions } from '../../src/core/export-options'
import type { Conversation } from '../../src/core/types'

type CanaryModule = typeof import('../../scripts/lib/provider-canary.mjs')
let canary: CanaryModule

const repoRoot = path.resolve(__dirname, '..', '..')
const SECRET_TITLE = 'Quarterly layoffs plan for Acme'
const SECRET_USER = 'My password is hunter2-correct-horse and the AWS key AKIAABCDEFGHIJKLMNOP'
const SECRET_ASSISTANT = 'Sure, bearer token sk-live-9f8e7d6c5b4a3 should be rotated immediately'
const SECRET_ID = 'conv-7a1b2c3d-secret-0001'
const SECRET_URL = 'https://chatgpt.com/c/conv-7a1b2c3d-secret-0001'

beforeAll(async () => {
  canary = await import('../../scripts/lib/provider-canary.mjs')
})

const deps = () => ({
  analyzeConversationIntegrity,
  isConversationExportable,
  isTranscriptVerified
})

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: SECRET_ID,
    title: SECRET_TITLE,
    url: SECRET_URL,
    platform: 'chatgpt',
    source: 'api',
    sourceCompleteness: 'verified',
    verification: {
      provider: 'chatgpt',
      source: 'api',
      transcript: {
        verified: true,
        method: 'provider-api-complete',
        reasons: ['source_verified']
      },
      capturedAt: 1_700_000_000_000
    },
    messages: [
      { id: 'm-secret-1', role: 'user', content: SECRET_USER },
      { id: 'm-secret-2', role: 'assistant', content: SECRET_ASSISTANT },
      { id: 'm-secret-3', role: 'user', content: 'Thanks, one more follow up question here' },
      { id: 'm-secret-4', role: 'assistant', content: 'Here is the follow up answer you wanted' }
    ],
    ...overrides
  }
}

function fullReport() {
  const conv = conversation()
  const detail = canary.evaluateConversation(conv, deps(), {
    provider: 'chatgpt',
    requireVerified: true
  })
  const markdown = canary.evaluateMarkdown(
    conv,
    conversationToMarkdown(conv, buildExportOptions('markdown'))
  )
  const items = [
    { id: SECRET_ID, title: SECRET_TITLE, url: SECRET_URL, platform: 'chatgpt', updatedAt: 5 }
  ]
  const first = canary.evaluateListFirstPage(items, { source: 'api', complete: true }, 'chatgpt')
  const paging = canary.evaluateListPagination(
    items,
    { source: 'api', complete: true, pagesFetched: 1 },
    'chatgpt'
  )
  return canary.buildReport({
    extensionVersion: '1.5.0',
    generatedAt: '2026-01-02T03:04:05.000Z',
    requested: ['chatgpt', 'claude'],
    providers: [
      {
        provider: 'chatgpt',
        loggedIn: true,
        checks: [
          { name: 'session', status: 'PASS', durationMs: 4 },
          { name: 'list_first_page', status: 'PASS', durationMs: 120, ...first },
          { name: 'list_pagination', status: 'PASS', durationMs: 3, ...paging },
          { name: 'detail_fetch', status: 'PASS', durationMs: 900, ...detail },
          { name: 'markdown_export', status: 'PASS', durationMs: 7, ...markdown }
        ]
      },
      {
        provider: 'claude',
        loggedIn: false,
        checks: [
          { name: 'detect_home', status: 'SKIPPED', reason: 'not_logged_in', durationMs: 0 },
          { name: 'session', status: 'SKIPPED', reason: 'not_logged_in', durationMs: 0 }
        ]
      }
    ]
  })
}

describe('provider canary argument handling', () => {
  it('refuses to run without a profile directory', () => {
    expect(() => canary.parseArgs([])).toThrow(/--profile <dir> is required/)
    expect(() => canary.parseArgs(['--out', '/tmp/o'])).toThrow(/--profile <dir> is required/)
  })

  it('requires an output directory unless in setup mode', () => {
    expect(() => canary.parseArgs(['--profile', '/tmp/p'])).toThrow(/--out/)
    expect(canary.parseArgs(['--profile', '/tmp/p', '--setup']).setup).toBe(true)
  })

  it('parses providers, conversations and numeric options', () => {
    const options = canary.parseArgs([
      '--profile',
      '/tmp/p',
      '--out=/tmp/o',
      '--providers',
      'claude,chatgpt,claude',
      '--conversation',
      'claude=https://claude.ai/chat/abc',
      '--timeout-ms',
      '5000',
      '--require-all'
    ])
    expect(options.providers).toEqual(['claude', 'chatgpt'])
    expect(options.conversations.claude).toBe('https://claude.ai/chat/abc')
    expect(options.timeoutMs).toBe(5000)
    expect(options.requireAll).toBe(true)
  })

  it('rejects unknown providers, non-provider URLs and unselected targets without echoing the URL', () => {
    expect(() => canary.parseArgs(['--profile', 'p', '--out', 'o', '--providers', 'bing'])).toThrow(
      /Unknown provider/
    )
    const bad = 'https://evil.example/c/conv-secret-xyz?token=abc'
    let message = ''
    try {
      canary.parseArgs(['--profile', 'p', '--out', 'o', '--conversation', `chatgpt=${bad}`])
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/must be an https URL/)
    expect(message).not.toContain('evil.example')
    expect(message).not.toContain('conv-secret-xyz')
    expect(() =>
      canary.parseArgs([
        '--profile',
        'p',
        '--out',
        'o',
        '--conversation',
        'chatgpt=http://chatgpt.com/c/1'
      ])
    ).toThrow(/https URL/)
    expect(() =>
      canary.parseArgs([
        '--profile',
        'p',
        '--out',
        'o',
        '--providers',
        'claude',
        '--conversation',
        'chatgpt=https://chatgpt.com/c/1'
      ])
    ).toThrow(/not in --providers/)
    expect(() => canary.parseArgs(['--profile', 'p', '--out', 'o', '--bogus'])).toThrow(
      /Unknown option/
    )
    expect(() => canary.parseArgs(['--profile', 'p', '--out', 'o', '--timeout-ms', 'abc'])).toThrow(
      /positive integer/
    )
  })
})

describe('provider canary profile and output guards', () => {
  let tmp: string
  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'canary-guard-'))
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('accepts an existing dedicated profile and never creates one outside setup', () => {
    const profile = path.join(tmp, 'profile')
    mkdirSync(profile)
    expect(canary.validateProfileDir(profile, { repoRoot })).toBe(profile)
    expect(() => canary.validateProfileDir(path.join(tmp, 'missing'), { repoRoot })).toThrow(
      /does not exist/
    )
    expect(canary.validateProfileDir(path.join(tmp, 'missing'), { repoRoot, setup: true })).toBe(
      path.join(tmp, 'missing')
    )
  })

  it('refuses profiles inside the repository, everyday browser dirs, files and locked profiles', () => {
    expect(() =>
      canary.validateProfileDir(path.join(repoRoot, 'tmp-profile'), { repoRoot })
    ).toThrow(/outside this repository/)
    expect(() =>
      canary.validateProfileDir('/home/someone/.config/google-chrome/Default', {
        repoRoot,
        fs: { existsSync: () => true, statSync: () => ({ isDirectory: () => true }) }
      })
    ).toThrow(/everyday browser profile/)
    const file = path.join(tmp, 'a-file')
    writeFileSync(file, 'x')
    expect(() => canary.validateProfileDir(file, { repoRoot })).toThrow(/not a directory/)
    const locked = path.join(tmp, 'locked')
    mkdirSync(locked)
    writeFileSync(path.join(locked, 'SingletonLock'), '')
    expect(() => canary.validateProfileDir(locked, { repoRoot })).toThrow(/appears to be open/)
  })

  it('keeps reports out of the profile directory', () => {
    const profile = path.join(tmp, 'profile')
    expect(() => canary.validateOutDir(path.join(profile, 'out'), { profileDir: profile })).toThrow(
      /inside the profile/
    )
    expect(canary.validateOutDir(path.join(tmp, 'out'), { profileDir: profile })).toBe(
      path.join(tmp, 'out')
    )
  })
})

describe('provider canary CLI startup (no browser, no login)', () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'provider-canary.mjs'), ...args], {
      encoding: 'utf8',
      timeout: 30_000
    })

  it('refuses to run without --profile and exits 2', () => {
    const result = run(['--out', os.tmpdir()])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--profile <dir> is required')
  })

  it('refuses a missing profile directory before launching anything', () => {
    const result = run([
      '--profile',
      path.join(os.tmpdir(), 'canary-does-not-exist-xyz'),
      '--out',
      os.tmpdir()
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('profile directory does not exist')
  })

  it('prints usage for --help and exits 0', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('npm run canary:providers')
    expect(result.stdout).toContain('Never run this in CI')
  })
})

describe('provider canary invariant checker', () => {
  it('passes a verified, alternating conversation and reports shape only', () => {
    const result = canary.evaluateConversation(conversation(), deps(), {
      provider: 'chatgpt',
      requireVerified: true
    })
    expect(result.failed).toEqual([])
    expect(result.metrics).toMatchObject({
      messageCount: 4,
      userCount: 2,
      assistantCount: 2,
      systemCount: 0,
      alternating: true,
      roleSwitches: 3,
      maxRoleRun: 1,
      firstRole: 'user',
      lastRole: 'assistant',
      integrityStatus: 'complete',
      transcriptVerified: 'yes',
      source: 'api'
    })
  })

  it('names the failed invariant for each defect', () => {
    const wrongPlatform = canary.evaluateConversation(
      conversation({ platform: 'claude' }),
      deps(),
      {
        provider: 'chatgpt'
      }
    )
    expect(wrongPlatform.failed).toContain('platform_mismatch')

    const empty = canary.evaluateConversation(conversation({ messages: [] }), deps(), {
      provider: 'chatgpt'
    })
    expect(empty.failed).toEqual(expect.arrayContaining(['messages_missing', 'not_exportable']))

    const dup = canary.evaluateConversation(
      conversation({
        messages: [
          { id: 'same', role: 'user', content: 'hello there' },
          { id: 'same', role: 'assistant', content: 'general kenobi' }
        ]
      }),
      deps(),
      { provider: 'chatgpt' }
    )
    expect(dup.failed).toContain('message_ids_not_unique')

    const unverified = conversation({
      sourceCompleteness: 'unverified',
      verification: {
        provider: 'chatgpt',
        source: 'dom',
        transcript: { verified: false, method: 'dom-unverified', reasons: ['source_unverified'] },
        capturedAt: 1
      }
    })
    const result = canary.evaluateConversation(unverified, deps(), {
      provider: 'chatgpt',
      requireVerified: true
    })
    expect(result.failed).toEqual(
      expect.arrayContaining(['not_exportable', 'transcript_unverified'])
    )
    expect(result.metrics.transcriptVerified).toBe('no')
    expect(result.metrics.reasonCodes).toContain('source_unverified')

    expect(canary.evaluateConversation(null, deps(), { provider: 'chatgpt' }).failed).toEqual([
      'conversation_missing'
    ])
  })

  it('accepts a legitimately one-sided verified transcript', () => {
    const result = canary.evaluateConversation(
      conversation({ messages: [{ id: 'a1', role: 'user', content: 'only a prompt so far' }] }),
      deps(),
      { provider: 'chatgpt', requireVerified: true }
    )
    expect(result.failed).toEqual([])
    expect(result.metrics.integrityStatus).toBe('suspicious')
  })

  it('summarizes role runs without any text', () => {
    const shape = canary.summarizeRoles([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'system', content: 'd' }
    ])
    expect(shape).toMatchObject({
      userCount: 2,
      assistantCount: 1,
      systemCount: 1,
      roleSwitches: 2,
      maxRoleRun: 2,
      alternating: false
    })
  })

  it('checks list shape, source and unique IDs', () => {
    const good = [
      { id: 'a-1234567', title: 't', url: 'https://chatgpt.com/c/a-1234567', platform: 'chatgpt' },
      { id: 'b-1234567', title: 't', url: 'https://chatgpt.com/c/b-1234567', platform: 'chatgpt' }
    ]
    expect(canary.evaluateListFirstPage(good, { source: 'api' }, 'chatgpt').failed).toEqual([])
    const bad = [
      good[0],
      good[0],
      { id: '', title: 't', url: 'https://evil.example/x', platform: 'chatgpt' }
    ]
    expect(canary.evaluateListFirstPage(bad, { source: 'sidebar' }, 'chatgpt').failed).toEqual(
      expect.arrayContaining([
        'list_item_shape_invalid',
        'list_ids_not_unique',
        'list_not_from_api'
      ])
    )
    expect(canary.evaluateListFirstPage([], { source: 'api' }, 'chatgpt').failed).toContain(
      'list_empty'
    )
  })

  it('judges the pagination boundary', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `id-${i}`,
        url: `https://chatgpt.com/c/id-${i}`,
        platform: 'chatgpt'
      }))
    // 100 items = exact multiple: the parser needs one extra (empty) page.
    expect(
      canary.evaluateListPagination(make(100), { complete: true, pagesFetched: 2 }, 'chatgpt')
        .failed
    ).toEqual([])
    expect(
      canary.evaluateListPagination(make(100), { complete: true, pagesFetched: 1 }, 'chatgpt')
        .failed
    ).toEqual([])
    expect(
      canary.evaluateListPagination(make(101), { complete: true, pagesFetched: 2 }, 'chatgpt')
    ).toMatchObject({ failed: [], metrics: { lastPageItems: 1, paginationTerminated: true } })
    expect(
      canary.evaluateListPagination(make(101), { complete: true, pagesFetched: 1 }, 'chatgpt')
        .failed
    ).toEqual(expect.arrayContaining(['page_count_inconsistent_with_total']))
    expect(
      canary.evaluateListPagination(make(10), { complete: false, pagesFetched: 1 }, 'chatgpt')
        .failed
    ).toContain('pagination_not_terminated')
  })

  it('detects order disagreement between DOM parse and API detail, and skips same-source', () => {
    const api = conversation()
    expect(canary.evaluateOrderAgreement(api, api, { parseSource: 'api' }).skipped).toBe(
      'parse_source_is_api'
    )
    expect(
      canary.evaluateOrderAgreement(api, conversation(), { parseSource: 'dom' }).failed
    ).toEqual([])
    const shuffled = conversation({
      messages: [...api.messages].reverse()
    })
    const swapped = canary.evaluateOrderAgreement(shuffled, api, { parseSource: 'dom' })
    expect(swapped.failed).toEqual(
      expect.arrayContaining(['role_sequence_differs', 'content_order_mismatch'])
    )
    const truncated = conversation({ messages: api.messages.slice(0, 2) })
    expect(canary.evaluateOrderAgreement(truncated, api, { parseSource: 'dom' }).failed).toContain(
      'message_count_differs'
    )
  })

  it('checks the in-memory Markdown export', () => {
    const conv = conversation()
    const md = conversationToMarkdown(conv, buildExportOptions('markdown'))
    expect(canary.evaluateMarkdown(conv, md).failed).toEqual([])
    expect(canary.evaluateMarkdown(conv, '').failed).toContain('markdown_empty')
    expect(canary.evaluateMarkdown(conv, 'x'.repeat(20)).failed).toContain('markdown_content_loss')
  })

  it('classifies logged-out locations and picks the most recent item', () => {
    expect(canary.isLoggedOutLocation('claude', 'https://claude.ai/login?returnTo=%2F')).toBe(true)
    expect(canary.isLoggedOutLocation('claude', 'https://claude.ai/recents')).toBe(false)
    expect(canary.isLoggedOutLocation('gemini', 'https://accounts.google.com/v3/signin')).toBe(true)
    expect(canary.isLoggedOutLocation('chatgpt', 'https://elsewhere.example/')).toBe(true)
    const pick = canary.pickMostRecent([
      { id: 'old', updatedAt: 1 },
      { id: 'new', updatedAt: 9 },
      { id: 'mid', createdAt: 5 }
    ])
    expect(pick?.id).toBe('new')
  })
})

describe('provider canary report and redaction layer', () => {
  it('never contains conversation text, titles, IDs or URLs', () => {
    const report = fullReport()
    const json = JSON.stringify(report)
    const table = canary.renderTable(report)
    for (const secret of [
      SECRET_TITLE,
      SECRET_USER,
      SECRET_ASSISTANT,
      SECRET_ID,
      SECRET_URL,
      'hunter2',
      'AKIAABCDEFGHIJKLMNOP',
      'sk-live',
      'm-secret',
      'chatgpt.com/c/'
    ]) {
      expect(json).not.toContain(secret)
      expect(table).not.toContain(secret)
    }
    const privates = canary.collectPrivateStrings({
      conversations: [conversation()],
      listItems: [{ id: SECRET_ID, title: SECRET_TITLE, url: SECRET_URL }]
    })
    expect(privates.length).toBeGreaterThan(5)
    expect(() => canary.assertNoPrivateStrings(json + table, privates)).not.toThrow()
  })

  it('drops unknown metric keys and malformed values instead of passing them through', () => {
    const report = canary.buildReport({
      extensionVersion: '1.5.0 with secret',
      providers: [
        {
          provider: 'chatgpt',
          loggedIn: true,
          checks: [
            {
              name: 'detail_fetch',
              status: 'FAIL',
              reason: `Secret Title ${SECRET_TITLE}`,
              failed: ['messages_missing', SECRET_TITLE, 'Mixed Case', SECRET_ID],
              errorClass: `TypeError: ${SECRET_USER}`,
              metrics: {
                title: SECRET_TITLE,
                messageCount: 3,
                firstRole: SECRET_USER,
                lastRole: 'assistant',
                integrityStatus: 'complete',
                reasonCodes: ['source_verified', SECRET_ASSISTANT],
                verificationMethod: SECRET_TITLE,
                alternating: 'yes',
                totalItems: -4
              },
              url: SECRET_URL,
              token: 'sk-live-9f8e7d6c5b4a3'
            }
          ]
        },
        { provider: SECRET_TITLE, loggedIn: 'maybe', checks: [] }
      ]
    })
    const json = JSON.stringify(report)
    for (const secret of [
      SECRET_TITLE,
      SECRET_USER,
      SECRET_ASSISTANT,
      SECRET_ID,
      SECRET_URL,
      'sk-live'
    ]) {
      expect(json).not.toContain(secret)
    }
    const check = report.providers[0].checks[0]
    expect(report.extensionVersion).toBe('unknown')
    expect(check.reason).toBe('unclassified_reason')
    expect(check.failed).toEqual(['messages_missing'])
    expect(check.errorClass).toBe('Error')
    expect(check.metrics).toEqual({
      messageCount: 3,
      lastRole: 'assistant',
      integrityStatus: 'complete',
      reasonCodes: ['source_verified', 'other_reason_code']
    })
    expect(report.providers[1]).toMatchObject({ provider: 'unknown', loggedIn: null })
  })

  it('only emits invariant names and reason codes from the closed vocabularies', () => {
    const bad = conversation({
      platform: 'claude',
      sourceCompleteness: 'unverified',
      messages: [
        { id: 'x', role: 'user', content: 'dup one' },
        { id: 'x', role: 'user', content: 'dup two' }
      ],
      verification: {
        provider: 'chatgpt',
        source: 'dom',
        transcript: { verified: false, method: 'dom-unverified', reasons: ['source_unverified'] },
        capturedAt: 1
      }
    })
    const emitted = [
      ...canary.evaluateConversation(bad, deps(), { provider: 'chatgpt', requireVerified: true })
        .failed,
      ...canary.evaluateConversation(null, deps(), { provider: 'chatgpt' }).failed,
      ...canary.evaluateListFirstPage('nope', {}, 'chatgpt').failed,
      ...canary.evaluateListFirstPage([], { source: 'sidebar' }, 'chatgpt').failed,
      ...canary.evaluateListPagination([], {}, 'chatgpt').failed,
      ...canary.evaluateOrderAgreement(bad, conversation(), { parseSource: 'dom' }).failed,
      ...canary.evaluateMarkdown(bad, '').failed
    ]
    expect(emitted.length).toBeGreaterThan(8)
    for (const code of emitted) expect(canary.INVARIANT_CODES.has(code)).toBe(true)
    const reasons = canary.evaluateConversation(bad, deps(), { provider: 'chatgpt' }).metrics
      .reasonCodes
    for (const code of reasons ?? []) expect(canary.PROVIDER_REASON_CODES.has(code)).toBe(true)
  })

  it('always names an invariant for a failure', () => {
    const report = canary.buildReport({
      extensionVersion: '1.5.0',
      providers: [{ provider: 'grok', checks: [{ name: 'current_parse', status: 'FAIL' }] }]
    })
    expect(report.providers[0].checks[0].reason).toBe('unspecified_failure')
  })

  it('privacy guard trips (without naming the value) when output contains conversation text', () => {
    const privates = canary.collectPrivateStrings({ conversations: [conversation()] })
    let message = ''
    try {
      canary.assertNoPrivateStrings(`leak: ${SECRET_ASSISTANT}`, privates)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/privacy guard tripped/)
    expect(message).not.toContain('sk-live')
    expect(() => canary.assertNoPrivateStrings(`leak: ${SECRET_ID}`, privates)).toThrow()
    // Public vocabulary is never treated as private even if a title equals it.
    const vocab = canary.collectPrivateStrings({ listItems: [{ title: 'chatgpt', id: 'claude' }] })
    expect(vocab).toEqual([])
  })

  it('maps errors to classes and fixed codes, never messages', () => {
    expect(canary.errorClassOf(new TypeError('secret'))).toBe('TypeError')
    expect(canary.errorClassOf({ name: 'weird name with secret' })).toBe('Error')
    expect(canary.errorClassOf('string')).toBe('Error')
    expect(canary.classifyResponseError('429 Too many requests for abc')).toBe('rate_limited')
    expect(canary.classifyResponseError('Please sign in to continue')).toBe('auth_required')
    expect(canary.classifyResponseError('could not be verified, silent data loss')).toBe(
      'source_unverified'
    )
    expect(canary.classifyResponseError('something with private text')).toBe('provider_error')
  })

  it('computes provider status, SKIPPED handling and exit codes', () => {
    const report = fullReport()
    expect(report.providers.map(p => p.status)).toEqual(['PASS', 'SKIPPED'])
    expect(report.summary).toMatchObject({
      pass: 1,
      fail: 0,
      skipped: 1,
      liveTested: ['chatgpt'],
      notLiveTested: ['claude']
    })
    expect(canary.computeExitCode(report)).toBe(0)
    expect(canary.computeExitCode(report, { requireAll: true })).toBe(3)

    const failing = canary.buildReport({
      extensionVersion: '1.5.0',
      providers: [
        {
          provider: 'chatgpt',
          loggedIn: true,
          checks: [
            { name: 'session', status: 'PASS' },
            { name: 'detail_fetch', status: 'FAIL', failed: ['transcript_unverified'] }
          ]
        },
        {
          provider: 'claude',
          loggedIn: false,
          checks: [{ name: 'session', status: 'SKIPPED', reason: 'not_logged_in' }]
        }
      ]
    })
    expect(failing.providers[0].status).toBe('FAIL')
    expect(canary.computeExitCode(failing)).toBe(1)

    const allSkipped = canary.buildReport({
      extensionVersion: '1.5.0',
      providers: [
        {
          provider: 'claude',
          loggedIn: false,
          checks: [{ name: 'session', status: 'SKIPPED', reason: 'not_logged_in' }]
        }
      ]
    })
    expect(allSkipped.providers[0].status).toBe('SKIPPED')
    expect(allSkipped.summary.liveTested).toEqual([])
  })

  it('renders a short table from the sanitized report', () => {
    const table = canary.renderTable(fullReport())
    expect(table).toContain('PROVIDER')
    expect(table).toMatch(/chatgpt\s+detail_fetch\s+PASS/)
    expect(table).toMatch(/claude\s+\(overall\)\s+SKIPPED\s+not_logged_in/)
    expect(table).toContain('Not live-tested: claude')
    expect(table).toContain('PASS is evidence for that provider only')
  })
})
