import { DEFAULT_SETTINGS, mergeExtensionSettings } from './types'
import type { ExtensionSettings } from './types'

let writes: Promise<unknown> = Promise.resolve()
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))
export function settingsDifference(before: Record<string, any>, after: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(after).flatMap(([key, value]) => {
    if (JSON.stringify(before[key]) === JSON.stringify(value)) return []
    return [[key, isObject(value) && isObject(before[key]) ? settingsDifference(before[key], value) : value]]
  }))
}
function mergePatch(before: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const result = { ...before }
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
    result[key] = isObject(value) ? mergePatch(isObject(result[key]) ? result[key] : {}, value) : value
  }
  return result
}
/** Called only in the background context; one queue serializes every settings writer. */
export function persistSettingsPatch(patch: unknown): Promise<ExtensionSettings> {
  const run = writes.catch(() => undefined).then(async () => {
    if (!isObject(patch)) throw new Error('Invalid settings patch')
    const allowed = new Set([...Object.keys(DEFAULT_SETTINGS), 'scheduledExport'])
    if (Object.keys(patch).some(key => !allowed.has(key))) throw new Error('Unknown settings field')
    const stored = await chrome.storage.local.get('settings')
    const settings = mergeExtensionSettings(mergePatch(stored.settings || {}, patch))
    await chrome.storage.local.set({ settings })
    return settings
  })
  writes = run
  return run
}
export async function requestSettingsPatch(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const response = await chrome.runtime.sendMessage({ type: 'PATCH_SETTINGS', data: patch })
  if (response?.error || !response?.data) throw new Error('Settings could not be saved. Please retry.')
  return response.data
}
