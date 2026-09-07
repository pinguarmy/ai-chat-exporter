/**
 * ConversationList Component
 * Archive Desk library: a selection toolbar above compact ledger rows.
 */

import type { ConversationListItem } from '../lib/types'

interface ConversationListProps {
  conversations: ConversationListItem[]
  totalCount?: number
  searchQuery?: string
  onSearchChange?: (query: string) => void
  selectedIds: string[]
  onSelect: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onExport?: () => void
  loading?: boolean
  bulkLoading?: boolean
  T?: (key: string) => string
}

/** Platform display names */
const PLATFORM_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  deepseek: 'DeepSeek',
  grok: 'Grok',
}

function formatConversationDate(timestamp?: number): string | null {
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp as number).toLocaleDateString()
}

/**
 * Library of conversations with search filter, an explicit selection toolbar
 * (count + select-all/clear) and one selectable row per conversation.
 */
export function ConversationList({
  conversations,
  totalCount,
  searchQuery = '',
  onSearchChange,
  selectedIds,
  onSelect,
  onSelectAll,
  onDeselectAll,
  loading = false,
  bulkLoading = false,
  T
}: ConversationListProps) {
  const tr = T ?? ((key: string) => key)
  const effectiveTotal = totalCount ?? conversations.length
  const isFiltered = effectiveTotal !== conversations.length || searchQuery.trim().length > 0
  const allVisibleSelected = conversations.length > 0 &&
    conversations.every(conv => selectedIds.includes(conv.id))

  return (
    <div className="conv-library">
      {effectiveTotal > 0 && onSearchChange && (
        <div className="conv-search-box">
          <input
            type="text"
            className="input conv-search-input"
            placeholder={tr('Search by title...')}
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            disabled={loading || bulkLoading}
            aria-label={tr('Search by title...')}
          />
          {searchQuery && (
            <button
              type="button"
              className="conv-search-clear"
              onClick={() => onSearchChange('')}
              title={tr('Clear search')}
              aria-label={tr('Clear search')}
              disabled={loading || bulkLoading}
            >
              ×
            </button>
          )}
        </div>
      )}

      {(conversations.length > 0 || isFiltered) && (
        <div className="conv-toolbar">
          <span className="conv-count" aria-live="polite">
            {isFiltered
              ? tr('{0} of {1} shown · {2} selected')
                  .replace('{0}', String(conversations.length))
                  .replace('{1}', String(effectiveTotal))
                  .replace('{2}', String(selectedIds.length))
              : `${selectedIds.length} / ${conversations.length} ${tr('selected')}`}
          </span>
          {conversations.length > 0 && (
            <button
              type="button"
              className="conv-toolbar-btn"
              onClick={allVisibleSelected ? onDeselectAll : onSelectAll}
              disabled={loading || bulkLoading}
              aria-label={
                isFiltered
                  ? (allVisibleSelected ? tr('Deselect visible') : tr('Select all visible conversations'))
                  : (allVisibleSelected ? tr('Deselect all') : tr('Select all conversations'))
              }
            >
              {allVisibleSelected
                ? (isFiltered ? tr('Deselect visible') : tr('Deselect all'))
                : (isFiltered ? tr('Select all visible') : tr('Select all'))}
            </button>
          )}
        </div>
      )}

      <div className="conv-list" role="group" aria-label={tr('Conversation library')}>
        {conversations.map(conv => {
          const timestamp = conv.createdAt ?? conv.updatedAt
          const date = formatConversationDate(timestamp)
          const dateLabel = conv.createdAt ? tr('Started') : tr('Last active')

          return (
            <label
              key={conv.id}
              className={`conv-item ${selectedIds.includes(conv.id) ? 'selected' : ''}`}
            >
              <input
                type="checkbox"
                className="checkbox"
                checked={selectedIds.includes(conv.id)}
                onChange={() => onSelect(conv.id)}
                disabled={loading || bulkLoading}
                aria-label={conv.title || 'Untitled'}
              />
              <div className="conv-item-text">
                <span className="conv-item-title">
                  {conv.title || 'Untitled'}
                </span>
                <span className="conv-item-meta">
                  {PLATFORM_NAMES[conv.platform] ?? 'Unknown'}
                  {conv.messageCount ? ` · ${tr('{0} messages').replace('{0}', String(conv.messageCount))}` : ''}
                  {date ? ` · ${dateLabel}: ${date}` : conv.platform === 'gemini' ? ` · ${tr('Date unavailable')}` : ''}
                </span>
              </div>
            </label>
          )
        })}
      </div>

      {conversations.length === 0 && (
        <div className="conv-empty">
          {effectiveTotal > 0
            ? tr('No matching conversations found.')
            : (!bulkLoading ? tr('No conversations found. Click Refresh to load.') : null)}
        </div>
      )}
    </div>
  )
}
