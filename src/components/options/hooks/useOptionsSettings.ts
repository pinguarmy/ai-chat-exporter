/**
 * Stored settings for the options page: initial load, auto-save of general
 * settings and of the scheduled-export block, and the "saved" toast flag.
 */

import { useCallback, useEffect, useState } from 'react'
import { requestSettingsPatch, settingsDifference } from '../../../lib/settings-store'
import type { ExtensionSettings, ScheduledExportSettings } from '../../../lib/types'
import { DEFAULT_SETTINGS, mergeExtensionSettings } from '../../../lib/types'
import {
  getDefaultScheduledExportSettings,
  mergeScheduledExportSettings,
} from '../../../lib/scheduled-export'

export function useOptionsSettings() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [scheduleSettings, setScheduleSettings] = useState<ScheduledExportSettings>(
    getDefaultScheduledExportSettings()
  )
  // Keep the optional feature out of the way by default for users who do not
  // use background export. An enabled saved schedule re-opens automatically.
  const [scheduleExpanded, setScheduleExpanded] = useState(false)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
    loadScheduleSettings()
  }, [])

  /**
   * Load settings from storage
   */
  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get('settings')
      if (result.settings) {
        setSettings(mergeExtensionSettings(result.settings))
      }
    } catch (err) {
      // Use defaults
    }
  }

  /**
   * Load scheduled export settings from storage
   */
  const loadScheduleSettings = async () => {
    try {
      const result = await chrome.storage.local.get('settings')
      if (result.settings?.scheduledExport) {
        const resolved = mergeScheduledExportSettings(result.settings.scheduledExport)
        setScheduleSettings(resolved)
        if (resolved.enabled) setScheduleExpanded(true)
      }
    } catch {}
  }

  /**
   * Save settings to storage
   */
  const saveSettings = useCallback(async (newSettings: ExtensionSettings) => {
    setSettings(newSettings)
    try {
      await requestSettingsPatch(settingsDifference(settings, newSettings))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Settings could not be saved.')
    }
  }, [settings])

  /**
   * Save scheduled export settings
   */
  const saveScheduleSettings = useCallback(async (newSchedule: ScheduledExportSettings) => {
    setScheduleSettings(newSchedule)
    const updated = { ...settings, scheduledExport: newSchedule }
    setSettings(updated)
    try {
      await requestSettingsPatch({ scheduledExport: settingsDifference(scheduleSettings, newSchedule) as ScheduledExportSettings })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Settings could not be saved.')
    }
  }, [settings, scheduleSettings])

  /**
   * Update a single setting
   */
  const updateSetting = <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K]
  ) => {
    saveSettings({ ...settings, [key]: value })
  }

  return {
    settings,
    saved,
    scheduleSettings,
    scheduleExpanded,
    setScheduleExpanded,
    updateSetting,
    saveScheduleSettings,
  }
}
