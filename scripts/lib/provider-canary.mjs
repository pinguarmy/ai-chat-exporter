/**
 * Pure logic for the provider canary (scripts/provider-canary.mjs).
 *
 * Nothing in this module touches a browser, the network or a provider
 * session. It holds the argument/profile validation, the invariant checkers,
 * and the report/redaction layer so all of it can be unit-tested with
 * synthetic input.
 *
 * Privacy contract (see AGENTS.md and docs/provider-fixture-privacy.md):
 * the report is rebuilt from an allowlist. Only fixed vocabulary, finite
 * numbers, booleans, enum members and strictly shaped reason codes can reach
 * it. Conversation text, titles, IDs, URLs, account data and raw error
 * messages are never copied, hashed or truncated into it; unknown fields are
 * dropped rather than escaped.
 */
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Provider table
// ---------------------------------------------------------------------------

/**
 * Hosts must mirror `host_permissions` in package.json. `pageSize` is the list
 * page size each parser requests (0 = not asserted here). The canary only
 * ever navigates to these hosts.
 */
export const PROVIDERS = {
  chatgpt: {
    home: 'https://chatgpt.com/',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    matchPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    pageSize: 100,
    loggedOutPath: /^\/(auth|login|log-in)(\/|$)/i,
    authHosts: ['auth.openai.com', 'auth0.openai.com']
  },
  claude: {
    home: 'https://claude.ai/recents',
    hosts: ['claude.ai'],
    matchPatterns: ['https://claude.ai/*'],
    pageSize: 100,
    loggedOutPath: /^\/(login|logout|sign-?in)(\/|$)/i,
    authHosts: []
  },
  gemini: {
    home: 'https://gemini.google.com/app',
    hosts: ['gemini.google.com'],
    matchPatterns: ['https://gemini.google.com/*'],
    pageSize: 25,
    loggedOutPath: /^\/(signin|sign-in)(\/|$)/i,
    authHosts: ['accounts.google.com']
  },
  deepseek: {
    home: 'https://chat.deepseek.com/',
    hosts: ['chat.deepseek.com', 'deepseek.com'],
    matchPatterns: ['https://chat.deepseek.com/*', 'https://deepseek.com/*'],
    pageSize: 100,
    loggedOutPath: /^\/(sign_in|sign-in|login)(\/|$)/i,
    authHosts: []
  },
  grok: {
    home: 'https://grok.com/',
    hosts: ['grok.com', 'www.grok.com'],
    matchPatterns: ['https://grok.com/*', 'https://www.grok.com/*'],
    pageSize: 100,
    loggedOutPath: /^\/(sign-in|sign-up|login)(\/|$)/i,
    authHosts: ['accounts.x.ai']
  }
}

export const PROVIDER_KEYS = Object.keys(PROVIDERS)

export const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', SKIPPED: 'SKIPPED' })

export const EXIT = Object.freeze({
  OK: 0,
  INVARIANT_FAILED: 1,
  USAGE: 2,
  SKIPPED_REQUIRED: 3
})

/** A usage/environment error whose message is written for the terminal and contains no private data. */
export class CanaryUsageError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CanaryUsageError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export const USAGE = `Usage: npm run canary:providers -- --profile <dir> --out <dir> [options]

Required:
  --profile <dir>        Existing, dedicated Chromium profile directory you have
                         logged in to the providers with. Used in place; never copied.
  --out <dir>            Directory for provider-canary-report.json and .txt.

Options:
  --providers a,b,...    Subset of: ${PROVIDER_KEYS.join(', ')} (default: all)
  --conversation p=url   Test this conversation for provider p instead of the most
                         recent one (repeatable). The URL is never printed or stored.
  --extension <dir>      Unpacked extension (default: ai-chat-exporter/ or build/chrome-mv3-prod/).
  --headless             Run headless (providers may block it; headed is the default).
  --timeout-ms <n>       Per-request timeout, default 60000.
  --list-timeout-ms <n>  History-list timeout, default 300000.
  --require-all          Exit non-zero when a requested provider was SKIPPED.
  --setup                Open the selected providers so you can log in to the
                         profile once, then exit when you close the browser.
                         Performs no checks.
  --help                 Show this text.

Exit codes: 0 all logged-in providers passed; 1 an invariant failed;
2 usage or environment error; 3 --require-all and a provider was SKIPPED.
Never run this in CI: it needs your own logged-in browser profile.`

function parseIntOption(name, value, min, max) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    throw new CanaryUsageError('bad_option', `${name} must be a positive integer.`)
  }
  const n = Number(value)
  if (n < min || n > max) {
    throw new CanaryUsageError('bad_option', `${name} must be between ${min} and ${max}.`)
  }
  return n
}

/** Validate a --conversation URL for a provider. Never echoes the URL. */
export function validateConversationUrl(provider, raw) {
  const cfg = PROVIDERS[provider]
  let url
  try {
    url = new URL(raw)
  } catch {
    url = null
  }
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !cfg.hosts.includes(url.hostname)
  ) {
    throw new CanaryUsageError(
      'bad_conversation_url',
      `--conversation for ${provider} must be an https URL on ${cfg.hosts.join(' or ')}. (The value is not echoed.)`
    )
  }
  return url.toString()
}

