import type { ExtensionSettings, ScheduledExportSettings } from '../lib/types'
import { DEFAULT_SETTINGS, mergeExtensionSettings } from '../lib/types'
import { getDefaultScheduledExportSettings, mergeScheduledExportSettings } from '../lib/scheduled-export'

/**
 * Read the current global export policy. Scheduled exports can safely fall
 * back to defaults when storage is temporarily unavailable.
 */
export async function getResolvedExtensionSettings(): Promise<ExtensionSettings> {
  try {
    const result = await chrome.storage.local.get('settings')
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
    const result = await chrome.storage.local.get('settings')
    const settings = mergeExtensionSettings(result.settings)
    return mergeScheduledExportSettings(settings.scheduledExport)
  } catch {
    return getDefaultScheduledExportSettings()
  }
}
