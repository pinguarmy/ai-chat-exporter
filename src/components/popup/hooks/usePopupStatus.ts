/**
 * Outcome/message state shared by every popup action (current export, bulk
 * export, workspace hand-off). State only: no effects, so call order relative
 * to effectful hooks is irrelevant.
 */

import { useState } from 'react'

export function usePopupStatus() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  // Neutral outcome (e.g. user-cancelled): shown as information, never as
  // success, and never disables the export button.
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  // Filename of the last current-chat export whose download actually completed.
  const [exportResult, setExportResult] = useState<string | null>(null)
  // Workspace hand-off restore problems (expired/used/mismatched) or restored
  // selections that no longer exist in the refreshed list.
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null)
  // Session storage unavailable when opening the workspace; the user chose
  // nothing yet, so the popup stays put and offers an explicit fallback.
  const [workspaceHandoffError, setWorkspaceHandoffError] = useState(false)
  const [snapshotNoticeMessage, setSnapshotNoticeMessage] = useState<string | null>(null)

  return {
    error, setError,
    success, setSuccess,
    exportNotice, setExportNotice,
    exportResult, setExportResult,
    handoffNotice, setHandoffNotice,
    workspaceHandoffError, setWorkspaceHandoffError,
    snapshotNoticeMessage, setSnapshotNoticeMessage,
  }
}

export type PopupStatus = ReturnType<typeof usePopupStatus>
