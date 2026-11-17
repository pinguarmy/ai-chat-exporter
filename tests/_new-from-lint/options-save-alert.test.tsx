/**
 * The save-failure alert in useOptionsSettings follows the page language
 * instead of falling back to hard-coded English.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useOptionsSettings } from '../../src/components/options/hooks/useOptionsSettings'

let sendMessage: ReturnType<typeof vi.fn>
let stored: Record<string, unknown>

beforeEach(() => {
  stored = { settings: { locale: 'de' } }
  sendMessage = vi.fn(async () => ({ error: 'nope' }))
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => stored) } },
    runtime: { sendMessage },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useOptionsSettings save failure alert', () => {
  it('translates the background rejection message using the loaded locale', async () => {
    const alertMock = vi.fn()
    vi.stubGlobal('alert', alertMock)
    const { result } = renderHook(() => useOptionsSettings())
    await waitFor(() => expect(result.current.settings.locale).toBe('de'))

    await act(async () => { result.current.updateSetting('includeImages', false) })

    expect(alertMock).toHaveBeenCalledWith('Einstellungen konnten nicht gespeichert werden. Bitte erneut versuchen.')
  })

  it('translates the generic fallback when a non-Error is thrown', async () => {
    const alertMock = vi.fn()
    vi.stubGlobal('alert', alertMock)
    sendMessage.mockRejectedValue('boom')
    const { result } = renderHook(() => useOptionsSettings())
    await waitFor(() => expect(result.current.settings.locale).toBe('de'))

    await act(async () => { result.current.updateSetting('includeImages', false) })

    expect(alertMock).toHaveBeenCalledWith('Einstellungen konnten nicht gespeichert werden.')
  })
})
