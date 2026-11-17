/**
 * Stored extension settings for the popup: initial load, optimistic option
 * changes, and the explicit save/reset of pending export defaults.
 */

import { useEffect, useRef, useState } from 'react'
import { requestSettingsPatch } from '../../../lib/settings-store'
import { mergeExtensionSettings } from '../../../lib/types'
import type { ExportFormat, ExtensionSettings } from '../../../lib/types'
import { t, type Locale } from '../../../lib/i18n'

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
  const T = (key: string, ...args: Array<string | number>) => t(key, locale, ...args)

  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get('settings')
      {
        const merged = mergeExtensionSettings(result.settings)
        setSettings(merged)
        setFormat(merged.defaultFormat)
      }
    } catch {
      // Use defaults
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const handleOptionChange = async (key: keyof ExtensionSettings, value: any) => {
    setSettings(previous => ({ ...mergeExtensionSettings(previous || {}), [key]: value }))
    if (key === 'theme' || key === 'locale') {
      try { await requestSettingsPatch({ [key]: value }) } catch (err) { setError(String(err)) }
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
    } catch (err) { setError(err instanceof Error ? err.message : T('Export failed')) }
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
    resetExportDefaults,
  }
}
