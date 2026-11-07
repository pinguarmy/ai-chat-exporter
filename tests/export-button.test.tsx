import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ExportButton } from '../src/components/ExportButton'

afterEach(cleanup)
describe('export action accessible state', () => {
  it('keeps the accessible name aligned with the visible pending, loading and complete action', () => {
    const { rerender } = render(<ExportButton onClick={vi.fn()} format="markdown" text="Save page snapshot Markdown" />)
    expect(screen.getByRole('button', { name: 'Save page snapshot Markdown' }).textContent).toContain('Save page snapshot Markdown')
    rerender(<ExportButton onClick={vi.fn()} format="markdown" text="Save page snapshot Markdown" loading />)
    expect(screen.getByRole('button', { name: 'Exporting...' })).toHaveProperty('disabled', true)
    rerender(<ExportButton onClick={vi.fn()} format="markdown" isSuccess />)
    expect(screen.getByRole('button', { name: 'Export Successful' })).toHaveProperty('disabled', false)
  })
})