/**
 * Parse argv (without node/script). Returns the options; throws
 * CanaryUsageError for anything invalid. Error text never contains values of
 * --conversation or --profile.
 */
/**
 * @param {string[]} argv
 * @returns {{ help: boolean, profile: string | null, out: string | null, providers: string[],
 *   conversations: Record<string, string>, extension: string | null, headless: boolean,
 *   timeoutMs: number, listTimeoutMs: number, requireAll: boolean, setup: boolean }}
 */
export function parseArgs(argv) {
  const options = {
    help: false,
    profile: null,
    out: null,
    providers: [...PROVIDER_KEYS],
    conversations: {},
    extension: null,
    headless: false,
    timeoutMs: 60_000,
    listTimeoutMs: 300_000,
    requireAll: false,
    setup: false
  }
  const takeValue = (i, name) => {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new CanaryUsageError('missing_value', `${name} needs a value.`)
    }
    return value
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? splitOnce(arg) : [arg]
    const value = name => {
      if (inline !== undefined) return inline
      const v = takeValue(i, name)
      i++
      return v
    }
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--profile':
        options.profile = value('--profile')
        break
      case '--out':
        options.out = value('--out')
        break
      case '--extension':
        options.extension = value('--extension')
        break
      case '--providers': {
        const list = value('--providers')
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean)
        if (list.length === 0) throw new CanaryUsageError('bad_option', '--providers is empty.')
        for (const key of list) {
          if (!PROVIDER_KEYS.includes(key)) {
            throw new CanaryUsageError(
              'unknown_provider',
              `Unknown provider in --providers. Known: ${PROVIDER_KEYS.join(', ')}.`
            )
          }
        }
        options.providers = [...new Set(list)]
        break
      }
      case '--conversation': {
        const raw = value('--conversation')
        const eq = raw.indexOf('=')
        const provider = eq > 0 ? raw.slice(0, eq).trim().toLowerCase() : ''
        if (!PROVIDER_KEYS.includes(provider)) {
          throw new CanaryUsageError(
            'bad_conversation_option',
            `--conversation must look like <provider>=<url> with provider in: ${PROVIDER_KEYS.join(', ')}.`
          )
        }
        options.conversations[provider] = validateConversationUrl(provider, raw.slice(eq + 1))
        break
      }
      case '--headless':
        options.headless = true
        break
      case '--require-all':
        options.requireAll = true
        break
      case '--setup':
        options.setup = true
        break
      case '--timeout-ms':
        options.timeoutMs = parseIntOption('--timeout-ms', value('--timeout-ms'), 1000, 600_000)
        break
      case '--list-timeout-ms':
        options.listTimeoutMs = parseIntOption(
          '--list-timeout-ms',
          value('--list-timeout-ms'),
          1000,
          3_600_000
        )
        break
      default:
        throw new CanaryUsageError(
          'unknown_option',
          `Unknown option ${JSON.stringify(flag.slice(0, 40))}.`
        )
    }
  }
  if (options.help) return options
  if (!options.profile) {
    throw new CanaryUsageError(
      'profile_required',
      '--profile <dir> is required. The canary refuses to run without an explicit profile directory you have placed in scope.'
    )
  }
  if (!options.setup && !options.out) {
    throw new CanaryUsageError('out_required', '--out <dir> is required.')
  }
  for (const provider of Object.keys(options.conversations)) {
    if (!options.providers.includes(provider)) {
      throw new CanaryUsageError(
        'conversation_provider_not_selected',
        `--conversation targets ${provider}, which is not in --providers.`
      )
    }
  }
  return options
}

function splitOnce(arg) {
  const eq = arg.indexOf('=')
  return [arg.slice(0, eq), arg.slice(eq + 1)]
}

// ---------------------------------------------------------------------------
// Profile / output path guards
// ---------------------------------------------------------------------------

