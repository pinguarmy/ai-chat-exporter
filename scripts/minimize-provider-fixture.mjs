#!/usr/bin/env node
/**
 * Deterministically shrink an already-sanitized provider fixture.
 *
 * The sanitizer (`sanitize-provider-fixture.mjs`) preserves array lengths, so a
 * capture of a long account history stays huge even though every value is
 * synthetic. This script keeps what the parsers and tests depend on and drops
 * repetition. It never reads raw captures and never adds data: its output is a
 * strict subset of its (sanitized) input, apart from recomputed structural
 * links, pagination counters and the schema fingerprint.
 *
 * Currently supported provider: chatgpt.
 *
 * ChatGPT rules
 * - listPages: every page except the last must stay full (`limit` items), because
 *   the parser keeps paging while `items.length === limit` and stops on a short
 *   page. The kept pages are the first full page and a short last page (at most
 *   SHORT_PAGE_ITEMS items). Intermediate full pages are dropped; offset and
 *   total are renumbered so the kept pages stay contiguous, using the provider's
 *   own convention (total = offset + limit + 1 while more pages remain, else
 *   offset + items).
 * - details[].mapping: the active branch (current_node up to the root) is the
 *   transcript the parser exports. Along it we keep the root, the leaf, every
 *   branch point with its active child and its off-chain children (to depth
 *   OFFCHAIN_DEPTH), every visible user/assistant node holding an image part,
 *   the first SHAPE_REPEAT_LIMIT nodes of every distinct node shape (role,
 *   content type, recipient kind, status, channel, part kinds, key skeleton), and
 *   the first node of every distinct adjacent shape pair (so each transition,
 *   e.g. tool result -> assistant text, still occurs). Remaining nodes of
 *   repetitive linear runs are removed and the chain is relinked
 *   (parent/children) so it is still a single root-to-leaf path.
 * - Inside message metadata, arrays keep their first ARRAY_SHAPE_LIMIT items per
 *   distinct item shape, at most ARRAY_MAX_ITEMS in total. `content.parts` is
 *   never trimmed.
 * - Every string is truncated to MAX_STRING characters.
 *
 * CLI:
 *   node scripts/minimize-provider-fixture.mjs <fixture.json> [output.json] [--check]
 *
 * Without output.json the fixture is rewritten in place. The script is
 * idempotent: a fixture carrying the `minimization` marker is returned unchanged. With --check it
 * also runs the sanitizer's residual-secret scan on the input and the result
 * and fails if the result has any finding.
 *
 * Library:
 *   import { minimizeFixture } from '../scripts/minimize-provider-fixture.mjs'
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { schemaFingerprint, scanForResidualSecrets } from './sanitize-provider-fixture.mjs'

export const SHAPE_REPEAT_LIMIT = 2
export const ARRAY_SHAPE_LIMIT = 2
export const ARRAY_MAX_ITEMS = 4
export const OFFCHAIN_DEPTH = 2
export const SHORT_PAGE_ITEMS = 3
export const MAX_STRING = 240

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const SYNTHETIC_TEXT = /^Synthetic (message|title) \d+$/

/** Collapse sanitizer counters ("Synthetic message 42") so equal shapes compare equal. */
const canon = value => (typeof value === 'string' && SYNTHETIC_TEXT.test(value) ? 'S' : value)

/** Value-independent structure: key names and types; arrays by the set of item shapes. */
export function skeleton(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${[...new Set(value.map(skeleton))].sort().join('|')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${key}:${skeleton(value[key])}`).join(',')}}`
  }
  return typeof value === 'string' ? 's' : typeof value === 'number' ? 'n' : 'b'
}

function truncateStrings(value) {
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value
  if (Array.isArray(value)) return value.map(truncateStrings)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, truncateStrings(child)]))
  return value
}

function trimRepeatedItems(value) {
  if (Array.isArray(value)) {
    const seen = new Map()
    const kept = []
    for (const item of value) {
      const shape = skeleton(item)
      const count = seen.get(shape) ?? 0
      if (count < ARRAY_SHAPE_LIMIT && kept.length < ARRAY_MAX_ITEMS) kept.push(trimRepeatedItems(item))
      seen.set(shape, count + 1)
    }
    return kept
  }
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, trimRepeatedItems(child)]))
  return value
}

// ChatGPT ---------------------------------------------------------------------

function partKinds(parts) {
  if (!Array.isArray(parts)) return 'none'
  const kinds = parts.map(part => (typeof part === 'string' ? 'string' : isRecord(part) ? `object:${canon(part.content_type)}` : typeof part))
  return `${parts.length === 0 ? 0 : parts.length === 1 ? 1 : 'many'}:${[...new Set(kinds)].sort().join('|')}`
}

