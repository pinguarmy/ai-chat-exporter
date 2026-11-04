/**
 * ExportOptionsPanel share-copy reachability regression.
 *
 * safeShare redacts Markdown bodies and every download filename regardless of
 * the selected format, so the "Create share copy" switch must stay visible and
 * controllable outside the ZIP-only archive section. A user who enabled it in
 * ZIP mode and switched to PDF or plain Markdown previously lost the only UI
 * that could turn it off while the redaction kept applying.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ExportOptionsPanel } from '../src/components/ExportOptionsPanel'
import type { ExtensionSettings } from '../src/lib/types'

const T = (key: string) => key

function renderPanel(format: 'pdf' | 'markdown', settings: Partial<ExtensionSettings>) {
  const onOptionChange = vi.fn()
  render(
    <ExportOptionsPanel
      open
      onToggle={vi.fn()}
      settings={settings as ExtensionSettings}
      conversation={null}
      format={format}
      loading={false}
      onOptionChange={onOptionChange}
      T={T}
    />
  )
  return onOptionChange
}

describe('ExportOptionsPanel share copy switch', () => {
  it('keeps the share copy switch reachable and controllable in PDF mode', () => {
    const onOptionChange = renderPanel('pdf', { safeShare: true })
    const toggle = screen.getByRole('switch', { name: 'Create share copy' })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(onOptionChange).toHaveBeenCalledWith('safeShare', false)
  })

  it('keeps the share copy switch reachable in plain Markdown mode (archive bundle off)', () => {
    const onOptionChange = renderPanel('markdown', { safeShare: true, archiveBundle: false })
    const toggle = screen.getByRole('switch', { name: 'Create share copy' })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(onOptionChange).toHaveBeenCalledWith('safeShare', false)
  })

  it('renders the share copy switch exactly once in ZIP mode', () => {
    renderPanel('markdown', { safeShare: false, archiveBundle: true })
    expect(screen.getAllByRole('switch', { name: 'Create share copy' })).toHaveLength(1)
  })
})
