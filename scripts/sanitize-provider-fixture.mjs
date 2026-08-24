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

/** Credential material: value is replaced wholesale. */
const SENSITIVE_KEY = /token|cookie|session|secret|authorization|apikey|api_key|csrf/i
/** Private blobs (attachments, uploads, connector references): key dropped. */
const DROP_KEY = /attachment|file|connector|upload/i
/** Message/conversation text: value replaced with synthetic text. */
const CONTENT_KEY = /^(text|content|message|parts|prompt|completion|code)$/i
/** Conversation/document titles and uploaded filenames. */
const TITLE_KEY = /^(title|name|display_name|file_name|filename)$/i
/** Keys whose string values are identifiers eligible for pseudonymization. */
const ID_KEY = /(^|_)(id|uuid|node|parent|child|conversation|message|organization|account|user)/i
/** Keys whose numeric values are unix-second timestamps. */
const TIME_KEY = /(^|_)(time|date|at|created|updated)/i

// Value shapes --------------------------------------------------------------

const URL_RE = /^https?:\/\//i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LONG_ID_RE = /^[A-Za-z0-9_-]{13,}$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/

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
  const collect = (value, key) => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item, key)
      return
    }
    if (isRecord(value)) {
      for (const [k, v] of Object.entries(value)) collect(v, k)
      return
    }
    if (isMsTimestamp(value)) millis.add(value)
    else if (isSecondsTimestamp(value, key)) millis.add(value * 1000)
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
    pseudo = `id_${hash8(original)}`
    state.idMap.set(original, pseudo)
  }
  return pseudo
}

function isIdentifierValue(value, key) {
  if (typeof key !== 'string' || !ID_KEY.test(key)) return false
  return UUID_RE.test(value) || LONG_ID_RE.test(value)
}

function sanitizeString(value, key, state) {
  if (typeof key === 'string') {
    if (CONTENT_KEY.test(key)) return `Synthetic message ${++state.textCounter}`
    if (TITLE_KEY.test(key)) return `Synthetic title ${++state.titleCounter}`
  }
  if (EMAIL_RE.test(value)) return `user_${hash8(value)}@example.invalid`
  if (URL_RE.test(value)) return `https://example.invalid/${hash8(value)}`
  if (ISO_DATE_RE.test(value)) {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(shiftMs(parsed, state)).toISOString()
    return value
  }
  if (isIdentifierValue(value, key)) return pseudonym(value, state)
  return value
}

function sanitizeValue(value, key, state) {
  if (value === null || typeof value === 'boolean') return value

  if (typeof key === 'string' && SENSITIVE_KEY.test(key)) {
    return '[redacted]'
  }

  if (Array.isArray(value)) {
    const dropElements = typeof key === 'string' && DROP_KEY.test(key)
    return value.map(item => (dropElements ? null : sanitizeValue(item, key, state)))
  }

  if (isRecord(value)) {
    const out = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      if (DROP_KEY.test(childKey)) continue
      // Graph node IDs are object keys in ChatGPT's `mapping`; pseudonymize
      // them through the same map as parent/child reference values so the
      // branch graph stays internally consistent.
      const outKey = UUID_RE.test(childKey) ? pseudonym(childKey, state) : childKey
      out[outKey] = sanitizeValue(childValue, childKey, state)
    }
    return out
  }

  if (typeof value === 'string') return sanitizeString(value, key, state)

  if (typeof value === 'number') {
    if (isMsTimestamp(value)) return shiftMs(value, state)
    if (isSecondsTimestamp(value, key)) return Math.floor(shiftMs(value * 1000, state) / 1000)
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
 * Returns an array of { pattern, path, excerpt } findings; empty means clean.
 */
export function scanForResidualSecrets(value) {
  const findings = []
  const scanString = (text, pathName) => {
    for (const { name, re } of RESIDUAL_PATTERNS) {
      const match = re.exec(text)
      if (match) {
        findings.push({ pattern: name, path: pathName, excerpt: match[0].slice(0, 24) })
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
  console.log(`Sanitized fixture written to ${outputPath}`)
  console.log(`schemaFingerprint: ${fixture.schemaFingerprint}`)

  if (flags.check) {
    const findings = scanForResidualSecrets(fixture)
    if (findings.length > 0) {
      console.error('Residual secret patterns detected in sanitized output:')
      for (const finding of findings) {
        console.error(`  [${finding.pattern}] at ${finding.path}: ${finding.excerpt}…`)
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
  } catch (error) {
    console.error(`sanitize-provider-fixture: ${error.message}`)
    process.exit(2)
  }
}