function nodeSignature(node) {
  const message = node?.message
  if (!message) return 'no-message'
  const recipient = message.recipient
  const metadata = isRecord(message.metadata) ? message.metadata : {}
  const nonEmpty = value => (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null)
  return JSON.stringify([
    message.author?.role,
    canon(message.content?.content_type),
    recipient === undefined || recipient === null || recipient === 'all' ? recipient ?? null : 'other',
    canon(message.channel ?? null),
    canon(message.status),
    metadata.is_visually_hidden_from_conversation === true,
    partKinds(message.content?.parts),
    // Parser-relevant flags: reference extraction, tool-call events, error status, named tools.
    nonEmpty(metadata.content_references) || nonEmpty(metadata.citations),
    typeof metadata.tool_call_id === 'string',
    metadata.is_error === true,
    typeof message.author?.name === 'string',
  ])
}

function hasVisibleImagePart(node) {
  const message = node?.message
  if (!message || !['user', 'assistant'].includes(message.author?.role)) return false
  if (message.metadata?.is_visually_hidden_from_conversation) return false
  if (message.recipient && message.recipient !== 'all') return false
  return Array.isArray(message.content?.parts) && message.content.parts.some(part => part?.content_type === 'image_asset_pointer')
}

function minimizeChatGptDetail(detail) {
  const mapping = detail?.mapping
  const currentNode = detail?.current_node
  if (!isRecord(mapping) || typeof currentNode !== 'string' || !isRecord(mapping[currentNode])) return detail

  const chain = []
  const onChain = new Set()
  for (let id = currentNode; typeof id === 'string' && mapping[id] && !onChain.has(id); id = mapping[id].parent) {
    onChain.add(id)
    chain.unshift(id)
  }
  // An unresolved chain (cycle or missing parent) is evidence the tests may rely on; keep it whole.
  if (mapping[chain[0]].parent !== null) return detail

  const keep = new Set([chain[0], currentNode])
  for (const id of chain) {
    const children = mapping[id].children ?? []
    if (children.length > 1) {
      keep.add(id)
      for (const child of children) if (onChain.has(child)) keep.add(child)
    }
    if (hasVisibleImagePart(mapping[id])) keep.add(id)
  }

  const shapeCounts = new Map()
  const seenPairs = new Set()
  let previousSignature = null
  let previousId = null
  for (const id of chain) {
    const signature = nodeSignature(mapping[id])
    const pair = `${previousSignature}->${signature}`
    const count = shapeCounts.get(signature) ?? 0
    if (count < SHAPE_REPEAT_LIMIT) keep.add(id)
    if (!seenPairs.has(pair)) {
      // A new transition is only preserved if both of its nodes survive.
      keep.add(id)
      if (previousId) keep.add(previousId)
    }
    shapeCounts.set(signature, count + 1)
    seenPairs.add(pair)
    previousSignature = signature
    previousId = id
  }

  // Off-chain branches hang from branch points (kept above); keep them to a shallow depth.
  const keepOffChain = (id, depth) => {
    if (depth > OFFCHAIN_DEPTH || onChain.has(id) || !mapping[id]) return
    keep.add(id)
    for (const child of mapping[id].children ?? []) keepOffChain(child, depth + 1)
  }
  for (const id of chain) {
    const children = mapping[id].children ?? []
    if (children.length > 1) for (const child of children) keepOffChain(child, 1)
  }

  const keptChain = chain.filter(id => keep.has(id))
  const nextKept = new Map(keptChain.map((id, index) => [id, keptChain[index + 1]]))
  const previousKept = new Map(keptChain.map((id, index) => [id, index === 0 ? null : keptChain[index - 1]]))

  const minimized = {}
  for (const [id, node] of Object.entries(mapping)) {
    if (!keep.has(id)) continue
    const next = { ...node }
    if (onChain.has(id)) {
      next.parent = previousKept.get(id)
      const originalChildren = node.children ?? []
      next.children = originalChildren.length > 1
        ? originalChildren.filter(child => keep.has(child))
        : nextKept.get(id) ? [nextKept.get(id)] : []
    } else {
      next.children = (node.children ?? []).filter(child => keep.has(child))
    }
    if (isRecord(next.message)) {
      const message = { ...next.message }
      if (isRecord(message.metadata)) message.metadata = trimRepeatedItems(message.metadata)
      if (isRecord(message.author) && isRecord(message.author.metadata)) {
        message.author = { ...message.author, metadata: trimRepeatedItems(message.author.metadata) }
      }
      next.message = message
    }
    minimized[id] = next
  }
  return { ...detail, mapping: minimized }
}

/** Conversation-level arrays (safe_urls, ...) repeat the same item shape; keep a few of each. */
function trimDetailEnvelope(detail) {
  if (!isRecord(detail)) return detail
  return Object.fromEntries(Object.entries(detail).map(([key, value]) => [key, key === 'mapping' ? value : trimRepeatedItems(value)]))
}

