import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import chatgptFixture from '../fixtures/providers/chatgpt/2026-08-24-normal.json'
import { must } from '../helpers/chrome-mock'

let minimizeFixture: typeof import('../../scripts/minimize-provider-fixture.mjs').minimizeFixture
let scanForResidualSecrets: typeof import('../../scripts/sanitize-provider-fixture.mjs').scanForResidualSecrets
let resolveChatGptActiveBranch: typeof import('../../src/contents/chatgpt-parser').resolveChatGptActiveBranch

beforeAll(async () => {
  // The parser module registers a runtime message listener on import.
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {})
      }
    },
    runtime: { onMessage: { addListener: vi.fn() }, getURL: vi.fn((path: string) => path) }
  })
  ;({ resolveChatGptActiveBranch } = await import('../../src/contents/chatgpt-parser'))
  ;({ minimizeFixture } = await import('../../scripts/minimize-provider-fixture.mjs'))
  ;({ scanForResidualSecrets } = await import('../../scripts/sanitize-provider-fixture.mjs'))
})

const node = (
  id: string,
  parent: string | null,
  children: string[],
  role: string,
  contentType = 'text',
  extra: Record<string, unknown> = {}
) => ({
  id,
  parent,
  children,
  message:
    parent === null
      ? null
      : {
          id,
          author: { role, name: null, metadata: {} },
          create_time: 1_700_000_000,
          content: { content_type: contentType, parts: ['Synthetic message 1'] as unknown[] },
          status: 'finished_successfully',
          metadata: { items: Array.from({ length: 12 }, (_, i) => ({ n: i })) },
          ...extra
        }
})

/** root -> (user, assistant, tool) x 20 -> leaf, with one off-chain sibling under n3. */
function syntheticFixture() {
  const ids = ['root', ...Array.from({ length: 60 }, (_, i) => `n${i}`)]
  const roles = ['user', 'assistant', 'tool']
  const mapping: Record<string, ReturnType<typeof node>> = {}
  ids.forEach((id, i) => {
    mapping[id] = node(
      id,
      i === 0 ? null : ids[i - 1],
      i + 1 < ids.length ? [ids[i + 1]] : [],
      roles[(i - 1) % 3] ?? 'user'
    )
  })
  mapping.n3.children = ['n4', 'side']
  mapping.side = node('side', 'n3', [], 'assistant')
  must(mapping.n10.message, 'n10 message').content.parts = [
    { content_type: 'image_asset_pointer', asset_pointer: 'sediment://synthetic' }
  ]
  const items = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `item-${count}-${i}`,
      title: 'Synthetic title 1'
    }))
  return {
    provider: 'chatgpt',
    capturedAt: '2023-11-14T22:13:20.000Z',
    source: 'real-sanitized',
    scenario: 'normal',
    schemaFingerprint: 'x',
    payload: {
      session: '[redacted]',
      listPages: [
        { items: items(100), total: 101, limit: 100, offset: 0 },
        { items: items(100), total: 201, limit: 100, offset: 100 },
        { items: items(100), total: 301, limit: 100, offset: 200 },
        { items: items(40), total: 340, limit: 100, offset: 300 }
      ],
      details: [{ conversation_id: 'c', mapping, current_node: 'n59', long: 'x'.repeat(1000) }]
    }
  }
}

interface ListPage {
  items: unknown[]
  offset: number
  total: number
  limit: number
}

describe('provider fixture minimizer', () => {
  it('keeps one full page and a short last page with contiguous pagination counters', () => {
    const result = minimizeFixture(syntheticFixture())
    const pages = result.payload.listPages
    expect(
      pages.map((page: ListPage) => [page.items.length, page.offset, page.total, page.limit])
    ).toEqual([
      [100, 0, 101, 100],
      [3, 100, 103, 100]
    ])
  })

  it('relinks the active branch as one root-to-leaf chain and keeps required nodes', () => {
    const fixture = syntheticFixture()
    const result = minimizeFixture(fixture)
    const detail = result.payload.details[0]
    const ids = Object.keys(detail.mapping)
    expect(ids.length).toBeLessThan(Object.keys(fixture.payload.details[0].mapping).length / 2)
    expect(detail.current_node).toBe('n59')
    expect(
      resolveChatGptActiveBranch(
        detail.mapping as unknown as Parameters<typeof resolveChatGptActiveBranch>[0],
        detail.current_node
      ).complete
    ).toBe(true)
    // Root, leaf, the image-bearing node, and the branch point with both children survive.
    for (const required of ['root', 'n59', 'n10', 'n3', 'n4', 'side'])
      expect(ids).toContain(required)
    expect(detail.mapping.n3.children).toEqual(['n4', 'side'])
    expect(detail.mapping.side.parent).toBe('n3')
    // Repeated same-shape metadata items and long strings are trimmed.
    expect(detail.mapping.n10.message.metadata.items.length).toBeLessThanOrEqual(2)
    expect(detail.long).toHaveLength(240)
    // Every kept node is reachable from the root exactly once.
    const reachable = new Set<string>()
    const visit = (id: string) => {
      reachable.add(id)
      detail.mapping[id].children.forEach(visit)
    }
    visit('root')
    expect([...reachable].sort()).toEqual([...ids].sort())
  })

  it('is deterministic, idempotent and never introduces residual secret patterns', () => {
    const first = minimizeFixture(syntheticFixture())
    expect(minimizeFixture(syntheticFixture())).toEqual(first)
    expect(minimizeFixture(first)).toBe(first)
    expect(scanForResidualSecrets(first)).toEqual([])
  })

  it('rejects providers it has no minimization rules for', () => {
    expect(() => minimizeFixture({ provider: 'claude', payload: {} })).toThrow(
      /Unsupported provider/
    )
  })
})

describe('committed ChatGPT fixture', () => {
  const payload = chatgptFixture.payload

  it('stays small', () => {
    expect(
      statSync(resolve(__dirname, '../fixtures/providers/chatgpt/2026-08-24-normal.json')).size
    ).toBeLessThan(500_000)
  })

  it('still exercises full-page then short-page pagination', () => {
    const pages = payload.listPages
    expect(pages.length).toBeGreaterThanOrEqual(2)
    for (const page of pages.slice(0, -1)) expect(page.items).toHaveLength(page.limit)
    const lastPage = must(pages.at(-1))
    expect(lastPage.items.length).toBeGreaterThan(0)
    expect(lastPage.items.length).toBeLessThan(lastPage.limit)
  })

  it('keeps every detail a complete, verifiable active branch', () => {
    for (const detail of payload.details) {
      expect(
        resolveChatGptActiveBranch(
          detail.mapping as unknown as Parameters<typeof resolveChatGptActiveBranch>[0],
          detail.current_node
        )
      ).toMatchObject({ complete: true })
    }
    // Branch shape: edited/regenerated siblings stay off the active chain.
    const branchPoints = payload.details.flatMap(detail =>
      Object.values(detail.mapping).filter(entry => entry.children.length > 1)
    )
    expect(branchPoints.length).toBe(2)
  })
})
