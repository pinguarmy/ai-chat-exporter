import { describe, expect, it, vi } from 'vitest'
import { downloadAndWait } from '../src/lib/download-completion'

function makeDownloads(state: 'complete' | 'interrupted' | 'pending' = 'pending') {
  let listener: ((delta: chrome.downloads.DownloadDelta) => void) | undefined
  const api = {
    download: vi.fn(async () => 42),
    onChanged: {
      addListener: vi.fn((next: (delta: chrome.downloads.DownloadDelta) => void) => { listener = next }),
      removeListener: vi.fn(),
    },
    search: vi.fn(async () => state === 'pending' ? [{ id: 42, state: 'in_progress' }] : [{ id: 42, state }]),
  } as unknown as typeof chrome.downloads
  return { api, emit: (delta: chrome.downloads.DownloadDelta) => listener?.(delta) }
}

describe('download completion tracking', () => {
  it('resolves only after the browser reports complete', async () => {
    const { api, emit } = makeDownloads()
    const promise = downloadAndWait({ url: 'data:text/plain,test', filename: 'test.txt', saveAs: false }, 1000, api)
    await Promise.resolve()
    let settled = false
    promise.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    emit({ id: 42, state: { current: 'complete' } } as chrome.downloads.DownloadDelta)
    await expect(promise).resolves.toBe(42)
    expect(api.onChanged.removeListener).toHaveBeenCalled()
  })

  it('rejects interrupted downloads and removes the listener', async () => {
    const { api, emit } = makeDownloads()
    const promise = downloadAndWait({ url: 'data:text/plain,test', filename: 'test.txt', saveAs: false }, 1000, api)
    await Promise.resolve()
    emit({ id: 42, state: { current: 'interrupted' } } as chrome.downloads.DownloadDelta)
    await expect(promise).rejects.toThrow('interrupted')
    expect(api.onChanged.removeListener).toHaveBeenCalled()
  })

  it('handles a completion event that raced listener registration via search', async () => {
    const { api } = makeDownloads('complete')
    await expect(downloadAndWait({ url: 'data:text/plain,test', filename: 'test.txt', saveAs: false }, 1000, api)).resolves.toBe(42)
  })

  it('propagates a request rejection before completion tracking begins', async () => {
    const { api } = makeDownloads()
    api.download = vi.fn(async () => { throw new Error('Invalid URL') })

    await expect(downloadAndWait({ url: 'data:text/plain,test', filename: 'test.txt', saveAs: false }, 1000, api))
      .rejects.toThrow('Invalid URL')
    expect(api.onChanged.addListener).not.toHaveBeenCalled()
  })

  it('cancels an in-progress browser download when its export queue is stopped', async () => {
    const { api } = makeDownloads()
    api.cancel = vi.fn(async () => undefined)
    const controller = new AbortController()

    const promise = downloadAndWait(
      { url: 'data:text/plain,test', filename: 'test.txt', saveAs: false },
      1000,
      api,
      { signal: controller.signal }
    )
    await Promise.resolve()
    controller.abort()

    await expect(promise).rejects.toThrow('Export cancelled')
    expect(api.cancel).toHaveBeenCalledWith(42)
    expect(api.onChanged.removeListener).toHaveBeenCalled()
  })

  it('rejects when the queue is cancelled after the browser download starts', async () => {
    const { api } = makeDownloads()
    api.cancel = vi.fn(async () => undefined)
    const controller = new AbortController()

    await expect(
      downloadAndWait(
        { url: 'data:text/plain,test', filename: 'test.txt', saveAs: false },
        1000,
        api,
        { signal: controller.signal, onStarted: () => controller.abort() }
      )
    ).rejects.toThrow('Export cancelled')
    expect(api.cancel).toHaveBeenCalledWith(42)
    expect(api.onChanged.addListener).not.toHaveBeenCalled()
  })

  it('rejects with the browser-reported error reason', async () => {
    const { api, emit } = makeDownloads()
    const promise = downloadAndWait({ url: 'data:text/plain,test', filename: 'test.txt', saveAs: false }, 1000, api)
    await Promise.resolve()
    emit({ id: 42, error: { current: 'SERVER_FAILED' } } as chrome.downloads.DownloadDelta)
    await expect(promise).rejects.toThrow('Download interrupted: SERVER_FAILED')
    expect(api.onChanged.removeListener).toHaveBeenCalled()
  })

  it('rejects when cancellation races completion listener registration', async () => {
    const controller = new AbortController()
    const { api } = makeDownloads()
    api.cancel = vi.fn(async () => undefined)
    api.onChanged.addListener = vi.fn(() => controller.abort())

    await expect(
      downloadAndWait(
        { url: 'data:text/plain,test', filename: 'test.txt', saveAs: false },
        1000,
        api,
        { signal: controller.signal }
      )
    ).rejects.toThrow('Export cancelled')
    expect(api.cancel).toHaveBeenCalledWith(42)
    expect(api.onChanged.removeListener).toHaveBeenCalled()
  })

  it('waits for async run bookkeeping before listening for completion', async () => {
    const { api, emit } = makeDownloads()
    let releaseStarted!: () => void
    const started = new Promise<void>(resolve => { releaseStarted = resolve })

    const promise = downloadAndWait(
      { url: 'data:text/plain,test', filename: 'test.txt', saveAs: false },
      1000,
      api,
      { onStarted: async () => started }
    )
    await Promise.resolve()
    expect(api.onChanged.addListener).not.toHaveBeenCalled()

    releaseStarted()
    await vi.waitFor(() => expect(api.onChanged.addListener).toHaveBeenCalled(), { timeout: 100 })

    emit({ id: 42, state: { current: 'complete' } } as chrome.downloads.DownloadDelta)
    await expect(promise).resolves.toBe(42)
  })
})