function minimizeChatGptListPages(listPages) {
  if (!Array.isArray(listPages) || listPages.length === 0) return listPages
  const limit = listPages[0].limit
  if (!Number.isInteger(limit) || limit <= 0) return listPages
  const itemsOf = page => (Array.isArray(page.items) ? page.items : [])
  const last = listPages[listPages.length - 1]
  const fullPages = listPages.slice(0, -1).filter(page => itemsOf(page).length === limit)
  const lastIsFull = itemsOf(last).length >= limit
  const kept = []
  if (listPages.length > 1) {
    kept.push(fullPages[0] ?? listPages[0])
    kept.push({ ...last, items: lastIsFull ? itemsOf(last) : itemsOf(last).slice(0, SHORT_PAGE_ITEMS) })
  } else {
    kept.push({ ...last, items: lastIsFull ? itemsOf(last) : itemsOf(last).slice(0, SHORT_PAGE_ITEMS) })
  }
  return kept.map((page, index) => {
    const offset = index * limit
    const more = index < kept.length - 1
    return { ...page, offset, total: more ? offset + limit + 1 : offset + itemsOf(page).length }
  })
}

// Entry point -------------------------------------------------------------------

/**
 * Shrink a fixture envelope. Pure and deterministic: the same input always
 * yields the same output, and minimizing the output again is a no-op.
 */
export function minimizeFixture(fixture) {
  if (fixture?.provider !== 'chatgpt') {
    throw new Error(`Unsupported provider for minimization: ${String(fixture?.provider)}`)
  }
  // Already minimized: the output is a fixed point, so return it unchanged.
  if (fixture.minimization?.script) return fixture
  const payload = fixture.payload
  const original = {
    listPageItems: (payload.listPages ?? []).map(page => (page.items ?? []).length),
    detailNodes: (payload.details ?? []).map(detail => Object.keys(detail.mapping ?? {}).length),
  }
  const minimizedPayload = truncateStrings({
    ...payload,
    listPages: minimizeChatGptListPages(payload.listPages),
    details: (payload.details ?? []).map(detail => trimDetailEnvelope(minimizeChatGptDetail(detail))),
  })
  const { schemaFingerprint: _fingerprint, ...envelope } = fixture
  return {
    ...envelope,
    schemaFingerprint: schemaFingerprint(minimizedPayload),
    minimization: { script: 'scripts/minimize-provider-fixture.mjs', original },
    payload: minimizedPayload,
  }
}

/**
 * Pretty-print like the sanitizer (2-space indent) down to FORMAT_COMPACT_DEPTH,
 * then one line per value, so each list item and each mapping node is a single
 * line. This keeps diffs reviewable and avoids deep-indentation whitespace.
 */
export const FORMAT_COMPACT_DEPTH = 5
export function formatFixture(value, depth = 0) {
  if (depth >= FORMAT_COMPACT_DEPTH || typeof value !== 'object' || value === null) return JSON.stringify(value)
  const pad = '  '.repeat(depth + 1)
  const close = '  '.repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map(item => pad + formatFixture(item, depth + 1)).join(',\n')}\n${close}]`
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(([key, child]) => `${pad}${JSON.stringify(key)}: ${formatFixture(child, depth + 1)}`).join(',\n')}\n${close}}`
}

function countFindings(value) {
  const counts = {}
  for (const finding of scanForResidualSecrets(value)) counts[finding.pattern] = (counts[finding.pattern] ?? 0) + 1
  return counts
}

function main(argv) {
  const check = argv.includes('--check')
  const positional = argv.filter(arg => arg !== '--check')
  const [inputPath, outputPath = inputPath] = positional
  if (!inputPath) {
    console.error('Usage: node scripts/minimize-provider-fixture.mjs <fixture.json> [output.json] [--check]')
    process.exit(2)
  }
  const input = JSON.parse(readFileSync(inputPath, 'utf8'))
  const output = minimizeFixture(input)
  const text = formatFixture(output) + '\n'
  writeFileSync(outputPath, text)
  console.log(`Minimized fixture written (${Buffer.byteLength(text)} bytes).`)
  console.log(`schemaFingerprint: ${output.schemaFingerprint}`)

  if (check) {
    const before = countFindings(input)
    const after = countFindings(output)
    const total = Object.values(after).reduce((sum, count) => sum + count, 0)
    console.log(`Residual-secret findings: input ${JSON.stringify(before)}, output ${JSON.stringify(after)}`)
    if (total > 0) {
      console.error('Residual secret patterns detected in minimized output.')
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
    // Never echo fixture content: report only the failure class.
    console.error(`minimize-provider-fixture: ${error instanceof Error && error.message.startsWith('Unsupported') ? error.message : 'unable to minimize input'}`)
    process.exit(2)
  }
}
