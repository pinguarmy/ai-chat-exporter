#!/usr/bin/env node
/**
 * Sanitize a raw provider API capture into a commit-safe test fixture.
 *
 * The sanitizer walks a captured JSON payload recursively. It preserves the
 * schema (key names, nesting, array lengths, branch-graph consistency,
 * pagination envelopes, role/type metadata, booleans and nulls) while
 * stripping every piece of private data: credentials, emails, account IDs,
 * message text, titles, real URLs and real timestamps.
 *
 * CLI:
 *   node scripts/sanitize-provider-fixture.mjs <input.json> <output.json> \
 *     --provider chatgpt --scenario normal --capturedAt 2026-01-01 [--check]
 *
 * Library:
 *   import { sanitizeCapture, schemaFingerprint, scanForResidualSecrets }
 *     from '../scripts/sanitize-provider-fixture.mjs'
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Fixed synthetic epoch (2023-11-14T22:13:20.000Z). Real dates never survive. */
const EPOCH_BASE_MS = 1_700_000_000_000
const TIMESTAMP_STEP_MS = 60_000

// Key classifications -------------------------------------------------------

/** Credential material: value is replaced wholesale. `chat_session*` keys are
 *  structural DeepSeek fields, not cookies, so they stay out of this class. */
const SENSITIVE_KEY = /token|cookie|secret|authorization|apikey|api_key|csrf|session/i
const STRUCTURAL_SESSION_KEY = /chat_session/i
/** Private blobs (attachments, uploads, connector references): key dropped. */
const DROP_KEY = /attachment|file|connector|upload/i
/** Message/conversation text: value replaced with synthetic text. */
const CONTENT_KEY = /^(text|content|message|parts|prompt|completion|code)$/i
/** Conversation/document titles and uploaded filenames. */
const TITLE_KEY = /^(title|name|display_name|file_name|filename)$/i
/** Keys whose string values are identifiers eligible for pseudonymization. */
const ID_KEY = /(^|_)(id|uuid|node|parent|child|conversation|message|organization|account|user)/i
/** Keys whose numeric values are unix-second timestamps. */
const TIME_KEY = /(^|_)(time|date|at|created|updated)|(?:Time|Date|At)$/i
// Values outside this small metadata allowlist are private by default.
const ENUM_KEY = /^(role|sender|type|content_type|contentType|message_type|status|stop_reason|channel|recipient|model|model_slug|default_model_slug|resolved_model_slug|model_type|modelType|platform|kind|source|ref_type|thinking_effort|thinking_mode|effective_thinking_mode|conversation_mode|title_type|queryType|language|reasoning_status|reasoning_recap_type|reasoning_ui_layout|reasoningUiLayout|effort|tool_search_mode|paprika_mode|publish_status|scope_namespace|async_source|cot_version|cache_control|systemPromptName)$/
// Small, explicit public protocol values; unknown model slugs are private.
const PUBLIC_ENUMS = new Set([
  'user', 'assistant', 'system', 'developer', 'tool', 'human', 'USER', 'ASSISTANT',
  'text', 'text_delta', 'json_block', 'thinking', 'tool_use', 'tool_result', 'image', 'image_url',
  'image_file', 'image_asset_pointer', 'multimodal_text', 'code', 'execution_output', 'tether_browsing_display',
  'thoughts', 'summary', 'reasoning', 'analysis', 'final', 'commentary', 'notification',
  'REQUEST', 'RESPONSE', 'ANSWER', 'TEXT', 'THINK', 'TOOL_SEARCH', 'TOOL_OPEN',
  'web_search', 'search', 'bash', 'computer', 'text_editor', 'web_fetch', 'all',
  'finished_successfully', 'finished', 'complete', 'completed', 'success', 'pending',
  'in_progress', 'stop', 'end_turn', 'max_tokens', 'normal', 'standard', 'auto',
  'enabled', 'disabled', 'on', 'off', 'none', 'low', 'medium', 'high',
  'chatgpt', 'claude', 'deepseek', 'gemini', 'grok', 'api',
  'python', 'javascript', 'typescript', 'json', 'markdown', 'html', 'svg', 'css', 'shell',
])
const GEMINI_RPC_IDS = new Set(['hNvQHb', 'MaZiqc'])
const GEMINI_FRAME_TAGS = new Set(['di', 'af.httprm', 'e'])
const IDENTIFIER_KEY = /(?:^id$|uuid|(?:^|_)(?:id|ids|parent|children|node)$|(?:Id|Ids)$|^orgId$|^current_node$)/i
const GEMINI_ID = /^(c|r|rc)_([A-Za-z0-9_-]+)$/

