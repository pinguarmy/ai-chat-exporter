import { describe, expect, it } from 'vitest'
import {
  applyBulkSelectionToFiltered,
  dedupeSelectionIds,
  filterConversationsByTitle,
  parseBulkCalendarDate,
  selectBulkConversations,
  toggleSelectAllVisible,
  toggleSingleSelection,
} from '../src/lib/bulk-selection'
import type { ConversationListItem } from '../src/lib/types'

const item = (id: string, createdAt?: number, title?: string): ConversationListItem => ({
  id,
  title: title ?? id,
  url: '',
  platform: 'chatgpt',
  createdAt,
})

describe('bulk selection criteria and dates', () => {
  it('rejects impossible calendar dates instead of normalizing them', () => {
    expect(parseBulkCalendarDate('2026-02-30')).toBeNull()
    expect(parseBulkCalendarDate('2026-13-01')).toBeNull()
  })

  it('treats date bounds as inclusive local calendar days', () => {
    const from = parseBulkCalendarDate('2026-06-08')!
    const to = parseBulkCalendarDate('2026-06-08', true)!
    const result = selectBulkConversations([
      item('start', from),
      item('end', to),
      item('next', to + 1),
    ], { from: '2026-06-08', to: '2026-06-08', limit: 10 })

    expect(result.map(entry => entry.id)).toEqual(['end', 'start'])
  })

  it('does not guess dates for provider list items that have no timestamp', () => {
    const result = selectBulkConversations([
      item('dated', parseBulkCalendarDate('2026-06-08')!),
      item('unknown'),
    ], { from: '2026-06-08', to: '2026-06-08', limit: 10 })

    expect(result.map(entry => entry.id)).toEqual(['dated'])
  })

  it('uses a provider activity timestamp only when an exact creation date is unavailable', () => {
    const activityTime = parseBulkCalendarDate('2026-06-08')!
    const result = selectBulkConversations([
      { ...item('gemini-activity'), platform: 'gemini', updatedAt: activityTime },
      { ...item('unknown'), platform: 'gemini' },
    ], { from: '2026-06-08', to: '2026-06-08', limit: 10 })

    expect(result.map(entry => entry.id)).toEqual(['gemini-activity'])
  })

  it('applies the requested cap and excludes already archived IDs', () => {
    const result = selectBulkConversations([
      item('one', 1),
      item('two', 2),
      item('three', 3),
    ], { limit: 1, excludedIds: ['three'] })

    expect(result.map(entry => entry.id)).toEqual(['two'])
  })
})

