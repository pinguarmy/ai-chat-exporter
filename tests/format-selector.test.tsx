import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FormatSelector } from '../src/components/FormatSelector'
describe('export job presets', () => {
  it('maps PDF, Markdown and ZIP to existing settings without leaving ZIP silently active', () => {
    const format = vi.fn(), archive = vi.fn()
    const { rerender } = render(<FormatSelector value="markdown" archiveBundle={true} onChange={format} onArchiveChange={archive} />)
    expect(screen.getByRole('button', { name: 'Archive ZIP' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Reading PDF' }))
    expect(archive).toHaveBeenLastCalledWith(false)
    expect(format).toHaveBeenLastCalledWith('pdf')
    rerender(<FormatSelector value="pdf" archiveBundle={false} onChange={format} onArchiveChange={archive} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editable Markdown' }))
    expect(archive).toHaveBeenLastCalledWith(false)
    expect(format).toHaveBeenLastCalledWith('markdown')
    fireEvent.click(screen.getByRole('button', { name: 'Archive ZIP' }))
    expect(archive).toHaveBeenLastCalledWith(true)
  })
  it('localizes choices and disables all of them while a download is running', () => {
    render(<FormatSelector value="pdf" onChange={vi.fn()} onArchiveChange={vi.fn()} locale="zh-CN" disabled />)
    expect(screen.getByRole('button', { name: '阅读版 PDF' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '归档 ZIP' })).toHaveProperty('disabled', true)
  })
})