// Value shapes --------------------------------------------------------------

const URL_RE = /^https?:\/\//i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INLINE_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LONG_ID_RE = /^[A-Za-z0-9_-]{13,}$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
/** Fixed, non-identifying sentinel values that must survive sanitization. */
const STRUCTURAL_IDS = new Set(['00000000-0000-4000-8000-000000000000', 'client-created-root'])

function hash8(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Numeric value looks like a unix-ms timestamp. */
function isMsTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 1e12
}

/** Numeric value looks like a unix-seconds timestamp (e.g. ChatGPT create_time). */
function isSecondsTimestamp(value, key) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 1e9 &&
    value < 1e11 &&
    typeof key === 'string' &&
    TIME_KEY.test(key)
  )
}

// Timestamp shifting ---------------------------------------------------------

/**
 * First pass: collect every real timestamp so each distinct value maps to
 * EPOCH_BASE_MS + rank * TIMESTAMP_STEP_MS. Relative ordering is preserved;
 * absolute dates are destroyed deterministically.
 */
function buildTimestampMap(raw) {
  const millis = new Set()
  const collect = (value, key, positional = false) => {
    if (typeof value === 'string' && value.startsWith(")]}'")) {
      for (const line of value.split('\n')) {
        if (!line.startsWith('[[')) continue
        try { for (const entry of JSON.parse(line)) if (entry[0] === 'wrb.fr' && typeof entry[2] === 'string') collect(JSON.parse(entry[2]), null, true) } catch { /* validated during sanitization */ }
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item, key, positional)
      return
    }
    if (isRecord(value)) {
      for (const [k, v] of Object.entries(value)) collect(v, k)
      return
    }
    if (isMsTimestamp(value)) millis.add(value)
    else if (isSecondsTimestamp(value, key) || (positional && typeof value === 'number' && value > 1e9 && value < 1e11)) millis.add(value * 1000)
    else if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
      const parsed = Date.parse(value)
      if (!Number.isNaN(parsed)) millis.add(parsed)
    }
  }
  collect(raw, null)

  const sorted = Array.from(millis).sort((a, b) => a - b)
  const map = new Map()
  sorted.forEach((ms, rank) => map.set(ms, EPOCH_BASE_MS + rank * TIMESTAMP_STEP_MS))
  return map
}

function shiftMs(ms, state) {
  const shifted = state.timestampMap.get(ms)
  return shifted === undefined ? EPOCH_BASE_MS : shifted
}

// Main walk ------------------------------------------------------------------

function pseudonym(original, state) {
  let pseudo = state.idMap.get(original)
  if (!pseudo) {
    pseudo = `id_${(state.idMap.size + 1).toString(16).padStart(8, '0')}`
    state.idMap.set(original, pseudo)
  }
  return pseudo
}

function isIdentifierValue(value, key) {
  if (typeof key !== 'string' || !ID_KEY.test(key)) return false
  // Provider-wide structural placeholders identify nobody. Claude uses this
  // fixed value as the parent of every root message, and parsers depend on
  // recognising it, so hashing it would make real fixtures look truncated.
  if (STRUCTURAL_IDS.has(value)) return false
  return UUID_RE.test(value) || LONG_ID_RE.test(value)
}

function sanitizeString(value, key, state) {
  if (!value) return value
  if (STRUCTURAL_IDS.has(value)) return value
  if (key && TIME_KEY.test(key) && /^\d{10}(?:\d{3})?$/.test(value)) {
    const number = Number(value)
    return value.length === 13 ? String(shiftMs(number, state)) : String(Math.floor(shiftMs(number * 1000, state) / 1000))
  }
  if (ISO_DATE_RE.test(value)) {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(shiftMs(parsed, state)).toISOString()
  }
  if (URL_RE.test(value)) return `https://example.invalid/${pseudonym(value, state).slice(3)}`
  if (EMAIL_RE.test(value)) return `user_${pseudonym(value, state).slice(3)}@example.invalid`
  const geminiId = state.provider === 'gemini' && GEMINI_ID.exec(value)
  if (geminiId) return `${geminiId[1]}_${pseudonym(geminiId[2], state).slice(3)}`
  if (key && IDENTIFIER_KEY.test(key)) return pseudonym(value, state)
  if (key === 'name' && /^(?:web_search|search|bash|computer|text_editor|web_fetch)$/.test(value)) return value
  if (key && TITLE_KEY.test(key)) return `Synthetic title ${++state.titleCounter}`
  if (key && ENUM_KEY.test(key) && PUBLIC_ENUMS.has(value)) return value
  return `Synthetic message ${++state.textCounter}`
}