describe('bulk search and cross-filter selection', () => {
  const conversations: ConversationListItem[] = [
    item('c1', 100, 'TypeScript Architecture Guide'),
    item('c2', 200, 'Python Data Analysis Tutorial'),
    item('c3', 300, 'Rust Memory Safety Deep Dive'),
    item('c4', 400, 'typescript performance tuning'),
    item('c5', 500, ''),
  ]

  it('performs case-insensitive title search and trims whitespace', () => {
    expect(filterConversationsByTitle(conversations, 'typescript').map(c => c.id)).toEqual(['c1', 'c4'])
    expect(filterConversationsByTitle(conversations, '  TYPESCRIPT  ').map(c => c.id)).toEqual(['c1', 'c4'])
    expect(filterConversationsByTitle(conversations, 'python').map(c => c.id)).toEqual(['c2'])
    expect(filterConversationsByTitle(conversations, 'RUST').map(c => c.id)).toEqual(['c3'])
  })

  it('returns all conversations when search query is empty or whitespace', () => {
    expect(filterConversationsByTitle(conversations, '').map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(filterConversationsByTitle(conversations, '   ').map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
  })

  it('handles conversations with empty or missing titles safely', () => {
    const emptyResult = filterConversationsByTitle(conversations, 'nonexistent query')
    expect(emptyResult).toEqual([])
  })

  it('deduplicates selection IDs and preserves order', () => {
    expect(dedupeSelectionIds(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
    expect(dedupeSelectionIds([])).toEqual([])
  })

  it('toggles single selection with deduplication', () => {
    let selected: string[] = []
    selected = toggleSingleSelection(selected, 'c1')
    expect(selected).toEqual(['c1'])

    selected = toggleSingleSelection(selected, 'c2')
    expect(selected.sort()).toEqual(['c1', 'c2'])

    selected = toggleSingleSelection(selected, 'c1')
    expect(selected).toEqual(['c2'])
  })

  it('preserves cross-filter selections when searching and switching queries', () => {
    let selectedIds: string[] = []

    // Step 1: Search "Python", filter yields c2
    const pythonResults = filterConversationsByTitle(conversations, 'python')
    expect(pythonResults.map(c => c.id)).toEqual(['c2'])

    // Select c2 under "python" filter
    selectedIds = toggleSingleSelection(selectedIds, 'c2')
    expect(selectedIds).toEqual(['c2'])

    // Step 2: Switch search to "Rust", filter yields c3
    const rustResults = filterConversationsByTitle(conversations, 'rust')
    expect(rustResults.map(c => c.id)).toEqual(['c3'])
    // Previously selected c2 is retained even though not visible
    expect(selectedIds).toEqual(['c2'])

    // Select c3 under "rust" filter
    selectedIds = toggleSingleSelection(selectedIds, 'c3')
    expect(selectedIds.sort()).toEqual(['c2', 'c3'])

    // Step 3: Clear search -> both c2 and c3 are still selected!
    const all = filterConversationsByTitle(conversations, '')
    expect(all.length).toBe(5)
    expect(selectedIds.sort()).toEqual(['c2', 'c3'])
  })

  it('Select all strictly applies to currently visible search results only', () => {
    // User already has 'c2' (Python) selected
    let selectedIds = ['c2']

    // Search for "typescript" -> visible items: c1, c4
    const visible = filterConversationsByTitle(conversations, 'typescript')
    expect(visible.map(c => c.id)).toEqual(['c1', 'c4'])

    // Select all visible: should add c1 and c4, keeping c2
    selectedIds = toggleSelectAllVisible(selectedIds, visible)
    expect(selectedIds.sort()).toEqual(['c1', 'c2', 'c4'])

    // Click Deselect all visible: since all visible (c1, c4) are selected,
    // it deselects ONLY c1 and c4; c2 MUST stay selected!
    selectedIds = toggleSelectAllVisible(selectedIds, visible)
    expect(selectedIds).toEqual(['c2'])
  })

  it('shortcut date and quantity selection acts only on current filtered results and does not cancel other selections', () => {
    const list: ConversationListItem[] = [
      item('c1', parseBulkCalendarDate('2026-06-01')!, 'ChatGPT Prompt 1'),
      item('c2', parseBulkCalendarDate('2026-06-08')!, 'ChatGPT Prompt 2'),
      item('c3', parseBulkCalendarDate('2026-06-08')!, 'Claude Coding Guide'),
      item('c4', parseBulkCalendarDate('2026-06-15')!, 'Claude Architecture'),
    ]

    // User already has c3 selected under "Claude" search
    let selectedIds = ['c3']

    // Filter by "ChatGPT" -> visible items: c1, c2
    const visible = filterConversationsByTitle(list, 'ChatGPT')
    expect(visible.map(c => c.id)).toEqual(['c1', 'c2'])

    // Apply shortcut selection for 2026-06-08 with limit 1 on visible items
    selectedIds = applyBulkSelectionToFiltered(selectedIds, visible, {
      from: '2026-06-08',
      to: '2026-06-08',
      limit: 1,
    })

    // Must select c2 (matching ChatGPT on 2026-06-08) AND keep c3 (Claude selection)
    expect(selectedIds.sort()).toEqual(['c2', 'c3'])
    // c3 was not canceled!
    expect(selectedIds).toContain('c3')
  })

  it('shortcut selection with multiple items dedupes and respects limits within filtered results', () => {
    const list: ConversationListItem[] = [
      item('c1', parseBulkCalendarDate('2026-06-08')!, 'Doc A'),
      item('c2', parseBulkCalendarDate('2026-06-08')!, 'Doc B'),
      item('c3', parseBulkCalendarDate('2026-06-08')!, 'Other C'),
    ]

    // Currently 'c3' is selected (outside "Doc" filter)
    // and 'c1' was already selected inside "Doc"
    const prev = ['c3', 'c1']

    // Visible: c1, c2
    const visible = filterConversationsByTitle(list, 'Doc')

    // Apply shortcut with limit 1 on visible Doc items
    const result = applyBulkSelectionToFiltered(prev, visible, {
      from: '2026-06-08',
      to: '2026-06-08',
      limit: 1,
    })

    // 'c3' outside visible is kept
    expect(result).toContain('c3')
    // Within visible, only 1 item matched and selected
    const visibleSelected = result.filter(id => id === 'c1' || id === 'c2')
    expect(visibleSelected.length).toBe(1)
    // No duplicates
    expect(new Set(result).size).toBe(result.length)
  })
})
