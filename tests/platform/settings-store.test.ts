import { it, expect, vi } from 'vitest'
import { persistSettingsPatch, settingsDifference } from '../../src/platform/settings-store'
interface StoredSettings {
  includeImages: boolean
  includeCodeBlocks: boolean
  scheduledExport: {
    enabled: boolean
    platforms: { chatgpt: { enabled: boolean; maxPerRun: number } }
  }
}

it('merges concurrent contexts and nested schedule fields without losing unrelated updates', async () => {
  let settings: StoredSettings = {
    includeImages: true,
    includeCodeBlocks: true,
    scheduledExport: { enabled: true, platforms: { chatgpt: { enabled: true, maxPerRun: 20 } } }
  }
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async () => ({ settings }),
        set: async (value: { settings: StoredSettings }) => {
          await Promise.resolve()
          settings = value.settings
        }
      }
    }
  })
  await Promise.all([
    persistSettingsPatch({ includeImages: false }),
    persistSettingsPatch({ includeCodeBlocks: false }),
    persistSettingsPatch({ scheduledExport: { platforms: { chatgpt: { maxPerRun: 10 } } } })
  ])
  expect(settings.includeImages).toBe(false)
  expect(settings.includeCodeBlocks).toBe(false)
  expect(settings.scheduledExport.platforms.chatgpt).toEqual({ enabled: true, maxPerRun: 10 })
  expect(settingsDifference({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 4, d: 3 } })).toEqual({
    b: { c: 4 }
  })
  await expect(persistSettingsPatch({ badField: 'x' })).rejects.toThrow('Unknown settings field')
  vi.unstubAllGlobals()
})

it('resolves a patch only after its write is durable, and a failed write does not block later patches', async () => {
  let settings: Record<string, unknown> = { includeImages: true }
  let failNext = true
  const order: string[] = []
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async () => ({ settings }),
        set: async (value: { settings: Record<string, unknown> }) => {
          if (failNext) {
            failNext = false
            throw new Error('quota')
          }
          await new Promise(resolve => setTimeout(resolve, 5))
          settings = value.settings
          order.push('written')
        }
      }
    }
  })
  await expect(persistSettingsPatch({ includeImages: false })).rejects.toThrow('quota')
  expect(settings.includeImages).toBe(true)
  const first = persistSettingsPatch({ includeCodeBlocks: false }).then(() => order.push('first'))
  const second = persistSettingsPatch({ theme: 'dark' }).then(() => order.push('second'))
  await Promise.all([first, second])
  expect(order).toEqual(['written', 'first', 'written', 'second'])
  expect(settings).toMatchObject({ includeCodeBlocks: false, theme: 'dark' })
  vi.unstubAllGlobals()
})