// Gemini frames contain JSON arrays, with another JSON string at wrb.fr[2].
// Decode both layers rather than treating the transport as message text.
function sanitizeGeminiTransport(text, state) {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('[[')) {
      if (i === 0 && lines[i] === ")]}'") continue
      if (/^\s*$/.test(lines[i])) continue
      if (/^\d+$/.test(lines[i]) && lines[i + 1]?.startsWith('[[')) continue
      throw new Error('Unexpected Gemini transport line')
    }
    let entries
    try { entries = JSON.parse(lines[i]) } catch { throw new Error('Invalid Gemini transport frame') }
    for (const entry of entries) {
      if (!Array.isArray(entry)) throw new Error('Invalid Gemini transport entry')
      if (entry[0] !== 'wrb.fr') {
        if (!GEMINI_FRAME_TAGS.has(entry[0])) throw new Error('Unknown Gemini frame tag')
        for (let j = 1; j < entry.length; j++) entry[j] = sanitizeValue(entry[j], null, state, true)
        continue
      }
      if (!GEMINI_RPC_IDS.has(entry[1])) throw new Error('Unknown Gemini RPC')
      for (let j = 3; j < entry.length; j++) entry[j] = sanitizeValue(entry[j], null, state, true)
      if (typeof entry[2] !== 'string') continue
      let inner
      try { inner = JSON.parse(entry[2]) } catch { throw new Error('Invalid Gemini RPC payload') }
      entry[2] = JSON.stringify(sanitizeValue(inner, null, state, true))
    }
    lines[i] = JSON.stringify(entries)
    if (i > 0 && /^\d+$/.test(lines[i - 1])) lines[i - 1] = String(Buffer.byteLength(lines[i], 'utf8'))
  }
  return lines.join('\n')
}

function sanitizeValue(value, key, state, positional = false) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string' && state.provider === 'gemini' && value.startsWith(")]}'")) {
    return sanitizeGeminiTransport(value, state)
  }
  if (typeof value === 'string' && key === 'json_block') {
    try { return JSON.stringify(sanitizeValue(JSON.parse(value), null, state)) }
    catch { return `Synthetic message ${++state.textCounter}` }
  }

  if (typeof key === 'string' && SENSITIVE_KEY.test(key) && !STRUCTURAL_SESSION_KEY.test(key)) {
    return '[redacted]'
  }

  if (Array.isArray(value)) {
    const dropElements = typeof key === 'string' && DROP_KEY.test(key)
    return value.map(item => (dropElements ? null : sanitizeValue(item, key, state, positional)))
  }

  if (isRecord(value)) {
    const out = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      if (DROP_KEY.test(childKey)) continue
      // Graph node IDs are object keys in ChatGPT's `mapping`; pseudonymize
      // them through the same map as parent/child reference values so the
      // branch graph stays internally consistent.
      const outKey = !STRUCTURAL_IDS.has(childKey) && (key === 'mapping' || UUID_RE.test(childKey)) ? pseudonym(childKey, state) : childKey
      out[outKey] = sanitizeValue(childValue, childKey, state, positional)
    }
    return out
  }

  if (typeof value === 'string') return sanitizeString(value, key, state)

  if (typeof value === 'number') {
    if (isMsTimestamp(value)) return shiftMs(value, state)
    if (isSecondsTimestamp(value, key) || (positional && value > 1e9 && value < 1e11)) return Math.floor(shiftMs(value * 1000, state) / 1000)
    if (key && /^(?:message_id|parent_id|parent_message_id|current_message_id)$/.test(key) && value !== 0) {
      if (!state.numericIds.has(value)) state.numericIds.set(value, state.numericIds.size + 1)
      return state.numericIds.get(value)
    }
    return value
  }

  return value
}

/**
 * Sanitize a raw provider capture and wrap it in the fixture envelope.
 * options: { provider, scenario, capturedAt }
 */
