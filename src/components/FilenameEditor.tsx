/**
 * FilenameEditor Component
 * Archive Desk pattern editor: keyboard-accessible display, variable chips,
 * and a live preview of the rendered filename.
 */

import { useState, useEffect } from 'react'
import type { Conversation, FilenameOption } from '../lib/types'
import { FILENAME_OPTIONS } from '../lib/types'
import { generateFilename, getDefaultPattern } from '../lib/filename'
import { t, type Locale } from '../lib/i18n'

interface FilenameEditorProps {
  value: string
  onChange: (pattern: string) => void
  conversation?: Conversation | null
  disabled?: boolean
  /** Settings page keeps the DIY field open; popup starts compact. */
  defaultOpen?: boolean
  locale?: Locale
}

/** Inline SVG Icon */
const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
)

/**
 * Filename pattern editor with chip-based variable insertion and live preview
 */
export function FilenameEditor({
  value,
  onChange,
  conversation,
  disabled = false,
  defaultOpen = false,
  locale = 'en',
}: FilenameEditorProps) {
  const T = (key: string, ...args: Array<string | number>) => t(key, locale, ...args)
  const [isEditing, setIsEditing] = useState(defaultOpen)
  const [preview, setPreview] = useState('')

  // Update preview when pattern or conversation changes
  useEffect(() => {
    if (conversation) {
      const filename = generateFilename(value, conversation, 1)
      setPreview(filename)
    } else {
      // Show a placeholder preview
      const dummyConv: Conversation = {
        id: 'preview',
        title: 'example-conversation',
        url: '',
        messages: [],
        platform: 'chatgpt',
        createdAt: new Date('2026-06-08T09:30:00').getTime(),
      }
      const filename = generateFilename(value, dummyConv, 1)
      setPreview(filename)
    }
  }, [value, conversation])

  const insertVariable = (key: string) => {
    const newValue = value + `{${key}}`
    onChange(newValue)
  }

  const resetToDefault = () => {
    onChange(getDefaultPattern())
  }

  if (!isEditing) {
    return (
      <div className="filename-editor">
        <span className="filename-editor-label">{T('Filename')}</span>
        <button
          type="button"
          className="filename-display"
          onClick={() => setIsEditing(true)}
          disabled={disabled}
          aria-label={T('Edit filename pattern')}
        >
          <code className="filename-pattern">{value}</code>
          <EditIcon />
        </button>
        <span className="filename-live-preview">{T('Preview: {0}', preview)}</span>
      </div>
    )
  }

  return (
    <div className="filename-editor filename-editor-open">
      <div className="filename-editor-head">
        <span className="filename-editor-label">{T('Edit Pattern')}</span>
        <button
          type="button"
          className="btn-icon"
          onClick={() => setIsEditing(false)}
          aria-label={T('Close filename editor')}
        >
          &times;
        </button>
      </div>
      <input
        className="input text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={getDefaultPattern()}
        autoFocus
        aria-label={T('Filename Pattern')}
      />
      <div>
        <span className="filename-editor-label">{T('Variables')}</span>
        <div className="chip-container">
          {FILENAME_OPTIONS.map((opt: FilenameOption) => (
            <button
              key={opt.key}
              type="button"
              className="chip"
              onClick={() => insertVariable(opt.key)}
              disabled={disabled}
              title={opt.example}
              aria-label={T('Insert {0}', opt.label)}
            >
              {`{${opt.key}}`}
            </button>
          ))}
        </div>
      </div>
      <div className="filename-editor-foot">
        <code className="filename-live-preview filename-live-preview-box">
          → {preview}
        </code>
        <button
          type="button"
          className="btn btn-outline btn-compact"
          onClick={resetToDefault}
          disabled={disabled}
        >
          {T('Reset')}
        </button>
      </div>
    </div>
  )
}
