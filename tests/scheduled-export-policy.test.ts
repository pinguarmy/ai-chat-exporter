import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PROVIDER_RATE_LIMITED_ERROR } from '../src/lib/provider-rate-limit'

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
    alarms: {
      create: vi.fn(),
      get: vi.fn((_name: string, callback: (alarm?: unknown) => void) => callback(undefined)),
      onAlarm: { addListener: vi.fn() },
    },
  })
})

describe('scheduled export policy', () => {
  it('uses the shortest enabled custom interval for the wake-up alarm', async () => {
    const { getScheduledExportAlarmPeriodMinutes } = await import('../src/background')

    expect(getScheduledExportAlarmPeriodMinutes({
      checkIntervalMinutes: 30,
      platforms: {
        chatgpt: { enabled: true, frequency: 'custom', intervalMinutes: 5 },
        claude: { enabled: true, frequency: 'custom', intervalMinutes: 12 },
        gemini: { enabled: false, frequency: 'custom', intervalMinutes: 1 },
        deepseek: { enabled: false, frequency: 'daily' },
        grok: { enabled: false, frequency: 'weekly' },
      },
    } as never)).toBe(5)
  })

  it('uses the user-selected global interval when no platform needs a shorter wake-up', async () => {
    const { getScheduledExportAlarmPeriodMinutes } = await import('../src/background')

    expect(getScheduledExportAlarmPeriodMinutes({
      checkIntervalMinutes: 37,
      platforms: {
        chatgpt: { enabled: true, frequency: 'daily' },
        claude: { enabled: false, frequency: 'daily' },
        gemini: { enabled: false, frequency: 'daily' },
        deepseek: { enabled: false, frequency: 'daily' },
        grok: { enabled: false, frequency: 'daily' },
      },
    } as never)).toBe(37)
  })

  it('applies persisted global Markdown preferences instead of hard-coded values', async () => {
    const { buildScheduledExportOptions } = await import('../src/background')

    expect(buildScheduledExportOptions('markdown', {
      includeMetadata: false,
      includeCodeBlocks: false,
      includeImages: false,
      exportArtifacts: false,
      includeUploadedFiles: false,
      referenceExportMode: 'titles',
      filenamePattern: '{platform}-{title}',
      assistantDisplayName: 'Export Bot',
      showMessageTimestamps: false,
      locale: 'zh-CN',
    })).toEqual({
      format: 'markdown',
      includeMetadata: false,
      includeCodeBlocks: false,
      includeImages: false,
      exportArtifacts: false,
      includeUploadedFiles: false,
      referenceExportMode: 'titles',
      filenamePattern: '{platform}-{title}',
      assistantDisplayName: 'Export Bot',
      showMessageTimestamps: false,
      locale: 'zh-CN',
    })
  })

  it('fills missing legacy preferences from defaults', async () => {
    const { buildScheduledExportOptions } = await import('../src/background')

    expect(buildScheduledExportOptions('markdown', { includeMetadata: false })).toMatchObject({
      format: 'markdown',
      includeMetadata: false,
      includeCodeBlocks: true,
      includeImages: true,
      exportArtifacts: true,
      includeUploadedFiles: true,
      referenceExportMode: 'titles',
      filenamePattern: '{date}-{title}',
      assistantDisplayName: '',
      showMessageTimestamps: true,
      locale: 'en',
    })
  })

  it('uses the page fallback when scheduled API detail is unavailable', async () => {
    const { resolveScheduledConversation } = await import('../src/background')
    const item = {
      id: 'conversation-1',
      title: 'Safe test conversation',
      url: 'https://chatgpt.com/c/conversation-1',
      platform: 'chatgpt',
    } as const
    const completeConversation = {
      ...item,
      messages: [
        { id: 'user-1', role: 'user' as const, content: 'Question' },
        { id: 'assistant-1', role: 'assistant' as const, content: 'Answer' },
      ],
    }

    const result = await resolveScheduledConversation(
      item,
      async () => ({ data: null }),
      async () => ({ data: completeConversation }),
    )

    expect(result).toMatchObject({
      conversation: completeConversation,
      directFailureReason: 'detail_unavailable',
      fallbackRecovered: true,
    })
  })

  it('records a safe reason when both scheduled detail paths are unusable', async () => {
    const { recordScheduledFailure, resolveScheduledConversation } = await import('../src/background')
    const item = {
      id: 'conversation-2',
      title: 'Safe test conversation',
      url: 'https://chatgpt.com/c/conversation-2',
      platform: 'chatgpt',
    } as const
    const status = { lastRunExported: 0, lastRunFailed: 1, isRunning: false }

    const result = await resolveScheduledConversation(
      item,
      async () => ({ data: { ...item, messages: [] } }),
      async () => ({ data: null }),
    )

    expect(result).toMatchObject({
      conversation: null,
      directFailureReason: 'detail_incomplete',
      failureReason: 'fallback_unavailable',
    })
    recordScheduledFailure(status, result.failureReason!)
    expect(status.lastRunFailureBreakdown).toEqual({ fallback_unavailable: 1 })
  })

  it('skips page fallback when scheduled detail fetch requires authentication', async () => {
    const { resolveScheduledConversation } = await import('../src/background')
    const item = {
      id: 'conversation-auth',
      title: 'Safe test conversation',
      url: 'https://chatgpt.com/c/conversation-auth',
      platform: 'chatgpt',
    } as const
    const fetchFallback = vi.fn(async () => ({ data: null }))

    const result = await resolveScheduledConversation(
      item,
      async () => ({ error: '401 Unauthorized' }),
      fetchFallback,
    )

    expect(result).toMatchObject({
      conversation: null,
      directFailureReason: 'auth_required',
      fallbackRecovered: false,
      failureReason: 'authentication_required',
    })
    expect(fetchFallback).not.toHaveBeenCalled()
  })

  it('marks a provider rate limit without retaining provider text or conversation data', async () => {
    const { recordScheduledRateLimit, resolveScheduledConversation } = await import('../src/background')
    const item = {
      id: 'conversation-3',
      title: 'Safe test conversation',
      url: 'https://chatgpt.com/c/conversation-3',
      platform: 'chatgpt',
    } as const
    const recoveredConversation = {
      ...item,
      messages: [
        { id: 'user-1', role: 'user' as const, content: 'Question' },
        { id: 'assistant-1', role: 'assistant' as const, content: 'Answer' },
      ],
    }

    const result = await resolveScheduledConversation(
      item,
      async () => ({ error: PROVIDER_RATE_LIMITED_ERROR }),
      async () => ({ data: recoveredConversation }),
    )
    expect(result).toMatchObject({
      conversation: recoveredConversation,
      directFailureReason: 'rate_limited',
      fallbackRecovered: true,
    })

    const status = { lastRunExported: 0, lastRunFailed: 0, isRunning: false }
    recordScheduledRateLimit(status, 'chatgpt')
    recordScheduledRateLimit(status, 'chatgpt')
    expect(status.lastRunRateLimitedPlatforms).toEqual(['chatgpt'])
  })

  it('keeps browser download failures distinct in safe aggregate diagnostics', async () => {
    const { classifyScheduledDownloadFailure } = await import('../src/background')

    expect(classifyScheduledDownloadFailure(new Error('Download completion timed out'))).toBe('download_timed_out')
    expect(classifyScheduledDownloadFailure(new Error('Download interrupted: FILE_FAILED'))).toBe('download_interrupted')
    expect(classifyScheduledDownloadFailure(new Error('Invalid URL'))).toBe('download_request_failed')
  })

  it('clears visible run status and due markers together with export history', async () => {
    const get = vi.fn(async () => ({
      'exportedRecord-chatgpt-a': {},
      'exportedRecord-gemini-b': {},
      unrelated: {},
    }))
    const remove = vi.fn(async () => undefined)
    Object.assign(globalThis.chrome, { storage: { local: { get, remove } } })
    const { clearExportedHistory } = await import('../src/background')

    await clearExportedHistory()

    const removedKeys = remove.mock.calls.flat(2) as string[]
    expect(removedKeys).toContain('scheduledExportStatus')
    expect(removedKeys).toContain('scheduledExport-activeRun')
    expect(removedKeys).toContain('scheduledExport-stopRequest')
    expect(removedKeys).toContain('scheduledExport-lastRun-chatgpt')
    expect(removedKeys).toContain('scheduledExport-lastRun-grok')
    expect(removedKeys).toContain('exportedRecord-chatgpt-a')
    expect(removedKeys).toContain('exportedRecord-gemini-b')
    expect(removedKeys).not.toContain('unrelated')
  })

  it('stops persisted scheduled resources after the service worker has restarted', async () => {
    const values: Record<string, unknown> = {
      scheduledExportStatus: {
        runId: 'scheduled-restarted-run',
        lastRunAt: 1_700_000_000_000,
        lastRunExported: 2,
        lastRunFailed: 0,
        isRunning: true,
        activePlatforms: ['chatgpt'],
      },
      'scheduledExport-activeRun': {
        id: 'scheduled-restarted-run',
        startedAt: 1_700_000_000_000,
        tabIds: [12, 13],
        downloadIds: [41],
      },
    }
    const get = vi.fn(async (keys: string | string[]) => {
      const requested = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(requested.map(key => [key, values[key]]))
    })
    const set = vi.fn(async (next: Record<string, unknown>) => {
      Object.assign(values, next)
    })
    const cancel = vi.fn(async () => undefined)
    const removeTab = vi.fn(async () => undefined)
    Object.assign(globalThis.chrome, {
      storage: { local: { get, set, remove: vi.fn() } },
      downloads: { cancel },
      tabs: { remove: removeTab },
    })

    const {
      handleScheduledExportStop,
      SCHEDULED_ACTIVE_RUN_KEY,
      SCHEDULED_STOP_REQUEST_KEY,
    } = await import('../src/background')
    const result = await handleScheduledExportStop()

    expect(result).toEqual({ data: true })
    expect(cancel).toHaveBeenCalledWith(41)
    expect(removeTab).toHaveBeenCalledWith(12)
    expect(removeTab).toHaveBeenCalledWith(13)
    expect(values[SCHEDULED_ACTIVE_RUN_KEY]).toMatchObject({
      id: 'scheduled-restarted-run',
      stopRequestedAt: expect.any(Number),
    })
    expect(values[SCHEDULED_STOP_REQUEST_KEY]).toMatchObject({
      runId: 'scheduled-restarted-run',
      requestedAt: expect.any(Number),
    })
    expect(values.scheduledExportStatus).toMatchObject({
      isRunning: false,
      lastRunCancelled: true,
      activePlatforms: [],
    })
  })
})
