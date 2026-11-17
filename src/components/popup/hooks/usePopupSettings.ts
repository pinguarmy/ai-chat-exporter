/**
 * Stored extension settings for the popup: initial load, optimistic option
 * changes, and the explicit save/reset of pending export defaults.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestSettingsPatch } from '../../../platform/settings-store'
import { mergeExtensionSettings } from '../../../core/types'
import type { ExportFormat, ExtensionSettings, OptionChangeHandler } from '../../../core/types'
import { loadLocale, tDynamic, type Locale } from '../../../core/i18n'

interface Options {
  setError: (error: string | null) => void
  setFormat: (format: ExportFormat) => void
}

export function usePopupSettings({ setError, setFormat }: Options) {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null)
  const pendingSettingsRef = useRef<Partial<ExtensionSettings>>({})
  const [settingsDirty, setSettingsDirty] = useState(false)

  // Locale-bound translator
  const locale: Locale = settings?.locale ?? 'en'
  // Memoized on locale so hooks that list `T` as a dependency only re-run when the language changes.
  const T = useCallback(
    (key: string, ...args: Array<string | number>) => tDynamic(key, locale, ...args),
    [locale]
  )

  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get('settings')
      {
        const merged = mergeExtensionSettings(result.settings)
        // Fetch the language chunk before the first localized render.
        await loadLocale(merged.locale)
        setSettings(merged)
        setFormat(merged.defaultFormat)
      }
    } catch {
      // Use defaults
    }
  }

  // Mount-only load: loadSettings is recreated every render, and re-running it on each render
  // would overwrite unsaved option changes with the stored values.
  useEffect(() => {
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load, see comment above
  }, [])

  const handleOptionChange: OptionChangeHandler = async (key, value) => {
    if (key === 'locale') await loadLocale(value as Locale)
    setSettings(previous => ({ ...mergeExtensionSettings(previous || {}), [key]: value }))
    if (key === 'theme' || key === 'locale') {
      try {
        await requestSettingsPatch({ [key]: value })
      } catch (err) {
        setError(String(err))
      }
    } else {
      pendingSettingsRef.current = { ...pendingSettingsRef.current, [key]: value }
      setSettingsDirty(true)
    }
  }
  const saveExportDefaults = async () => {
    const patch = pendingSettingsRef.current
    try {
      await requestSettingsPatch(patch)
      if (pendingSettingsRef.current === patch) {
        pendingSettingsRef.current = {}
        setSettingsDirty(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : T('Export failed'))
    }
  }
  const resetExportDefaults = async () => {
    pendingSettingsRef.current = {}
    setSettingsDirty(false)
    await loadSettings()
  }

  return {
    locale,
    T,
    settings,
    setSettings,
    pendingSettingsRef,
    settingsDirty,
    setSettingsDirty,
    handleOptionChange,
    saveExportDefaults,
    resetExportDefaults
  }
}
