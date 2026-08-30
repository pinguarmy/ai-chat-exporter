/**
 * ConversationList Component
 * Archive Desk library: a selection toolbar above compact ledger rows.
 */

import type { ConversationListItem } from '../lib/types'

interface ConversationListProps {
  conversations: ConversationListItem[]
  selectedIds: string[]
  onSelect: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onExport: () => void
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
 * Library of conversations with an explicit selection toolbar
 * (count + select-all/clear) and one selectable row per conversation.
 */
export function ConversationList({
  conversations,
  selectedIds,
  onSelect,
  onSelectAll,
  onDeselectAll,
  loading = false,
  bulkLoading = false,
  T
}: ConversationListProps) {
  const tr = T ?? ((key: string) => key)
  const allSelected = conversations.length > 0 &&
                     selectedIds.length === conversations.length

  return (
    <div className="conv-library">
      {conversations.length > 0 && (
        <div className="conv-toolbar">
          <span className="conv-count" aria-live="polite">
            {selectedIds.length} / {conversations.length} {tr('selected')}
          </span>
          <button
            type="button"
            className="conv-toolbar-btn"
            onClick={allSelected ? onDeselectAll : onSelectAll}
            disabled={loading || bulkLoading}
            aria-label={tr('Select all conversations')}
          >
            {allSelected ? tr('Deselect all') : tr('Select all')}
          </button>
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

      {conversations.length === 0 && !bulkLoading && (
        <div className="conv-empty">
          {tr('No conversations found. Click Refresh to load.')}
        </div>
      )}
    </div>
  )
}
