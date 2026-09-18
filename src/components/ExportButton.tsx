/**
 * ExportButton Component
 * Single primary action per context, with spinner and success states
 */

import React from 'react'
import { DownloadIcon } from './icons'
import { t, type Locale } from '../lib/i18n'

interface ExportButtonProps {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  format: 'pdf' | 'markdown'
  className?: string
  text?: string
  isSuccess?: boolean
  locale?: Locale
  archiveBundle?: boolean
}

/** Inline SVG Icons */
const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
)

/**
 * Export button with loading state, success state, and format indicator
 */
export function ExportButton({
  onClick,
  disabled = false,
  loading = false,
  format,
  className = '',
  text,
  isSuccess = false,
  locale = 'en',
  archiveBundle = false
}: ExportButtonProps) {
  const formatLabelKey =
    format === 'pdf'
      ? 'Export as PDF'
      : archiveBundle
        ? 'Export as ZIP archive'
        : 'Export as Markdown'
  const defaultText = text || t(formatLabelKey, locale)

  let content: React.ReactNode
  let btnClass = `btn btn-primary ${className}`

  if (loading) {
    content = (
      <>
        <span className="spinner" />
        <span>{t('Exporting...', locale)}</span>
      </>
    )
  } else if (isSuccess) {
    content = (
      <>
        <CheckIcon />
        <span>{t('Export Successful', locale)}</span>
      </>
    )
    btnClass += ' success'
  } else {
    content = (
      <>
        <DownloadIcon />
        <span>{defaultText}</span>
      </>
    )
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading || isSuccess}
      className={btnClass}
      aria-label={t(formatLabelKey, locale)}
    >
      {content}
    </button>
  )
}
