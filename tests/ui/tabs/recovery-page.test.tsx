// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { buildPageSnapshot } from '../../../src/core/page-snapshot'
import { DEFAULT_SETTINGS } from '../../../src/core/types'
import Recovery from '../../../src/tabs/recovery'
const cache = vi.fn()
const download = vi.fn()
const permissionContains = vi.fn()
const permissionRequest = vi.fn()
let storedSettings = { ...DEFAULT_SETTINGS }
vi.mock('../../../src/platform/page-snapshot-cache', () => ({
  requestPageSnapshotPreview: (...args: unknown[]) => cache(...args)
}))
vi.mock('../../../src/platform/snapshot-download', () => ({
  downloadPageSnapshot: (...args: unknown[]) => download(...args)
}))
const snapshot = buildPageSnapshot(
  {
    id: 'local-1',
    title: 'Saved draft',
    url: '',
    platform: 'gemini',
    messages: [{ id: 'a', role: 'user', content: 'Draft content' }]
  },
  'unknown',
  1760000000000,
  'draft-capture'
)
const otherSnapshot = buildPageSnapshot(
  {
    id: 'local-2',
    title: 'Other draft',
    url: '',
    platform: 'gemini',
    messages: [{ id: 'b', role: 'user', content: 'Other content' }]
  },
  'unknown',
  1760000000000,
  'other-capture'
)
const send = vi.fn()
let storageListeners: Array<(...args: unknown[]) => void>
const summaries = [
  {
    id: 'draft-1',
    sessionKey: 'gemini:7:aaa',
    title: 'Saved draft',
    platform: 'gemini',
    capturedAt: snapshot.capturedAt,
    lastSavedAt: snapshot.capturedAt,
    state: 'protected',
    messageCount: 1
  },
  {
    id: 'draft-2',
    sessionKey: 'gemini:9:bbb',
    title: 'Other draft',
    platform: 'gemini',
    capturedAt: otherSnapshot.capturedAt,
    lastSavedAt: otherSnapshot.capturedAt,
    state: 'off',
    messageCount: 1
  }
]
beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  storageListeners = []
  storedSettings = { ...DEFAULT_SETTINGS, locale: 'en', theme: 'light' }
  permissionContains.mockResolvedValue(false)
  permissionRequest.mockResolvedValue(true)
  download.mockResolvedValue(undefined)
  send.mockImplementation(
    async ({ type, data }: { type: string; data?: Partial<typeof storedSettings> }) => ({
      data:
        type === 'LIST_RECOVERY_DRAFTS'
          ? summaries
          : type === 'GET_RECOVERY_DRAFT'
            ? snapshot
            : type === 'STOP_RECOVERY_DRAFT'
              ? { sessionKey: 'gemini:7:aaa', state: 'off' }
              : type === 'DELETE_RECOVERY_DRAFT' || type === 'CLEAR_RECOVERY_DRAFTS'
                ? true
                : type === 'PATCH_SETTINGS'
                  ? (storedSettings = { ...storedSettings, ...data })
                  : undefined
    })
  )
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { sendMessage: send, getURL: (path: string) => `chrome-extension://test/${path}` },
      permissions: { contains: permissionContains, request: permissionRequest },
      storage: {
        local: { get: vi.fn(async () => structuredClone({ settings: storedSettings })) },
        onChanged: {
          addListener: (fn: (...args: unknown[]) => void) => {
            storageListeners.push(fn)
          },
          removeListener: (fn: (...args: unknown[]) => void) => {
            storageListeners = storageListeners.filter(item => item !== fn)
          }
        }
      }
    }
  })
  cache.mockResolvedValue(undefined)
})
describe('recovery page', () => {
  it('renders default limits when the optional permissions API is unavailable', async () => {
    delete (chrome as unknown as { permissions?: unknown }).permissions
    render(<Recovery />)
    expect(await screen.findByRole('button', { name: 'Saved draft' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enable expanded local storage' })).toBeTruthy()
    expect(screen.getByText(/Default storage: 1 MiB per draft, 4 MiB total/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('requests expanded permission directly from the click before persisting opt-in', async () => {
    let grant: ((value: boolean) => void) | undefined
    permissionRequest.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          grant = resolve
        })
    )
    render(<Recovery />)
    const button = await screen.findByRole('button', { name: 'Enable expanded local storage' })
    fireEvent.click(button)
    // No await before the browser permission request: it stays in the gesture.
    expect(permissionRequest).toHaveBeenCalledWith({ permissions: ['unlimitedStorage'] })
    expect(send.mock.calls.some(([message]) => message.type === 'PATCH_SETTINGS')).toBe(false)
    grant!(true)
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'PATCH_SETTINGS',
        data: { recoveryExpandedStorage: true }
      })
    )
    expect(await screen.findByRole('button', { name: 'Use default storage limits' })).toBeTruthy()
    expect(screen.getByText(/Expanded storage is on: no fixed draft byte limit/)).toBeTruthy()
    expect(storedSettings.recoveryExpandedStorage).toBe(true)
  })

  it('reports denied permission without changing settings or drafts', async () => {
    permissionRequest.mockResolvedValue(false)
    render(<Recovery />)
    fireEvent.click(await screen.findByRole('button', { name: 'Enable expanded local storage' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Storage permission was not granted. Existing drafts were retained.'
    )
    expect(send.mock.calls.some(([message]) => message.type === 'PATCH_SETTINGS')).toBe(false)
    expect(storedSettings.recoveryExpandedStorage).toBe(false)
    expect(screen.getByRole('button', { name: 'Enable expanded local storage' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Saved draft' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Other draft' })).toBeTruthy()
  })

  it('returns to default limits by patching settings without requesting permission or deleting drafts', async () => {
    storedSettings.recoveryExpandedStorage = true
    permissionContains.mockResolvedValue(true)
    render(<Recovery />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use default storage limits' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'PATCH_SETTINGS',
        data: { recoveryExpandedStorage: false }
      })
    )
    expect(
      await screen.findByRole('button', { name: 'Enable expanded local storage' })
    ).toBeTruthy()
    expect(screen.getByText(/Default storage: 1 MiB per draft, 4 MiB total/)).toBeTruthy()
    expect(permissionRequest).not.toHaveBeenCalled()
    expect(storedSettings.recoveryExpandedStorage).toBe(false)
    expect(
      send.mock.calls.some(([message]) =>
        ['DELETE_RECOVERY_DRAFT', 'CLEAR_RECOVERY_DRAFTS'].includes(message.type)
      )
    ).toBe(false)
    expect(screen.getByRole('button', { name: 'Saved draft' })).toBeTruthy()
  })

  it('saves a draft larger than 1 MiB as Markdown without using the preview cache', async () => {
    const large = buildPageSnapshot(
      {
        ...snapshot.conversation,
        messages: [{ id: 'large', role: 'user', content: 'x'.repeat(1_100_000) }]
      },
      'unknown'
    )
    const originalSend = send.getMockImplementation()!
    send.mockImplementation((message: { type: string }) =>
      message.type === 'GET_RECOVERY_DRAFT'
        ? Promise.resolve({ data: large })
        : originalSend(message)
    )
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    try {
      render(<Recovery />)
      fireEvent.click(await screen.findByRole('button', { name: 'Saved draft' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Save Markdown directly' }))
      await waitFor(() =>
        expect(download).toHaveBeenCalledWith(
          large,
          'markdown',
          expect.objectContaining({ locale: 'en' })
        )
      )
      expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Markdown saved.')
      expect(cache).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    } finally {
      open.mockRestore()
    }
  })

  it('lists drafts without a tab and retrieves only the chosen ID', async () => {
    render(<Recovery />)
    fireEvent.click(await screen.findByRole('button', { name: 'Saved draft' }))
    expect(await screen.findByText(/complete history has not been verified/)).toBeTruthy()
    expect(send).toHaveBeenCalledWith({ type: 'GET_RECOVERY_DRAFT', data: { id: 'draft-1' } })
    // Deleting is documented as also stopping that draft's protection.
    expect(screen.getByText(/Stopping protection does not delete/)).toBeTruthy()
    expect(screen.getByText(/does not resume by itself/)).toBeTruthy()
  })
  it('requires in-page confirmation before deleting one draft', async () => {
    render(<Recovery />)
    const deleteButtons = await screen.findAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[0])
    expect(send).not.toHaveBeenCalledWith({
      type: 'DELETE_RECOVERY_DRAFT',
      data: { id: 'draft-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: 'DELETE_RECOVERY_DRAFT', data: { id: 'draft-1' } })
    )
  })
  it('dismisses the confirmation with Escape without deleting', async () => {
    render(<Recovery />)
    const deleteButtons = await screen.findAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[0])
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete permanently' })).toBeNull()
    )
    expect(send).not.toHaveBeenCalledWith({
      type: 'DELETE_RECOVERY_DRAFT',
      data: { id: 'draft-1' }
    })
  })
  it('explains that a failed delete retained the saved draft', async () => {
    send.mockImplementation(async ({ type }: { type: string }) => {
      if (type === 'DELETE_RECOVERY_DRAFT') return { error: 'storage unavailable' }
      return { data: type === 'LIST_RECOVERY_DRAFTS' ? summaries : undefined }
    })
    render(<Recovery />)
    const deleteButtons = await screen.findAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[0])
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('retained')
  })
  it('stops protection for a protected draft through the parent STOP message', async () => {
    render(<Recovery />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop protection' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: 'STOP_RECOVERY_DRAFT', data: { id: 'draft-1' } })
    )
  })
  it('drops a late select response instead of showing the wrong draft', async () => {
    // Assigned inside the mocked send; the cast keeps TS from narrowing it to `null`.
    let lateResolve = null as ((value: unknown) => void) | null
    send.mockImplementation(({ type, data }: { type: string; data?: { id?: string } }) => {
      if (type === 'LIST_RECOVERY_DRAFTS') return Promise.resolve({ data: summaries })
      if (type === 'GET_RECOVERY_DRAFT' && data?.id === 'draft-1')
        return new Promise(resolve => {
          lateResolve = resolve
        })
      if (type === 'GET_RECOVERY_DRAFT' && data?.id === 'draft-2')
        return Promise.resolve({ data: otherSnapshot })
      return Promise.resolve({ data: undefined })
    })
    render(<Recovery />)
    fireEvent.click(await screen.findByRole('button', { name: 'Saved draft' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Other draft' }))
    expect(await screen.findByRole('heading', { name: 'Other draft' })).toBeTruthy()
    // The superseded request resolves late and must not replace the selection.
    lateResolve?.({ data: snapshot })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Saved draft' })).toBeNull())
    expect(screen.getByRole('heading', { name: 'Other draft' })).toBeTruthy()
  })
  it('rejects invalid draft data instead of displaying it', async () => {
    send.mockImplementation(async ({ type }: { type: string }) => ({
      data:
        type === 'LIST_RECOVERY_DRAFTS'
          ? [
              {
                id: 'draft-1',
                title: 'Saved draft',
                platform: 'gemini',
                capturedAt: snapshot.capturedAt
              }
            ]
          : null
    }))
    render(<Recovery />)
    fireEvent.click(await screen.findByRole('button', { name: 'Saved draft' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Recovery draft is missing or invalid'
    )
  })
})
