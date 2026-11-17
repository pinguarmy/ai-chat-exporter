/**
 * Workspace hand-off: restore state passed from the popup to the full export
 * workspace (?ws=<id>) at mount, apply the restored format/settings once
 * stored settings have loaded, and create the hand-off when opening it.
 */

import { useEffect, useState } from 'react'
import { consumeWorkspaceSession, createWorkspaceSession } from '../../../lib/workspace-session'
import { mergeExtensionSettings } from '../../../lib/types'
import type { ExportFormat, ExtensionSettings } from '../../../lib/types'
import { targetTabs, type TabMode, type Translate } from '../popup-utils'
import type { HandoffRefs } from './useHandoffRefs'
import type { MutableRefObject } from 'react'

interface Options {
  T: Translate
  handoff: HandoffRefs
  settings: ExtensionSettings | null
  setSettings: (update: (previous: ExtensionSettings | null) => ExtensionSettings) => void
  pendingSettingsRef: MutableRefObject<Partial<ExtensionSettings>>
  setSettingsDirty: (dirty: boolean) => void
  tabMode: TabMode
  setTabMode: (mode: TabMode) => void
  format: ExportFormat
  setFormat: (format: ExportFormat) => void
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  bulkFromDate: string
  setBulkFromDate: (value: string) => void
  bulkToDate: string
  setBulkToDate: (value: string) => void
  bulkSelectionLimit: string
  setBulkSelectionLimit: (value: string) => void
  setHandoffNotice: (notice: string | null) => void
  setWorkspaceHandoffError: (failed: boolean) => void
  fetchConversationList: () => Promise<void>
}

export function useWorkspaceHandoff({
  T, handoff, settings, setSettings, pendingSettingsRef, setSettingsDirty,
  tabMode, setTabMode, format, setFormat, selectedIds, setSelectedIds,
  searchQuery, setSearchQuery, bulkFromDate, setBulkFromDate, bulkToDate, setBulkToDate,
  bulkSelectionLimit, setBulkSelectionLimit, setHandoffNotice, setWorkspaceHandoffError,
  fetchConversationList,
}: Options) {
  const {
    restoredSelectionRef, handoffRestoredRef, handoffInflightRef, handoffResetSkipRef, handoffFormatRef,
  } = handoff
  const [handoffPatch, setHandoffPatch] = useState<Partial<ExtensionSettings> | null>(null)

  // Restore a workspace hand-off (?ws=<id>) starting at mount — before the
  // first detection can clear state. The hand-off is single-use, tab-bound,
  // and expires quickly; any failure is surfaced instead of silently falling
  // back to defaults. Conversation content is never part of the hand-off —
  // the list is re-read and restored ids are reconciled in fetchConversationList.
  useEffect(() => {
    if (handoffRestoredRef.current) return
    handoffRestoredRef.current = true
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('ws')
    if (!sessionId) return
    handoffInflightRef.current = true
    const sourceTab = params.get('sourceTab')
    const boundTabId = sourceTab && /^\d+$/.test(sourceTab) ? Number(sourceTab) : undefined
    void (async () => {
      const result = await consumeWorkspaceSession(sessionId, boundTabId)
      if (result.ok === false) {
        setHandoffNotice(result.reason === 'tab-mismatch'
          ? T('This workspace handoff belongs to a different tab. Defaults were restored; please reselect conversations.')
          : T('The workspace handoff expired or was already used. Defaults were restored; please reselect conversations.'))
        return
      }
      const payload = result.payload
      handoffFormatRef.current = payload.format
      handoffResetSkipRef.current = true
      setTabMode(payload.tabMode)
      setFormat(payload.format)
      setSelectedIds(payload.selectedIds)
      restoredSelectionRef.current = payload.selectedIds.length > 0 ? payload.selectedIds : null
      setSearchQuery(payload.searchQuery)
      setBulkFromDate(payload.bulkFromDate)
      setBulkToDate(payload.bulkToDate)
      setBulkSelectionLimit(payload.bulkSelectionLimit)
      if (Object.keys(payload.settingsPatch).length > 0) setHandoffPatch(payload.settingsPatch)
      if (payload.tabMode === 'bulk') void fetchConversationList()
    })().catch(() => {
      setHandoffNotice(T('The workspace handoff expired or was already used. Defaults were restored; please reselect conversations.'))
    }).finally(() => {
      handoffInflightRef.current = false
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply the hand-off's format and session settings only after stored
  // settings have loaded, so loadSettings cannot overwrite them with defaults.
  useEffect(() => {
    if (!settings) return
    if (handoffFormatRef.current) {
      setFormat(handoffFormatRef.current)
      handoffFormatRef.current = null
    }
    if (handoffPatch) {
      pendingSettingsRef.current = { ...pendingSettingsRef.current, ...handoffPatch }
      setSettings(previous => ({ ...mergeExtensionSettings(previous || {}), ...handoffPatch }))
      setSettingsDirty(true)
      setHandoffPatch(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, handoffPatch])

  const openWorkspace = async (withoutSelection = false) => {
    const [tab] = await targetTabs()
    if (!tab?.id) return
    setWorkspaceHandoffError(false)
    let url = chrome.runtime.getURL('tabs/export-workspace.html') + `?sourceTab=${tab.id}`
    if (!withoutSelection) {
      try {
        // Hand off the in-memory UI state (mode/format/selection/search/quick
        // rules/unsaved settings) through a short-lived single-use session
        // record; the URL carries only its random id, never content or settings.
        const sessionId = await createWorkspaceSession({
          sourceTabId: tab.id,
          tabMode,
          format,
          selectedIds,
          searchQuery,
          bulkFromDate,
          bulkToDate,
          bulkSelectionLimit,
          settingsPatch: pendingSettingsRef.current,
        })
        url += `&ws=${encodeURIComponent(sessionId)}`
      } catch {
        // Session storage unavailable: stay in the popup with the selection
        // intact and say so; opening without the selection is an explicit
        // separate choice, never a silent downgrade.
        setWorkspaceHandoffError(true)
        return
      }
    }
    await chrome.tabs.create({ url })
  }

  return { openWorkspace }
}
