import type { BackgroundRequestOf, BackgroundResponse } from '../lib/messages/background-messages'
import { isPageSnapshot } from '../lib/page-snapshot'
import { readPageSnapshotPreview, removePageSnapshotPreview, storePageSnapshotPreview } from '../lib/page-snapshot-cache'
import { storePreviewSnapshot } from '../lib/preview-snapshots'
import type { Conversation } from '../lib/types'
import { isExtensionPageSender } from './sender'

export async function handleStorePreviewSnapshot(
  { data }: BackgroundRequestOf<'STORE_PREVIEW_SNAPSHOT'>,
): Promise<BackgroundResponse> {
  try {
    await storePreviewSnapshot(data as Conversation)
    return { data: true }
  } catch {
    return { error: 'Preview snapshot could not be stored' }
  }
}

export async function handleStorePageSnapshotPreview(
  { data }: BackgroundRequestOf<'STORE_PAGE_SNAPSHOT_PREVIEW'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  if (!isExtensionPageSender(sender)) return { error: 'Preview storage requires an extension page' }
  if (!isPageSnapshot(data?.snapshot)) return { error: 'Invalid page snapshot' }
  await storePageSnapshotPreview(data.snapshot, data.settings)
  return { data: true }
}

export async function handleGetPageSnapshotPreview(
  { data }: BackgroundRequestOf<'GET_PAGE_SNAPSHOT_PREVIEW'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  if (!isExtensionPageSender(sender)) return { error: 'Preview access requires an extension page' }
  return { data: await readPageSnapshotPreview(String(data?.captureId || '')) }
}

export async function handleDeletePageSnapshotPreview(
  { data }: BackgroundRequestOf<'DELETE_PAGE_SNAPSHOT_PREVIEW'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  if (!isExtensionPageSender(sender)) return { error: 'Preview access requires an extension page' }
  await removePageSnapshotPreview(String(data?.captureId || ''))
  return { data: true }
}
