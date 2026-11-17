import { sendBackgroundMessage } from './background-messages'
import { DEFAULT_SETTINGS, mergeExtensionSettings } from '../core/types'
import type { ExtensionSettings } from '../core/types'

let writes: Promise<unknown> = Promise.resolve()
const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v))
type SettingsTree = Record<string, unknown>
/** Recursive diff of two settings objects; only keys whose values changed are kept. */
export function settingsDifference<T extends object>(before: T, after: T): Partial<T> {
  const previous = before as SettingsTree
  return Object.fromEntries(
    Object.entries(after as SettingsTree).flatMap(([key, value]) => {
      if (JSON.stringify(previous[key]) === JSON.stringify(value)) return []
      const prior = previous[key]
      return [[key, isObject(value) && isObject(prior) ? settingsDifference(prior, value) : value]]
    })
  ) as Partial<T>
}
function mergePatch(before: SettingsTree, patch: SettingsTree): SettingsTree {
  const result: SettingsTree = { ...before }
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
    const current = result[key]
    result[key] = isObject(value) ? mergePatch(isObject(current) ? current : {}, value) : value
  }
  return result
}
/** Called only in the background context; one queue serializes every settings writer. */
export function persistSettingsPatch(patch: unknown): Promise<ExtensionSettings> {
  const run = writes
    .catch(() => undefined)
    .then(async () => {
      if (!isObject(patch)) throw new Error('Invalid settings patch')
      const allowed = new Set([...Object.keys(DEFAULT_SETTINGS), 'scheduledExport'])
      if (Object.keys(patch).some(key => !allowed.has(key)))
        throw new Error('Unknown settings field')
      const stored = await chrome.storage.local.get('settings')
      const settings = mergeExtensionSettings(mergePatch(stored.settings || {}, patch))
      await chrome.storage.local.set({ settings })
      return settings
    })
  writes = run
  return run
}
export async function requestSettingsPatch(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const response = await sendBackgroundMessage({ type: 'PATCH_SETTINGS', data: patch })
  if (response?.error || !response?.data)
    throw new Error('Settings could not be saved. Please retry.')
  return response.data
}