const DEFAULT_BROWSER_DIRS = [
  /[\\/]\.config[\\/](google-chrome[^\\/]*|chromium|microsoft-edge[^\\/]*|BraveSoftware)([\\/]|$)/i,
  /[\\/]\.var[\\/]app[\\/]/i,
  /[\\/]snap[\\/]chromium[\\/]/i,
  /[\\/]Library[\\/]Application Support[\\/](Google[\\/]Chrome|Chromium|Microsoft Edge|BraveSoftware)([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/](Google[\\/]Chrome|Chromium|Microsoft[\\/]Edge|BraveSoftware)([\\/]|$)/i
]

function isInside(child, parent) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function realOrResolved(p) {
  const resolved = path.resolve(p)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

/**
 * Refuse unsafe profile directories. Returns the resolved path.
 * The profile is used in place; this never copies or reads its contents.
 * `fs` is injectable for tests.
 */
/**
 * @param {string} profile
 * @param {{ repoRoot?: string, setup?: boolean, fs?: Record<string, any> }} [opts]
 * @returns {string}
 */
export function validateProfileDir(profile, { repoRoot, setup = false, fs = {} } = {}) {
  const exists = fs.existsSync || existsSync
  const stat = fs.statSync || statSync
  const lstat = fs.lstatSync || lstatSync
  const resolved = realOrResolved(profile)

  if (repoRoot && isInside(resolved, realOrResolved(repoRoot))) {
    throw new CanaryUsageError(
      'profile_inside_repository',
      'The profile directory must be outside this repository (it holds session data that must never be committed).'
    )
  }
  if (isInside(resolved, os.homedir()) && resolved === realOrResolved(os.homedir())) {
    throw new CanaryUsageError(
      'profile_is_home',
      'The profile directory must not be your home directory.'
    )
  }
  if (DEFAULT_BROWSER_DIRS.some(re => re.test(resolved))) {
    throw new CanaryUsageError(
      'profile_is_default_browser_profile',
      'Refusing to drive what looks like your everyday browser profile. Use a dedicated directory and log in to it once with --setup.'
    )
  }
  if (!exists(resolved)) {
    if (setup) return resolved
    throw new CanaryUsageError(
      'profile_missing',
      'The profile directory does not exist. Create a dedicated one and log in with --setup first.'
    )
  }
  if (!stat(resolved).isDirectory()) {
    throw new CanaryUsageError('profile_not_a_directory', 'The profile path is not a directory.')
  }
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    let locked = false
    try {
      lstat(path.join(resolved, lock))
      locked = true
    } catch {
      locked = false
    }
    if (locked) {
      throw new CanaryUsageError(
        'profile_in_use',
        'The profile appears to be open in a browser (Singleton lock present). Close that browser first. If none is running, the lock is stale; remove it yourself.'
      )
    }
  }
  return resolved
}

/** The report directory must not live inside the browser profile. */
/**
 * @param {string} out
 * @param {{ profileDir?: string }} [opts]
 * @returns {string}
 */
export function validateOutDir(out, { profileDir } = {}) {
  const resolved = path.resolve(out)
  if (profileDir && isInside(resolved, profileDir)) {
    throw new CanaryUsageError(
      'out_inside_profile',
      '--out must not be inside the profile directory.'
    )
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Safe vocabulary + redaction primitives
// ---------------------------------------------------------------------------

const ERROR_CLASS_RE = /^(?:[A-Z][A-Za-z0-9]{0,39})?Error$/
const ROLE_ENUM = ['user', 'assistant', 'system', 'none']
const INTEGRITY_ENUM = ['complete', 'suspicious', 'incomplete', 'empty']
const SOURCE_ENUM = ['api', 'dom', 'mixed', 'sidebar', 'unknown']
const VERIFIED_ENUM = ['yes', 'no', 'unknown']
const MAX_CODES = 24
const MAX_INT = 1_000_000_000

/**
 * Closed vocabularies. Free-form strings, even ones shaped like a slug, can be
 * conversation IDs or title fragments, so nothing outside these sets can reach
 * the report. Unknown provider reason codes collapse to 'other_reason_code';
 * unknown invariant names to 'unclassified_reason'. Add new names here (and to
 * the test) when a parser or checker introduces one.
 */
export const PROVIDER_REASON_CODES = new Set([
  'source_verified',
  'source_unverified',
  'page_snapshot_only',
  'flat_authoritative_messages',
  'selected_branch_reaches_root',
  'active_branch_root_chain',
  'active_branch_incomplete',
  'branch_chain_incomplete',
  'missing_response_bodies',
  'partial_response',
  'inflight_responses',
  'current_node_missing',
  'cycle',
  'leaf_missing',
  'missing_parent',
  'no_resolvable_leaf',
  'not_leaf',
  'conversation_missing',
  'no_messages',
  'no_non_empty_content',
  'assistant_messages_missing',
  'user_messages_missing',
  'roles_unrecognized'
])
const VERIFICATION_METHODS = new Set([
  'active-branch-root-chain',
  'provider-detail-terminal',
  'provider-api-complete',
  'provider-api-incomplete',
  'dom-unverified'
])
const RESPONSE_ERROR_CODES = [
  'rate_limited',
  'auth_required',
  'source_unverified',
  'timeout',
  'invalid_request',
  'unavailable',
  'provider_error'
]
export const INVARIANT_CODES = new Set([
  // not-logged-in / skip reasons
  'not_logged_in',
  'rate_limited',
  'upstream_failed',
  'parse_source_is_api',
  // generic
  'unexpected_error',
  'unspecified_failure',
  'unclassified_reason',
  'navigation_failed',
  'content_script_unreachable',
  // detect / session
  'platform_mismatch',
  'not_detected_as_conversation_page',
  'redirected_to_login_after_session_ok',
  'session_unconfirmed',
  'no_target_conversation',
  'no_conversation_id',
  // conversation
  'conversation_missing',
  'messages_missing',
  'role_invalid',
  'not_exportable',
  'message_ids_not_unique',
  'transcript_unverified',
  'detail_is_different_conversation',
  'parse_timeout',
  'detail_timeout',
  // list
  'list_not_array',
  'list_empty',
  'list_item_shape_invalid',
  'list_ids_not_unique',
  'list_not_from_api',
  'pagination_not_terminated',
  'page_count_inconsistent_with_total',
  'items_exceed_pages_fetched',
  // order
  'message_count_differs',
  'role_sequence_differs',
  'content_order_mismatch',
  // markdown
  'markdown_empty',
  'markdown_content_loss',
  ...RESPONSE_ERROR_CODES.flatMap(code => [`parse_${code}`, `detail_${code}`])
])
const CHECK_NAMES = new Set([
  'detect_home',
  'session',
  'list_first_page',
  'list_pagination',
  'detect_conversation',
  'current_parse',
  'detail_fetch',
  'order_agreement',
  'markdown_export',
  'provider_run'
])

const METRIC_SPECS = {
  // Conversation shape
  messageCount: 'int',
  userCount: 'int',
  assistantCount: 'int',
  systemCount: 'int',
  nonEmptyCount: 'int',
  roleSwitches: 'int',
  maxRoleRun: 'int',
  duplicateMessageIds: 'int',
  firstRole: { enum: ROLE_ENUM },
  lastRole: { enum: ROLE_ENUM },
  alternating: 'bool',
  integrityStatus: { enum: INTEGRITY_ENUM },
  apiIntegrityStatus: { enum: INTEGRITY_ENUM },
  transcriptVerified: { enum: VERIFIED_ENUM },
  verificationMethod: 'code',
  source: { enum: SOURCE_ENUM },
  reasonCodes: 'codes',
  // Detection
  platformMatches: 'bool',
  isConversationPage: 'bool',
  loggedOutSignal: 'bool',
  // List
  totalItems: 'int',
  pagesFetched: 'int',
  expectedPageSize: 'int',
  firstPageItems: 'int',
  lastPageItems: 'int',
  paginationTerminated: 'bool',
  listSource: { enum: SOURCE_ENUM },
  duplicateListIds: 'int',
  invalidListItems: 'int',
  // Parse / detail / order
  domMessageCount: 'int',
  apiMessageCount: 'int',
  sameConversation: 'bool',
  countEqual: 'bool',
  roleSequenceEqual: 'bool',
  comparablePositions: 'int',
  prefixMismatches: 'int',
  // Markdown
  contentChars: 'int',
  markdownChars: 'int',
  markdownRatioPct: 'int'
}

function cleanMetric(spec, value) {
  if (spec === 'int') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.min(Math.floor(value), MAX_INT)
      : undefined
  }
  if (spec === 'bool') return typeof value === 'boolean' ? value : undefined
  if (spec === 'code') {
    return typeof value === 'string' && VERIFICATION_METHODS.has(value) ? value : undefined
  }
  if (spec === 'codes') return cleanReasonCodes(value)
  if (spec && typeof spec === 'object' && Array.isArray(spec.enum)) {
    return typeof value === 'string' && spec.enum.includes(value) ? value : undefined
  }
  return undefined
}

function cleanFromSet(value, allowed, fallback) {
  if (!Array.isArray(value)) return undefined
  const out = []
  for (const item of value) {
    const code = typeof item === 'string' && allowed.has(item) ? item : fallback
    if (code && !out.includes(code)) out.push(code)
    if (out.length >= MAX_CODES) break
  }
  return out
}

/** Provider verification reason codes; unknown ones collapse to 'other_reason_code'. */
export function cleanReasonCodes(value) {
  return cleanFromSet(value, PROVIDER_REASON_CODES, 'other_reason_code')
}

/** Failed-invariant names; anything outside the closed vocabulary is dropped. */
export function cleanCodes(value) {
  return cleanFromSet(value, INVARIANT_CODES, null)
}

/** Map any thrown value to an error class name, never a message. */
export function errorClassOf(error) {
  const name = error && typeof error === 'object' ? error.name : undefined
  return typeof name === 'string' && ERROR_CLASS_RE.test(name) ? name : 'Error'
}

/**
 * Map a provider/content-script error string to a fixed code. The raw text is
 * discarded: provider errors can embed request details.
 */
export function classifyResponseError(message) {
  const text = typeof message === 'string' ? message : ''
  if (/rate.?limit|too many requests|429/i.test(text)) return 'rate_limited'
  if (/sign.?in|log.?in|authenticat|session expired|unauthori[sz]ed|forbidden|401|403/i.test(text))
    return 'auth_required'
  if (/verif|incomplete|truncat|silent data loss/i.test(text)) return 'source_unverified'
  if (/timed? ?out|timeout/i.test(text)) return 'timeout'
  if (/invalid provider request/i.test(text)) return 'invalid_request'
  if (/unavailable|not supported/i.test(text)) return 'unavailable'
  return 'provider_error'
}

// ---------------------------------------------------------------------------
// Check / report construction
// ---------------------------------------------------------------------------

/** Normalize one raw check into the allowlisted shape. */
/**
 * @param {any} raw
 */
export function sanitizeCheck(raw) {
  const name =
    typeof raw?.name === 'string' && CHECK_NAMES.has(raw.name) ? raw.name : 'invalid_check'
  const status = Object.values(STATUS).includes(raw?.status) ? raw.status : STATUS.FAIL
  const check = { name, status }
  const duration = cleanMetric('int', raw?.durationMs)
  if (duration !== undefined) check.durationMs = duration
  if (typeof raw?.reason === 'string') {
    check.reason = INVARIANT_CODES.has(raw.reason) ? raw.reason : 'unclassified_reason'
  }
  const failed = cleanCodes(raw?.failed)
  if (failed && failed.length) check.failed = failed
  if (typeof raw?.errorClass === 'string') check.errorClass = errorClassOf({ name: raw.errorClass })
  const metrics = {}
  if (raw?.metrics && typeof raw.metrics === 'object') {
    for (const [key, spec] of Object.entries(METRIC_SPECS)) {
      if (!Object.prototype.hasOwnProperty.call(raw.metrics, key)) continue
      const cleaned = cleanMetric(spec, raw.metrics[key])
      if (cleaned !== undefined) metrics[key] = cleaned
    }
  }
  if (Object.keys(metrics).length) check.metrics = metrics
  // A FAIL must always say which invariant failed.
  if (check.status === STATUS.FAIL && !check.failed && !check.reason && !check.errorClass) {
    check.reason = 'unspecified_failure'
  }
  return check
}

export function providerStatus(checks) {
  if (checks.some(c => c.status === STATUS.FAIL)) return STATUS.FAIL
  if (checks.some(c => c.status === STATUS.PASS)) return STATUS.PASS
  return STATUS.SKIPPED
}

/** Normalize one provider record (rebuilds from allowlist; recomputes status). */
/**
 * @param {any} raw
 */
export function sanitizeProvider(raw) {
  const provider = PROVIDER_KEYS.includes(raw?.provider) ? raw.provider : 'unknown'
  const checks = (Array.isArray(raw?.checks) ? raw.checks : []).map(sanitizeCheck)
  const loggedIn = raw?.loggedIn === true ? true : raw?.loggedIn === false ? false : null
  return { provider, status: providerStatus(checks), loggedIn, checks }
}

/**
 * Build the final report from raw provider records. Everything is rebuilt via
 * the allowlist; `extensionVersion` must look like a version.
 */
/**
 * @param {{ extensionVersion?: unknown, providers?: unknown[], generatedAt?: unknown, requested?: string[] }} input
 * @returns {{ schema: string, generatedAt: string, extensionVersion: string,
 *   providers: { provider: string, status: string, loggedIn: boolean | null,
 *     checks: { name: string, status: string, durationMs?: number, reason?: string,
 *       failed?: string[], errorClass?: string, metrics?: Record<string, any> }[] }[],
 *   summary: { pass: number, fail: number, skipped: number, liveTested: string[], notLiveTested: string[] } }}
 */
export function buildReport({ extensionVersion, providers, generatedAt, requested = [] }) {
  const version =
    typeof extensionVersion === 'string' &&
    /^\d+(\.\d+){0,3}([-+][0-9A-Za-z.-]{1,20})?$/.test(extensionVersion)
      ? extensionVersion
      : 'unknown'
  const sanitized = (providers || []).map(sanitizeProvider)
  const liveTested = sanitized.filter(p => p.status !== STATUS.SKIPPED).map(p => p.provider)
  const wanted = requested.length ? requested : sanitized.map(p => p.provider)
  const notLiveTested = wanted.filter(key => !liveTested.includes(key))
  return {
    schema: 'provider-canary/1',
    generatedAt:
      typeof generatedAt === 'string' && !Number.isNaN(Date.parse(generatedAt))
        ? new Date(generatedAt).toISOString()
        : new Date().toISOString(),
    extensionVersion: version,
    providers: sanitized,
    summary: {
      pass: sanitized.filter(p => p.status === STATUS.PASS).length,
      fail: sanitized.filter(p => p.status === STATUS.FAIL).length,
      skipped: sanitized.filter(p => p.status === STATUS.SKIPPED).length,
      liveTested,
      notLiveTested
    }
  }
}

export function computeExitCode(report, { requireAll = false } = {}) {
  if (report.providers.some(p => p.status === STATUS.FAIL)) return EXIT.INVARIANT_FAILED
  if (requireAll && report.providers.some(p => p.status === STATUS.SKIPPED)) {
    return EXIT.SKIPPED_REQUIRED
  }
  return EXIT.OK
}

function detailText(check) {
  const parts = []
  if (check.reason) parts.push(check.reason)
  if (check.failed) parts.push(`failed=${check.failed.join('+')}`)
  if (check.errorClass) parts.push(`error=${check.errorClass}`)
  const m = check.metrics || {}
  const order = [
    'messageCount',
    'userCount',
    'assistantCount',
    'systemCount',
    'alternating',
    'roleSwitches',
    'integrityStatus',
    'transcriptVerified',
    'source',
    'totalItems',
    'pagesFetched',
    'expectedPageSize',
    'firstPageItems',
    'lastPageItems',
    'paginationTerminated',
    'domMessageCount',
    'apiMessageCount',
    'countEqual',
    'roleSequenceEqual',
    'prefixMismatches',
    'markdownRatioPct'
  ]
  for (const key of order) if (key in m) parts.push(`${key}=${m[key]}`)
  if (m.reasonCodes && m.reasonCodes.length) parts.push(`reasons=${m.reasonCodes.join('+')}`)
  return parts.join(' ')
}

/** Short, privacy-safe table. Built only from an already sanitized report. */
export function renderTable(report) {
  const rows = [['PROVIDER', 'CHECK', 'STATUS', 'MS', 'DETAIL']]
  for (const provider of report.providers) {
    rows.push([
      provider.provider,
      '(overall)',
      provider.status,
      '',
      provider.loggedIn === false ? 'not_logged_in' : ''
    ])
    for (const check of provider.checks) {
      rows.push([
        provider.provider,
        check.name,
        check.status,
        check.durationMs === undefined ? '' : String(check.durationMs),
        detailText(check)
      ])
    }
  }
  const widths = rows[0].map((_, col) => Math.max(...rows.map(r => r[col].length)))
  const lines = rows.map(r =>
    r
      .map((cell, col) => (col === r.length - 1 ? cell : cell.padEnd(widths[col])))
      .join('  ')
      .trimEnd()
  )
  const s = report.summary
  lines.push('')
  lines.push(
    `Extension ${report.extensionVersion}. PASS ${s.pass}, FAIL ${s.fail}, SKIPPED ${s.skipped}. ` +
      `Live-tested: ${s.liveTested.join(', ') || 'none'}. Not live-tested: ${s.notLiveTested.join(', ') || 'none'}.`
  )
  lines.push('A PASS is evidence for that provider only, on this account, at this time.')
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Privacy guard (belt and braces on top of the allowlist)
// ---------------------------------------------------------------------------

const PUBLIC_VOCAB = new Set(
  [
    ...PROVIDER_KEYS,
    ...Object.values(STATUS),
    'user',
    'assistant',
    'system',
    'api',
    'dom',
    'none'
  ].map(s => s.toLowerCase())
)

function normalizeForGuard(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Collect strings that must never appear in output. Held in memory only for
 * the guard; never logged.
 */
/**
 * @param {{ conversations?: any[], listItems?: any[], extra?: string[] }} [input]
 * @returns {string[]}
 */
export function collectPrivateStrings({ conversations = [], listItems = [], extra = [] } = {}) {
  const out = new Set()
  const add = (value, min) => {
    if (typeof value !== 'string') return
    const s = normalizeForGuard(value)
    if (s.length >= min && !PUBLIC_VOCAB.has(s.toLowerCase())) out.add(s)
  }
  for (const conv of conversations) {
    if (!conv || typeof conv !== 'object') continue
    add(conv.id, 6)
    add(conv.title, 6)
    add(conv.url, 6)
    add(conv.modelName, 6)
    for (const message of Array.isArray(conv.messages) ? conv.messages : []) {
      add(message?.id, 6)
      if (typeof message?.content === 'string') {
        const text = normalizeForGuard(message.content)
        if (text.length >= 8) {
          out.add(text.slice(0, 40))
          out.add(text.slice(-40))
        }
      }
    }
  }
  for (const item of listItems) {
    add(item?.id, 6)
    add(item?.title, 6)
    add(item?.url, 6)
  }
  for (const value of extra) add(value, 6)
  return [...out]
}

/** Throws a fixed-message error if any private string appears in `output`. Never says which. */
export function assertNoPrivateStrings(output, privateStrings) {
  const haystack = normalizeForGuard(String(output))
  for (const secret of privateStrings) {
    if (haystack.includes(secret)) {
      const error = new CanaryUsageError(
        'report_privacy_guard',
        'Report privacy guard tripped: output contained a value from the tested conversation. Nothing was written.'
      )
      throw error
    }
  }
}

// ---------------------------------------------------------------------------
// Invariant checkers (pure; the TS integrity/markdown functions are injected)
// ---------------------------------------------------------------------------

const VALID_ROLES = new Set(['user', 'assistant', 'system'])

/** Shape of the role sequence: counts and runs only, never text. */
/**
 * @param {unknown} messages
 * @returns {Record<string, any>}
 */
export function summarizeRoles(messages) {
  const list = Array.isArray(messages) ? messages : []
  const counts = { user: 0, assistant: 0, system: 0 }
  let switches = 0
  let run = 0
  let maxRun = 0
  let prev = null
  for (const message of list) {
    const role = VALID_ROLES.has(message?.role) ? message.role : null
    if (role) counts[role] += 1
    if (role === prev) run += 1
    else {
      if (prev !== null) switches += 1
      run = 1
    }
    prev = role
    maxRun = Math.max(maxRun, run)
  }
  const roleOf = m => (VALID_ROLES.has(m?.role) ? m.role : 'none')
  const nonSystem = list.filter(m => m?.role === 'user' || m?.role === 'assistant')
  const alternating =
    nonSystem.length > 0 && nonSystem.every((m, i) => i === 0 || m.role !== nonSystem[i - 1].role)
  return {
    userCount: counts.user,
    assistantCount: counts.assistant,
    systemCount: counts.system,
    roleSwitches: switches,
    maxRoleRun: maxRun,
    firstRole: list.length ? roleOf(list[0]) : 'none',
    lastRole: list.length ? roleOf(list[list.length - 1]) : 'none',
    alternating
  }
}

function verifiedLabel(deps, conversation) {
  const verified = deps.isTranscriptVerified?.(conversation)
  return verified === true ? 'yes' : verified === false ? 'no' : 'unknown'
}

function methodOf(conversation) {
  const method = conversation?.verification?.transcript?.method
  return typeof method === 'string' && VERIFICATION_METHODS.has(method) ? method : undefined
}

/**
 * Invariants for one parsed conversation (current-page parse or API detail).
 * `deps` must provide analyzeConversationIntegrity, isConversationExportable
 * and isTranscriptVerified from src/core/conversation-integrity.
 * Returns { metrics, failed } with fixed-vocabulary content only.
 */
/**
 * @param {any} conversation
 * @param {any} deps
 * @param {{ provider?: string, requireVerified?: boolean }} [opts]
 * @returns {{ metrics: Record<string, any>, failed: string[] }}
 */
export function evaluateConversation(
  conversation,
  deps,
  { provider, requireVerified = false } = {}
) {
  const failed = []
  if (!conversation || typeof conversation !== 'object') {
    return { metrics: { messageCount: 0 }, failed: ['conversation_missing'] }
  }
  const messages = Array.isArray(conversation.messages) ? conversation.messages : []
  const integrity = deps.analyzeConversationIntegrity(conversation)
  const roles = summarizeRoles(messages)
  const ids = messages.map(m => m?.id).filter(id => typeof id === 'string' && id.length > 0)
  const duplicateMessageIds = ids.length - new Set(ids).size

  if (conversation.platform !== provider) failed.push('platform_mismatch')
  if (messages.length === 0) failed.push('messages_missing')
  if (messages.some(m => !VALID_ROLES.has(m?.role))) failed.push('role_invalid')
  if (!deps.isConversationExportable(conversation)) failed.push('not_exportable')
  if (duplicateMessageIds > 0) failed.push('message_ids_not_unique')
  const verified = deps.isTranscriptVerified(conversation)
  if (requireVerified && verified !== true) failed.push('transcript_unverified')

  const source =
    conversation.source === 'api' ||
    conversation.source === 'dom' ||
    conversation.source === 'mixed'
      ? conversation.source
      : 'unknown'
  return {
    metrics: {
      messageCount: messages.length,
      nonEmptyCount: integrity.nonEmptyContentCount,
      ...roles,
      duplicateMessageIds,
      integrityStatus: integrity.status,
      transcriptVerified: verifiedLabel(deps, conversation),
      verificationMethod: methodOf(conversation),
      source,
      reasonCodes: integrity.reasons
    },
    failed
  }
}

function listItemValid(item, provider) {
  if (!item || typeof item !== 'object') return false
  if (typeof item.id !== 'string' || !item.id.trim()) return false
  if (item.platform !== provider) return false
  try {
    const url = new URL(item.url)
    return url.protocol === 'https:' && PROVIDERS[provider].hosts.includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * Invariants for the first page of the history list: shape of what the
 * FETCH_ALL_CONVERSATIONS path returned. Pagination is judged separately.
 */
/**
 * @param {unknown} items
 * @param {any} meta
 * @param {string} provider
 * @returns {{ metrics: Record<string, any>, failed: string[] }}
 */
export function evaluateListFirstPage(items, meta, provider) {
  const failed = []
  const list = Array.isArray(items) ? items : []
  if (!Array.isArray(items)) failed.push('list_not_array')
  else if (list.length === 0) failed.push('list_empty')
  const invalidListItems = list.filter(item => !listItemValid(item, provider)).length
  if (invalidListItems > 0) failed.push('list_item_shape_invalid')
  const ids = list.map(item => item?.id).filter(id => typeof id === 'string')
  const duplicateListIds = ids.length - new Set(ids).size
  if (duplicateListIds > 0) failed.push('list_ids_not_unique')
  const listSource = meta?.source === 'api' || meta?.source === 'sidebar' ? meta.source : 'unknown'
  if (listSource !== 'api') failed.push('list_not_from_api')
  const pageSize = PROVIDERS[provider].pageSize
  return {
    metrics: {
      totalItems: list.length,
      expectedPageSize: pageSize || undefined,
      firstPageItems: pageSize ? Math.min(list.length, pageSize) : undefined,
      listSource,
      invalidListItems,
      duplicateListIds
    },
    failed
  }
}

/**
 * Pagination boundary. A parser that stops on a short page fetches
 * ceil(total / pageSize) pages, or one more when total is an exact multiple of
 * the page size (the empty terminating page). `complete` must be true: the
 * parsers only set it after a terminating page.
 */
/**
 * @param {unknown} items
 * @param {any} meta
 * @param {string} provider
 * @returns {{ metrics: Record<string, any>, failed: string[] }}
 */
export function evaluateListPagination(items, meta, provider) {
  const failed = []
  const total = Array.isArray(items) ? items.length : 0
  const pageSize = PROVIDERS[provider].pageSize
  const complete = meta?.complete === true
  if (!complete) failed.push('pagination_not_terminated')
  const pages =
    typeof meta?.pagesFetched === 'number' && Number.isFinite(meta.pagesFetched)
      ? meta.pagesFetched
      : undefined
  const metrics = {
    totalItems: total,
    paginationTerminated: complete,
    expectedPageSize: pageSize || undefined,
    pagesFetched: pages
  }
  if (pageSize && pages !== undefined) {
    const minPages = Math.max(1, Math.ceil(total / pageSize))
    const maxPages = total > 0 && total % pageSize === 0 ? minPages + 1 : minPages
    if (pages < minPages || pages > maxPages) failed.push('page_count_inconsistent_with_total')
    metrics.lastPageItems = Math.max(0, total - pageSize * (pages - 1))
    if (total > pageSize * pages) failed.push('items_exceed_pages_fetched')
  }
  return { metrics, failed }
}

function prefixKey(content) {
  if (typeof content !== 'string') return ''
  return content
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 24)
}

/**
 * Compare the current-page parse with the independent API detail fetch.
 * Order is judged by message count, role sequence and a normalized content
 * prefix per position (rendered text and markdown differ in punctuation, so
 * only letters/digits are compared). Texts are compared in memory and only
 * counts are returned. `parseSource` 'api' means both sides came from the
 * same provider API, so the comparison would prove nothing.
 */
/**
 * @param {any} parseConv
 * @param {any} detailConv
 * @param {{ parseSource?: string }} [opts]
 * @returns {{ skipped?: string, metrics: Record<string, any>, failed: string[] }}
 */
export function evaluateOrderAgreement(parseConv, detailConv, { parseSource } = {}) {
  if (parseSource === 'api') {
    return { skipped: 'parse_source_is_api', metrics: {}, failed: [] }
  }
  const a = Array.isArray(parseConv?.messages) ? parseConv.messages : []
  const b = Array.isArray(detailConv?.messages) ? detailConv.messages : []
  const failed = []
  const countEqual = a.length === b.length
  if (!countEqual) failed.push('message_count_differs')
  const overlap = Math.min(a.length, b.length)
  const roleSequenceEqual = countEqual && a.every((m, i) => m?.role === b[i]?.role)
  if (!roleSequenceEqual && countEqual) failed.push('role_sequence_differs')
  let comparable = 0
  let mismatches = 0
  for (let i = 0; i < overlap; i++) {
    const ka = prefixKey(a[i]?.content)
    const kb = prefixKey(b[i]?.content)
    if (ka.length < 6 || kb.length < 6) continue
    comparable += 1
    if (
      ka.slice(0, Math.min(ka.length, kb.length)) !== kb.slice(0, Math.min(ka.length, kb.length))
    ) {
      mismatches += 1
    }
  }
  if (comparable >= 2 && mismatches / comparable > 0.25) failed.push('content_order_mismatch')
  return {
    metrics: {
      messageCount: a.length,
      apiMessageCount: b.length,
      countEqual,
      roleSequenceEqual,
      comparablePositions: comparable,
      prefixMismatches: mismatches
    },
    failed
  }
}

/**
 * Markdown export completeness proxy. The export must be non-empty and keep
 * most of the user/assistant text (final turns only: progress drafts may be
 * collapsed by design). Heuristic, so only counts are reported.
 */
/**
 * @param {any} conversation
 * @param {unknown} markdown
 * @returns {{ metrics: Record<string, any>, failed: string[] }}
 */
export function evaluateMarkdown(conversation, markdown) {
  const failed = []
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : []
  const contentChars = messages
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && !m?.progressGroupId)
    .reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.trim().length : 0), 0)
  const text = typeof markdown === 'string' ? markdown : ''
  if (text.trim().length === 0) failed.push('markdown_empty')
  else if (contentChars > 0 && text.length < contentChars * 0.6)
    failed.push('markdown_content_loss')
  return {
    metrics: {
      contentChars,
      markdownChars: text.length,
      markdownRatioPct: contentChars > 0 ? Math.round((text.length / contentChars) * 100) : 0
    },
    failed
  }
}

/** Whether a (private, in-memory) page location says "logged out". Never stored. */
export function isLoggedOutLocation(provider, urlString) {
  const cfg = PROVIDERS[provider]
  let url
  try {
    url = new URL(urlString)
  } catch {
    return false
  }
  if (cfg.authHosts.includes(url.hostname)) return true
  if (!cfg.hosts.includes(url.hostname)) return true
  return cfg.loggedOutPath.test(url.pathname)
}

/** Pick the most recent list item (updatedAt, then createdAt, else first). In memory only. */
/**
 * @param {any[]} items
 * @returns {any}
 */
export function pickMostRecent(items) {
  const list = Array.isArray(items) ? items : []
  let best = null
  let bestTime = -Infinity
  for (const item of list) {
    const t = Math.max(
      typeof item?.updatedAt === 'number' ? item.updatedAt : -Infinity,
      typeof item?.createdAt === 'number' ? item.createdAt : -Infinity
    )
    if (best === null || t > bestTime) {
      best = item
      bestTime = t
    }
  }
  return best
}
