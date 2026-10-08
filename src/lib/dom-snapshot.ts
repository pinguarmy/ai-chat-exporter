/**
 * Generic observed-DOM page snapshot for providers without a dedicated
 * snapshot extractor.
 *
 * When a provider API cannot verify a transcript, the regular export is
 * stopped so an incomplete file is never passed off as a full archive. This
 * helper gives users a labelled way out instead of a dead end: it captures
 * only what the page currently renders, through the parser's existing DOM
 * reader, and wraps it as a PageSnapshot that is always unverified. It never
 * calls provider list/detail APIs.
 */
import { buildPageSnapshot } from './page-snapshot'
import { PageSnapshotCaptureError, PageSnapshotSession, type SnapshotSessionContext } from './snapshot-session'
import type { Conversation, PageSnapshot } from './types'

export interface DomSnapshotSupport {
  getSnapshotContext: () => SnapshotSessionContext
  capturePageSnapshot: () => Promise<PageSnapshot>
}

export function createDomSnapshotSupport(
  parser: { parseCurrentConversation(): Promise<Conversation | null> },
  messageSelector: string
): DomSnapshotSupport {
  // Created on first use: most page loads never take a snapshot, so they
  // should not pay for a document-wide MutationObserver. The capture compares
  // a before/after context, which only needs the session from that point on.
  let session: PageSnapshotSession | null = null
  const getSession = () => {
    session ??= new PageSnapshotSession({
      resolveRoot: () => (typeof document === 'undefined' ? null : document.querySelector('main') || document.body),
      messageSelector,
    })
    return session
  }

  return {
    getSnapshotContext: () => getSession().getSnapshotContext(),
    capturePageSnapshot: async () => {
      const conversation = await parser.parseCurrentConversation()
      if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0) {
        throw new PageSnapshotCaptureError('No capturable conversation content is currently visible on this page.')
      }
      return buildPageSnapshot(conversation, 'unknown')
    },
  }
}
