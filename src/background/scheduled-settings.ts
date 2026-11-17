import type { ExtensionSettings, ScheduledExportSettings, SettingsStorage } from '../core/types'
import { DEFAULT_SETTINGS, mergeExtensionSettings } from '../core/types'
import {
  getDefaultScheduledExportSettings,
  mergeScheduledExportSettings
} from '../core/scheduled-export'

/**
 * Read the current global export policy. Scheduled exports can safely fall
 * back to defaults when storage is temporarily unavailable.
 */
export async function getResolvedExtensionSettings(): Promise<ExtensionSettings> {
  try {
    const result = await chrome.storage.local.get<SettingsStorage>('settings')
    return mergeExtensionSettings(result.settings)
  } catch {
    return DEFAULT_SETTINGS
  }
}

/**
 * Get scheduled export settings with defaults
 */
export async function getScheduledExportSettings(): Promise<ScheduledExportSettings> {
  try {
    const result = await chrome.storage.local.get<SettingsStorage>('settings')
    const settings = mergeExtensionSettings(result.settings)
    return mergeScheduledExportSettings(settings.scheduledExport)
  } catch {
    return getDefaultScheduledExportSettings()
  }
}
