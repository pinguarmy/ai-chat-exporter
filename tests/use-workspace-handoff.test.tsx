/**
 * useWorkspaceHandoff: restoring popup state in the full workspace (?ws=<id>)
 * and creating the hand-off. workspace-session storage is mocked; the hook's
 * ordering rules are what is under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { mergeExtensionSettings, type ExportFormat, type ExtensionSettings } from '../src/core/types'
import type { TabMode } from '../src/components/popup/popup-utils'

const consumeWorkspaceSession = vi.fn()
const createWorkspaceSession = vi.fn()
vi.mock('../src/platform/workspace-session', () => ({
  consumeWorkspaceSession: (...args: unknown[]) => consumeWorkspaceSession(...args),
  createWorkspaceSession: (...args: unknown[]) => createWorkspaceSession(...args),
}))

import { useHandoffRefs } from '../src/components/popup/hooks/useHandoffRefs'
import { useWorkspaceHandoff } from '../src/components/popup/hooks/useWorkspaceHandoff'
import { useState, useRef } from 'react'

const TAB_ID = 9
const T = (key: string) => key
const payload = {
  sourceTabId: TAB_ID,
  tabMode: 'bulk' as const,
  format: 'pdf' as ExportFormat,
  selectedIds: ['a', 'b'],
  searchQuery: 'needle',
  bulkFromDate: '2026-01-01',
  bulkToDate: '2026-02-01',
  bulkSelectionLimit: '25',
  settingsPatch: { includeImages: false } as Partial<ExtensionSettings>,
}

let tabsCreate: ReturnType<typeof vi.fn>

beforeEach(() => {
  consumeWorkspaceSession.mockReset()
  createWorkspaceSession.mockReset()
  tabsCreate = vi.fn(async () => ({}))
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn(async () => [{ id: TAB_ID }]), get: vi.fn(), create: tabsCreate },
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

/** Owns the popup state the hook writes into, like the Popup shell does. */
function useHarness(initialSettings: ExtensionSettings | null = null) {
  const handoff = useHandoffRefs()
  const [settings, setSettings] = useState<ExtensionSettings | null>(initialSettings)
  const pendingSettingsRef = useRef<Partial<ExtensionSettings>>({})
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [tabMode, setTabMode] = useState<TabMode>('current')
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [bulkFromDate, setBulkFromDate] = useState('')
  const [bulkToDate, setBulkToDate] = useState('')
  const [bulkSelectionLimit, setBulkSelectionLimit] = useState('100')
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null)
  const [workspaceHandoffError, setWorkspaceHandoffError] = useState(false)
  const fetchConversationList = vi.fn(async () => undefined)
  const fetchRef = useRef(fetchConversationList)
  const hook = useWorkspaceHandoff({
    T, handoff, settings, setSettings, pendingSettingsRef, setSettingsDirty,
    tabMode, setTabMode, format, setFormat, selectedIds, setSelectedIds,
    searchQuery, setSearchQuery, bulkFromDate, setBulkFromDate, bulkToDate, setBulkToDate,
    bulkSelectionLimit, setBulkSelectionLimit, setHandoffNotice, setWorkspaceHandoffError,
    fetchConversationList: fetchRef.current,
  })
  return {
    ...hook, handoff, settings, setSettings, setFormat, pendingSettingsRef, settingsDirty, tabMode, format,
    selectedIds, searchQuery, bulkFromDate, bulkToDate, bulkSelectionLimit, handoffNotice,
    workspaceHandoffError, fetchConversationList: fetchRef.current,
  }
}

