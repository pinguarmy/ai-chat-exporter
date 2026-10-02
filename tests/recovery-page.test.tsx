// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import Recovery from '../src/tabs/recovery'
const cache = vi.fn()
vi.mock('../src/lib/page-snapshot-cache', () => ({ requestPageSnapshotPreview: (...args: unknown[]) => cache(...args) }))
const snapshot = buildPageSnapshot({ id: 'local-1', title: 'Saved draft', url: '', platform: 'gemini', messages: [{ id: 'a', role: 'user', content: 'Draft content' }] }, 'unknown', 1760000000000, 'draft-capture')
const otherSnapshot = buildPageSnapshot({ id: 'local-2', title: 'Other draft', url: '', platform: 'gemini', messages: [{ id: 'b', role: 'user', content: 'Other content' }] }, 'unknown', 1760000000000, 'other-capture')
const send = vi.fn()
let storageListeners: Array<(...args: unknown[]) => void>
const summaries = [
  { id: 'draft-1', sessionKey: 'gemini:7:aaa', title: 'Saved draft', platform: 'gemini', capturedAt: snapshot.capturedAt, lastSavedAt: snapshot.capturedAt, state: 'protected', messageCount: 1 },
  { id: 'draft-2', sessionKey: 'gemini:9:bbb', title: 'Other draft', platform: 'gemini', capturedAt: otherSnapshot.capturedAt, lastSavedAt: otherSnapshot.capturedAt, state: 'off', messageCount: 1 },
]
beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  storageListeners = []
  send.mockImplementation(async ({ type }: { type: string }) => ({
    data: type === 'LIST_RECOVERY_DRAFTS' ? summaries
      : type === 'GET_RECOVERY_DRAFT' ? snapshot
      : type === 'STOP_RECOVERY_DRAFT' ? { sessionKey: 'gemini:7:aaa', state: 'off' }
      : type === 'DELETE_RECOVERY_DRAFT' || type === 'CLEAR_RECOVERY_DRAFTS' ? true
      : undefined,
  }))
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { sendMessage: send, getURL: (path: string) => `chrome-extension://test/${path}` },
      storage: {
        local: { get: vi.fn().mockResolvedValue({ settings: { locale: 'en', theme: 'light' } }) },
        onChanged: {
          addListener: (fn: (...args: unknown[]) => void) => { storageListeners.push(fn) },
          removeListener: (fn: (...args: unknown[]) => void) => { storageListeners = storageListeners.filter(item => item !== fn) },
        },
      },
    },
  })
  cache.mockResolvedValue(undefined)
})
describe('recovery page', () => {
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
    expect(send).not.toHaveBeenCalledWith({ type: 'DELETE_RECOVERY_DRAFT', data: { id: 'draft-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'DELETE_RECOVERY_DRAFT', data: { id: 'draft-1' } }))
  })
  it('dismisses the confirmation with Escape without deleting', async () => {
    render(<Recovery />)
    const deleteButtons = await screen.findAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[0])
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete permanently' })).toBeNull())
    expect(send).not.toHaveBeenCalledWith({ type: 'DELETE_RECOVERY_DRAFT', data: { id: 'draft-1' } })
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
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'STOP_RECOVERY_DRAFT', data: { id: 'draft-1' } }))
  })
  it('drops a late select response instead of showing the wrong draft', async () => {
    let lateResolve: ((value: unknown) => void) | null = null
    send.mockImplementation(({ type, data }: { type: string; data?: { id?: string } }) => {
      if (type === 'LIST_RECOVERY_DRAFTS') return Promise.resolve({ data: summaries })
      if (type === 'GET_RECOVERY_DRAFT' && data?.id === 'draft-1') return new Promise(resolve => { lateResolve = resolve })
      if (type === 'GET_RECOVERY_DRAFT' && data?.id === 'draft-2') return Promise.resolve({ data: otherSnapshot })
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
    send.mockImplementation(async ({ type }: { type: string }) => ({ data: type === 'LIST_RECOVERY_DRAFTS' ? [{ id: 'draft-1', title: 'Saved draft', platform: 'gemini', capturedAt: snapshot.capturedAt }] : null }))
    render(<Recovery />)
    fireEvent.click(await screen.findByRole('button', { name: 'Saved draft' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Recovery draft is missing or invalid')
  })
})