export function sanitizeCapture(raw, options = {}) {
  const state = {
    idMap: new Map(),
    numericIds: new Map(),
    provider: options.provider,
    textCounter: 0,
    titleCounter: 0,
    timestampMap: buildTimestampMap(raw),
  }
  const payload = sanitizeValue(raw, null, state)
  return {
    provider: options.provider ?? 'unknown',
    capturedAt: options.capturedAt ?? new Date(EPOCH_BASE_MS).toISOString(),
    source: 'real-sanitized',
    scenario: options.scenario ?? 'normal',
    schemaFingerprint: schemaFingerprint(payload),
    payload,
  }
}

// Schema fingerprint -----------------------------------------------------------

function collectSchema(value, pathName, out) {
  if (value === null) {
    out.push(`${pathName}:null`)
    return
  }
  if (Array.isArray(value)) {
    out.push(`${pathName}:array`)
    for (const item of value) collectSchema(item, `${pathName}[]`, out)
    return
  }
  if (isRecord(value)) {
    out.push(`${pathName}:object`)
    for (const key of Object.keys(value).sort()) {
      collectSchema(value[key], pathName ? `${pathName}.${key}` : key, out)
    }
    return
  }
  out.push(`${pathName}:${typeof value}`)
}

/**
 * Deterministic sha256 over the sorted `path:type` list of every node in the
 * value. Paths use key names verbatim and `[]` for array items. Two payloads
 * with the same shape (regardless of values) share a fingerprint; any key
 * rename or type change alters it.
 */
export function schemaFingerprint(value) {
  const entries = []
  collectSchema(value, '', entries)
  entries.sort()
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

// Residual-secret scan -----------------------------------------------------------

const RESIDUAL_PATTERNS = [
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/ },
  { name: 'api-key', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'bearer-token', re: /bearer\s+[A-Za-z0-9._-]{20,}/i },
  { name: 'cookie-header', re: /(^|[;\s])(session|sid|auth|token|cookie)=[^;\s]{8,}/i },
  { name: 'email', re: /[A-Za-z0-9._%+-]+@(?!example\.invalid)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
]

/**
 * Scan a sanitized fixture for anything that still looks like a secret.
 * Returns pattern and path findings without excerpts. This is not a privacy proof.
 */
export function scanForResidualSecrets(value) {
  const findings = []
  const scanString = (text, pathName) => {
    for (const { name, re } of RESIDUAL_PATTERNS) {
      const match = re.exec(text)
      if (match) {
        findings.push({ pattern: name, path: pathName })
      }
    }
  }
  const walk = (node, pathName) => {
    if (typeof node === 'string') {
      scanString(node, pathName)
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pathName}[${index}]`))
      return
    }
    if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) {
        scanString(key, `${pathName}.$key`)
        walk(child, pathName ? `${pathName}.${key}` : key)
      }
    }
  }
  walk(value, '')
  return findings
}

// CLI ---------------------------------------------------------------------------

function parseArgs(argv) {
  const positional = []
  const flags = { check: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--check') {
      flags.check = true
    } else if (arg === '--provider' || arg === '--scenario' || arg === '--capturedAt') {
      flags[arg.slice(2)] = argv[++i]
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`)
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function main(argv) {
  const { positional, flags } = parseArgs(argv)
  const [inputPath, outputPath] = positional
  if (!inputPath || !outputPath) {
    console.error(
      'Usage: node scripts/sanitize-provider-fixture.mjs <input.json> <output.json> ' +
        '[--provider <name>] [--scenario <name>] [--capturedAt <date>] [--check]'
    )
    process.exit(2)
  }

  const raw = JSON.parse(readFileSync(inputPath, 'utf8'))
  const fixture = sanitizeCapture(raw, {
    provider: flags.provider,
    scenario: flags.scenario,
    capturedAt: flags.capturedAt,
  })
  writeFileSync(outputPath, JSON.stringify(fixture, null, 2) + '\n')
  console.log('Sanitized fixture written.')
  console.log(`schemaFingerprint: ${fixture.schemaFingerprint}`)

  if (flags.check) {
    const findings = scanForResidualSecrets(fixture)
    if (findings.length > 0) {
      console.error('Residual secret patterns detected in sanitized output:')
      for (const finding of findings) {
        console.error(`  [${finding.pattern}] detected`)
      }
      process.exit(1)
    }
    console.log('Residual-secret check passed.')
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  try {
    main(process.argv.slice(2))
  } catch {
    console.error('sanitize-provider-fixture: unable to sanitize input')
    process.exit(2)
  }
}
