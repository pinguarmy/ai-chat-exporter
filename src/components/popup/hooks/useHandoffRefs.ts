/**
 * Mutable flags shared between workspace hand-off restore, tab detection and
 * conversation-list loading. Refs only (no effects) so they can be created
 * before the effectful hooks that read them.
 */

import { useRef } from 'react'
import type { ExportFormat } from '../../../core/types'

export function useHandoffRefs() {
  // Selection restored from a workspace hand-off; reconciled against the next
  // loaded conversation list so missing ids are reported, not assumed.
  const restoredSelectionRef = useRef<string[] | null>(null)
  const handoffRestoredRef = useRef(false)
  // True while a hand-off consume is in flight; blocks the detection reset
  // from wiping a selection the restore is about to apply.
  const handoffInflightRef = useRef(false)
  // One-shot: a successful restore owns the selection/list for this tab, so
  // the next detection "new tab" reset (even a late one) must be skipped.
  const handoffResetSkipRef = useRef(false)
  // Restored format/patch wait for stored settings so defaults cannot
  // overwrite them; applied by the dedicated effect in useWorkspaceHandoff.
  const handoffFormatRef = useRef<ExportFormat | null>(null)

  return {
    restoredSelectionRef,
    handoffRestoredRef,
    handoffInflightRef,
    handoffResetSkipRef,
    handoffFormatRef,
  }
}

export type HandoffRefs = ReturnType<typeof useHandoffRefs>