describe('useWorkspaceHandoff restore', () => {
  it('does nothing without a ?ws= id', async () => {
    renderHook(() => useHarness())
    await act(async () => { await Promise.resolve() })
    expect(consumeWorkspaceSession).not.toHaveBeenCalled()
  })

  it('restores UI state, loads the list in bulk mode and keeps the selection for reconciliation', async () => {
    window.history.pushState({}, '', `/popup.html?sourceTab=${TAB_ID}&ws=abc`)
    consumeWorkspaceSession.mockResolvedValue({ ok: true, payload })
    const { result } = renderHook(() => useHarness())

    await waitFor(() => expect(result.current.tabMode).toBe('bulk'))
    expect(consumeWorkspaceSession).toHaveBeenCalledWith('abc', TAB_ID)
    expect(result.current.selectedIds).toEqual(['a', 'b'])
    expect(result.current.searchQuery).toBe('needle')
    expect(result.current.bulkFromDate).toBe('2026-01-01')
    expect(result.current.bulkToDate).toBe('2026-02-01')
    expect(result.current.bulkSelectionLimit).toBe('25')
    expect(result.current.handoff.restoredSelectionRef.current).toEqual(['a', 'b'])
    // A successful restore owns the next detection reset, and nothing is "in flight" afterwards.
    expect(result.current.handoff.handoffResetSkipRef.current).toBe(true)
    await waitFor(() => expect(result.current.handoff.handoffInflightRef.current).toBe(false))
    expect(result.current.fetchConversationList).toHaveBeenCalledTimes(1)
  })

  it('re-applies the restored format and merges session settings once stored settings load', async () => {
    window.history.pushState({}, '', `/popup.html?sourceTab=${TAB_ID}&ws=abc`)
    consumeWorkspaceSession.mockResolvedValue({ ok: true, payload })
    const { result } = renderHook(() => useHarness())

    await waitFor(() => expect(result.current.tabMode).toBe('bulk'))
    expect(result.current.format).toBe('pdf')
    // The session patch must wait for stored settings; it is not merged or marked dirty yet.
    expect(result.current.handoff.handoffFormatRef.current).toBe('pdf')
    expect(result.current.settingsDirty).toBe(false)

    // Stored settings finish loading and (like loadSettings) reset the format to the default.
    act(() => {
      result.current.setFormat('markdown')
      result.current.setSettings(mergeExtensionSettings({ locale: 'en', includeImages: true }))
    })

    await waitFor(() => expect(result.current.format).toBe('pdf'))
    expect(result.current.handoff.handoffFormatRef.current).toBeNull()
    await waitFor(() => expect(result.current.settings?.includeImages).toBe(false))
    expect(result.current.pendingSettingsRef.current).toEqual({ includeImages: false })
    expect(result.current.settingsDirty).toBe(true)
  })

  it('explains an expired hand-off and applies nothing', async () => {
    window.history.pushState({}, '', `/popup.html?sourceTab=${TAB_ID}&ws=old`)
    consumeWorkspaceSession.mockResolvedValue({ ok: false, reason: 'expired' })
    const { result } = renderHook(() => useHarness())

    await waitFor(() => expect(result.current.handoffNotice).toBe('The workspace handoff expired or was already used. Defaults were restored; please reselect conversations.'))
    expect(result.current.tabMode).toBe('current')
    expect(result.current.handoff.handoffResetSkipRef.current).toBe(false)
    expect(result.current.handoff.handoffInflightRef.current).toBe(false)
  })

  it('names a tab mismatch separately', async () => {
    window.history.pushState({}, '', `/popup.html?sourceTab=${TAB_ID}&ws=other`)
    consumeWorkspaceSession.mockResolvedValue({ ok: false, reason: 'tab-mismatch' })
    const { result } = renderHook(() => useHarness())

    await waitFor(() => expect(result.current.handoffNotice).toBe('This workspace handoff belongs to a different tab. Defaults were restored; please reselect conversations.'))
  })

  it('treats a storage failure as an expired hand-off', async () => {
    window.history.pushState({}, '', `/popup.html?ws=boom`)
    consumeWorkspaceSession.mockRejectedValue(new Error('storage'))
    const { result } = renderHook(() => useHarness())

    await waitFor(() => expect(result.current.handoffNotice).toContain('expired or was already used'))
    expect(consumeWorkspaceSession).toHaveBeenCalledWith('boom', undefined)
  })
})

describe('useWorkspaceHandoff openWorkspace', () => {
  it('opens the workspace with only the hand-off id in the URL', async () => {
    createWorkspaceSession.mockResolvedValue('session-1')
    const { result } = renderHook(() => useHarness())
    act(() => { result.current.pendingSettingsRef.current = { includeImages: false } })

    await act(async () => { await result.current.openWorkspace() })

    expect(createWorkspaceSession).toHaveBeenCalledWith(expect.objectContaining({
      sourceTabId: TAB_ID,
      tabMode: 'current',
      format: 'markdown',
      selectedIds: [],
      settingsPatch: { includeImages: false },
    }))
    expect(tabsCreate).toHaveBeenCalledWith({
      url: `chrome-extension://test/tabs/export-workspace.html?sourceTab=${TAB_ID}&ws=session-1`,
    })
  })

  it('stays in the popup and flags the failure when session storage is unavailable', async () => {
    createWorkspaceSession.mockRejectedValue(new Error('unavailable'))
    const { result } = renderHook(() => useHarness())

    await act(async () => { await result.current.openWorkspace() })

    expect(tabsCreate).not.toHaveBeenCalled()
    expect(result.current.workspaceHandoffError).toBe(true)
  })

  it('opens without a selection only when explicitly asked', async () => {
    const { result } = renderHook(() => useHarness())

    await act(async () => { await result.current.openWorkspace(true) })

    expect(createWorkspaceSession).not.toHaveBeenCalled()
    expect(tabsCreate).toHaveBeenCalledWith({ url: `chrome-extension://test/tabs/export-workspace.html?sourceTab=${TAB_ID}` })
  })
})
