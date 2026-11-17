// @vitest-environment jsdom
/**
 * Pages must not render localized UI before the locale catalogue is present:
 * settings are only published once the chunk for the stored locale has loaded,
 * and a catalogue that cannot be loaded leaves the page in English.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { en } from '../../src/core/i18n/locales/en'
import { zhCN } from '../../src/core/i18n/locales/zh-CN'
import { ja } from '../../src/core/i18n/locales/ja'

const KEY = 'Visible messages' as const

const readCatalogue = (locale: string) =>
  JSON.parse(
    readFileSync(resolve(__dirname, '../../src/core/i18n/generated', `${locale}.catalog`), 'utf8')
  )

function deferred<T>() {
  let resolveValue!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolveValue = res
  })
  return { promise, resolve: resolveValue }
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({ settings: { locale: 'zh-CN' } })) } },
    runtime: { sendMessage: vi.fn(async () => ({ data: {} })) }
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('popup settings', () => {
  const setup = async (
    source?: Parameters<typeof import('../../src/core/i18n').setLocaleSource>[0]
  ) => {
    const i18n = await import('../../src/core/i18n')
    i18n.setLocaleSource(source)
    const { usePopupSettings } = await import('../../src/components/popup/hooks/usePopupSettings')
    return { i18n, usePopupSettings }
  }

  it('publishes settings only after the stored locale has loaded', async () => {
    const gate = deferred<unknown>()
    const { i18n, usePopupSettings } = await setup(() => gate.promise)
    const { result } = renderHook(() => usePopupSettings({ setError: vi.fn(), setFormat: vi.fn() }))

    // The storage read has finished, but the catalogue has not arrived.
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.settings).toBeNull()
    expect(result.current.T(KEY)).toBe(en[KEY])

    await act(async () => {
      gate.resolve(readCatalogue('zh-CN'))
      await gate.promise
    })
    await waitFor(() => expect(result.current.settings?.locale).toBe('zh-CN'))
    expect(i18n.isLocaleLoaded('zh-CN')).toBe(true)
    // First render with settings is already translated.
    expect(result.current.T(KEY)).toBe(zhCN[KEY])
  })

  it('loads the new locale before switching language in the UI', async () => {
    const source = vi.fn(async (locale: string) => readCatalogue(locale))
    const { usePopupSettings } = await setup(source)
    const { result } = renderHook(() => usePopupSettings({ setError: vi.fn(), setFormat: vi.fn() }))
    await waitFor(() => expect(result.current.settings?.locale).toBe('zh-CN'))

    await act(async () => {
      await result.current.handleOptionChange('locale', 'ja')
    })
    expect(source).toHaveBeenCalledWith('ja')
    expect(result.current.locale).toBe('ja')
    expect(result.current.T('Export Content')).toBe(ja['Export Content'])
  })

  it('renders in English, without erroring, when the catalogue cannot load', async () => {
    const { usePopupSettings } = await setup(async () => {
      throw new Error('chunk missing')
    })
    const setError = vi.fn()
    const { result } = renderHook(() => usePopupSettings({ setError, setFormat: vi.fn() }))
    await waitFor(() => expect(result.current.settings?.locale).toBe('zh-CN'))
    expect(result.current.T(KEY)).toBe(en[KEY])
    expect(setError).not.toHaveBeenCalled()
  })
})

describe('options settings', () => {
  it('publishes the stored locale only once its catalogue has loaded', async () => {
    const gate = deferred<unknown>()
    const i18n = await import('../../src/core/i18n')
    i18n.setLocaleSource(() => gate.promise)
    const { useOptionsSettings } =
      await import('../../src/components/options/hooks/useOptionsSettings')
    const { result } = renderHook(() => useOptionsSettings())

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.settings.locale).toBe('en')

    await act(async () => {
      gate.resolve(readCatalogue('zh-CN'))
      await gate.promise
    })
    await waitFor(() => expect(result.current.settings.locale).toBe('zh-CN'))
    expect(i18n.isLocaleLoaded('zh-CN')).toBe(true)
    expect(i18n.t(KEY, 'zh-CN')).toBe(zhCN[KEY])
  })
})
