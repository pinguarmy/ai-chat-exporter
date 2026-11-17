/**
 * Empty/pending states of the Current Chat tab: no supported page detected,
 * or a provider page whose conversation is still loading, empty or failed.
 */

import { QuickStartGuide } from '../QuickStartGuide'
import { localizeProviderError } from '../../providers/provider-errors'
import type { Locale } from '../../core/i18n'
import type { Translate } from './popup-utils'

export function NoChatDetectedState({ locale, T }: { locale: Locale; T: Translate }) {
  return (
    <div className="empty-state">
      <div style={{ background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '50%' }}>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>
      <div className="flex-col gap-1 items-center">
        <p style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
          {T('No Chat Detected')}
        </p>
      </div>
      <QuickStartGuide locale={locale} initialOpen />
    </div>
  )
}

interface ConversationPendingStateProps {
  currentError: string | null
  noCurrentConversation: boolean
  snapshotFallback: boolean
  locale: Locale
  T: Translate
  onRefresh: () => void
  onOpenBulk: () => void
}

export function ConversationPendingState({
  currentError,
  noCurrentConversation,
  snapshotFallback,
  locale,
  T,
  onRefresh,
  onOpenBulk
}: ConversationPendingStateProps) {
  return (
    <div className="empty-state">
      {!currentError && !noCurrentConversation && (
        <div style={{ background: 'var(--primary-light)', padding: '12px', borderRadius: '50%' }}>
          <span
            className="spinner"
            style={{ borderTopColor: 'var(--primary)', width: '22px', height: '22px' }}
          ></span>
        </div>
      )}
      <div className="flex-col gap-1 items-center">
        <p
          style={{
            fontWeight: 600,
            fontSize: '14px',
            color: currentError ? 'var(--error)' : 'var(--text-primary)'
          }}
        >
          {noCurrentConversation
            ? T('No conversation open')
            : currentError
              ? T('Export verification failed')
              : T('Detecting...')}
        </p>
        <p className="text-xs text-muted" style={{ textAlign: 'center', maxWidth: '280px' }}>
          {noCurrentConversation
            ? T(
                'Open a conversation for current-chat export, or use Bulk Export to load account history.'
              )
            : currentError
              ? localizeProviderError(currentError, locale)
              : T('Extracting conversation content')}
        </p>
        {snapshotFallback && (
          <p className="text-xs text-muted" style={{ textAlign: 'center', maxWidth: '280px' }}>
            {T('You can still save what this page shows with “Capture page snapshot” below.')}
          </p>
        )}
        {currentError && (
          <button type="button" className="btn btn-outline btn-compact mt-1" onClick={onRefresh}>
            {T('Refresh')}
          </button>
        )}
        {noCurrentConversation && (
          <button type="button" className="btn btn-outline btn-compact mt-1" onClick={onOpenBulk}>
            {T('Bulk Export')}
          </button>
        )}
      </div>
    </div>
  )
}
