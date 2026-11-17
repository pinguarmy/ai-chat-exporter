/**
 * Options page layout and scheduling-control contracts.
 *
 * Behavior is asserted by rendering the real Options page (and the Preview page
 * for the shared scroll guard) with mocked `chrome.*` APIs. Stylesheet text is
 * still asserted for CSS contracts (selectors and properties), which is the
 * one place where the CSS file itself is the unit under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { MIN_SCHEDULE_CHECK_INTERVAL_MINUTES, getDefaultScheduledExportSettings } from '../../../src/core/scheduled-export'
import { sanitizeFilename } from '../../../src/core/filename'
import { sanitizeDownloadFolderName } from '../../../src/core/download-path'
import type { ExtensionSettings, ScheduledExportSettings } from '../../../src/core/types'
import { readCss } from '../../helpers/read-css'

// Records the order in which the page's stylesheets are evaluated. Plasmo injects
// CSS in import order, so evaluation order is the cascade order.
const stylesheetOrder = vi.hoisted(() => [] as string[])
vi.mock('../../../src/styles/popup.css', () => { stylesheetOrder.push('popup.css'); return {} })
vi.mock('../../../src/styles/options.css', () => { stylesheetOrder.push('options.css'); return {} })

type StoredSettings = Partial<ExtensionSettings> & { scheduledExport?: ScheduledExportSettings }

let stored: Record<string, unknown>
let patches: Array<Record<string, any>>

function scheduleWith(overrides: Partial<ScheduledExportSettings> = {}, chatgpt: Record<string, unknown> = {}): ScheduledExportSettings {
  const base = getDefaultScheduledExportSettings()
  return { ...base, enabled: true, ...overrides, platforms: { ...base.platforms, chatgpt: { ...base.platforms.chatgpt, ...chatgpt } } } as ScheduledExportSettings
}

function installChrome(settings: StoredSettings = {}, extra: Record<string, unknown> = {}) {
  stored = { settings, ...extra }
  patches = []
  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: () => ({ version: '9.9.9' }),
      sendMessage: vi.fn(async (message: { type: string; data?: Record<string, any> }) => {
        if (message.type === 'PATCH_SETTINGS') {
          patches.push(message.data!)
          return { data: { ...(stored.settings as object), ...message.data } }
        }
        return { data: true }
      }),
      getURL: (path: string) => path,
    },
    downloads: { showDefaultFolder: vi.fn() },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys]
          return Object.fromEntries(list.filter(key => key in stored).map(key => [key, stored[key]]))
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  })
}

async function renderOptions(settings: StoredSettings = {}, extra: Record<string, unknown> = {}) {
  installChrome(settings, extra)
  const { default: Options } = await import('../../../src/options')
  render(createElement(Options))
  await screen.findByRole('heading', { level: 2, name: 'General & Appearance' })
  // Settings load asynchronously from storage; let that settle before asserting.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

beforeEach(() => {
  document.documentElement.removeAttribute('style')
  document.body.removeAttribute('style')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Options page layout isolation', () => {
  it('loads options CSS after popup CSS so full-page body rules win', async () => {
    installChrome()
    await import('../../../src/options')
    expect(stylesheetOrder).toContain('popup.css')
    expect(stylesheetOrder).toContain('options.css')
    expect(stylesheetOrder.indexOf('popup.css')).toBeLessThan(stylesheetOrder.indexOf('options.css'))
  })

  it('does not import popup CSS from options CSS', () => {
    const source = readCss('options.css')

    expect(source).not.toMatch(/@import\s+['"]\.\/popup\.css['"]/)
    expect(source).toContain('width: auto !important')
    expect(source).toContain('grid-template-columns: repeat(12, minmax(0, 1fr))')
  })

  it('overrides popup html overflow rules so settings pages can scroll', () => {
    const source = readCss('options.css')

    expect(source).toMatch(/html\s*\{[\s\S]*overflow-y:\s*auto[\s\S]*\}/)
    expect(source).toMatch(/html\s*\{[\s\S]*overflow-x:\s*hidden[\s\S]*\}/)
    expect(source).toMatch(/#__plasmo\s*\{[\s\S]*overflow:\s*visible[\s\S]*\}/)
    expect(source).toMatch(/\.popup-container\s*\{[\s\S]*max-height:\s*none[\s\S]*\}/)
  })

  it('overrides popup html overflow rules so preview pages can scroll', () => {
    const source = readCss('print.css')

    expect(source).toMatch(/html\s*\{[\s\S]*overflow-y:\s*auto[\s\S]*\}/)
    expect(source).toMatch(/html\s*\{[\s\S]*overflow-x:\s*hidden[\s\S]*\}/)
    expect(source).toMatch(/#__plasmo\s*\{[\s\S]*overflow:\s*visible[\s\S]*\}/)
    expect(source).toMatch(/\.popup-container\s*\{[\s\S]*max-height:\s*none[\s\S]*\}/)
  })

  describe('runtime scroll guard on full-page extension surfaces', () => {
    function expectScrollGuardApplied(root: HTMLElement) {
      const html = document.documentElement
      expect(html.style.getPropertyValue('overflow-y')).toBe('auto')
      expect(html.style.getPropertyPriority('overflow-y')).toBe('important')
      expect(html.style.getPropertyValue('overflow-x')).toBe('hidden')
      expect(document.body.style.getPropertyValue('overflow-y')).toBe('auto')
      expect(document.body.style.getPropertyValue('width')).toBe('auto')
      expect(document.body.style.getPropertyPriority('width')).toBe('important')
      expect(root.style.getPropertyValue('overflow')).toBe('visible')
      expect(root.style.getPropertyPriority('overflow')).toBe('important')
    }

    it('applies and releases the guard on the options page', async () => {
      const plasmoRoot = document.createElement('div')
      plasmoRoot.id = '__plasmo'
      document.body.appendChild(plasmoRoot)
      await renderOptions()
      expectScrollGuardApplied(plasmoRoot)
      cleanup()
      expect(document.documentElement.style.getPropertyValue('overflow-y')).toBe('')
      expect(plasmoRoot.style.getPropertyValue('overflow')).toBe('')
      plasmoRoot.remove()
    })

    it('applies the guard on the preview page', async () => {
      const plasmoRoot = document.createElement('div')
      plasmoRoot.id = '__plasmo'
      document.body.appendChild(plasmoRoot)
      installChrome()
      const { default: Preview } = await import('../../../src/tabs/preview')
      history.replaceState(null, '', '?id=missing')
      render(createElement(Preview))
      await waitFor(() => expectScrollGuardApplied(plasmoRoot))
      history.replaceState(null, '', '/')
      plasmoRoot.remove()
    })
  })

  it('keeps appearance, storage, and the DIY filename control in the first settings card', async () => {
    await renderOptions()

    const card = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest('.options-card') as HTMLElement
    const generalCard = card('General & Appearance')
    const contentCard = card('Export Content Configuration')
    expect(generalCard).toBeTruthy()
    expect(contentCard).toBeTruthy()
    expect(generalCard.compareDocumentPosition(contentCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(within(generalCard).getByLabelText('UI Theme')).toBeTruthy()
    expect(within(generalCard).getByLabelText('Download Folder Strategy')).toBeTruthy()
    const filenamePanel = within(generalCard).getByText('Filename Pattern').closest('.filename-settings-panel') as HTMLElement
    expect(filenamePanel).toBeTruthy()
    expect(generalCard.contains(filenamePanel)).toBe(true)
    expect(within(contentCard).queryByLabelText('UI Theme')).toBeNull()
    expect(within(contentCard).queryByLabelText('Download Folder Strategy')).toBeNull()
    expect(within(contentCard).queryByText('Filename Pattern')).toBeNull()
  })

  it('sanitizes live filename and custom-folder previews before display', async () => {
    const hostilePattern = 'a<b>:c|d?e*{title}/..\\x'
    const hostileFolder = '../bad:name/..'
    await renderOptions({ filenamePattern: hostilePattern, downloadFolder: 'custom', customFolderName: hostileFolder })

    const preview = document.querySelector('.filename-preview code')!.textContent!
    const expectedFolder = sanitizeDownloadFolderName(hostileFolder)
    const expectedFile = sanitizeFilename(hostilePattern.replace(/\{title\}/g, 'my-chat'))
    expect(preview).toBe(`Downloads/${expectedFolder}/${expectedFile}.md`)
    // Only the two structural separators remain; no traversal or reserved characters.
    const [downloads, folder, file] = preview.split('/')
    expect(preview.split('/')).toHaveLength(3)
    expect(downloads).toBe('Downloads')
    for (const segment of [folder, file]) expect(segment).not.toMatch(/[<>:"|?*\\]/)
    expect(folder).not.toMatch(/\.\./)
    // The custom-folder input itself is untouched; only the preview is sanitized.
    expect((screen.getByLabelText('Custom Subfolder Name') as HTMLInputElement).value).toBe(hostileFolder)
  })

  describe('scheduled export controls', () => {
    const weekly = { enabled: true, frequency: 'weekly', timeOfDay: '08:30', dayOfWeek: 2 }

    async function renderSchedule(chatgpt: Record<string, unknown> = weekly, extra: Record<string, unknown> = {}) {
      await renderOptions({ scheduledExport: scheduleWith({}, chatgpt) }, extra)
      // An enabled saved schedule re-opens automatically.
      await screen.findByLabelText('Scheduled export interval (minutes)')
      fireEvent.click(document.querySelector('.platform-advanced summary')!)
    }

    it('uses the same control treatment for schedule frequency, time, day, and limits', async () => {
      await renderSchedule()
      const frequency = screen.getByLabelText('Frequency for ChatGPT')
      const time = screen.getByLabelText('Local time for ChatGPT')
      const day = screen.getByLabelText('Weekday for ChatGPT')
      const max = screen.getByLabelText('Max limit for ChatGPT')
      const concurrency = screen.getByLabelText('Conversation concurrency for ChatGPT')

      for (const control of [frequency, time, day, max, concurrency]) {
        expect(control.classList.contains('schedule-control'), control.getAttribute('aria-label') ?? '').toBe(true)
        expect(control.closest('.platform-field'), control.getAttribute('aria-label') ?? '').not.toBeNull()
      }
      expect(time.classList.contains('schedule-time-control')).toBe(true)
      expect(max.classList.contains('schedule-number-control')).toBe(true)

      // A custom interval is a number control too.
      fireEvent.change(frequency, { target: { value: 'custom' } })
      const interval = await screen.findByLabelText('Custom interval for ChatGPT')
      expect(interval.classList.contains('schedule-control')).toBe(true)
      expect(interval.classList.contains('schedule-number-control')).toBe(true)

      const css = readCss('options.css')
      expect(css).toContain('.platform-field .schedule-control')
      expect(css).toContain('grid-template-columns: repeat(auto-fit, minmax(132px, 1fr))')
      expect(css).toContain('min-height: 38px')
    })

    it('keeps scheduled export collapsed by default and exposes an accessible toggle', async () => {
      await renderOptions()
      const toggle = document.querySelector<HTMLButtonElement>('.schedule-collapse-button')!
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      const detailsId = toggle.getAttribute('aria-controls')!
      expect(detailsId).toBeTruthy()
      expect(document.getElementById(detailsId)).toBeNull()
      expect(screen.queryByLabelText('Scheduled export interval (minutes)')).toBeNull()

      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      const details = document.getElementById(detailsId)!
      expect(details).toBeTruthy()
      expect(details.contains(screen.getByLabelText('Scheduled export interval (minutes)'))).toBe(true)
      expect(toggle.textContent).toContain('Collapse')

      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(document.getElementById(detailsId)).toBeNull()

      expect(readCss('options.css')).toContain('.schedule-collapse-button:focus-visible')
    })

    it('shows per-platform next-run and authentication status metadata', async () => {
      const lastRun = Date.now() - 60_000
      await renderSchedule({ enabled: true, frequency: 'custom', intervalMinutes: 240 }, {
        'scheduledExport-lastRun-chatgpt': lastRun,
        scheduledExportStatus: {
          isRunning: false,
          platformStatuses: { chatgpt: { state: 'auth_required', checkedAt: Date.now() } },
        },
      })
      // The next run is derived from the stored checkpoint with the schedule's own rules.
      await waitFor(() => expect(screen.getByText(/^Next run: /)).toBeTruthy())
      expect(screen.getByText('Sign-in required')).toBeTruthy()
      expect(screen.getByText(/^Checked /)).toBeTruthy()
      expect(document.querySelector('.platform-status-chip.is-auth_required')).not.toBeNull()
    })

    it('reports a platform as due when its checkpoint is older than its interval', async () => {
      await renderSchedule({ enabled: true, frequency: 'custom', intervalMinutes: 60 }, {
        'scheduledExport-lastRun-chatgpt': Date.now() - 3 * 60 * 60_000,
      })
      await screen.findByText('Due on the next background check')
      expect(screen.getByText('Not checked yet')).toBeTruthy()
      expect(screen.queryByText(/^Next run: /)).toBeNull()
    })

    it('exposes a per-platform skip-archived switch with a unique accessible control', async () => {
      const claude = { enabled: true, frequency: 'daily', skipAlreadyExported: true, overwriteExistingFiles: false, maxPerRun: 20, maxConcurrentConversations: 1 }
      const base = scheduleWith({}, weekly)
      base.platforms.claude = { ...base.platforms.claude, ...claude } as never
      await renderOptions({ scheduledExport: base })
      await screen.findByLabelText('ChatGPT: Skip Already Archived')

      const switches = ['ChatGPT', 'Claude'].map(name => screen.getByLabelText(`${name}: Skip Already Archived`) as HTMLInputElement)
      expect(switches.map(control => control.getAttribute('role'))).toEqual(['switch', 'switch'])
      expect(switches.map(control => control.id)).toEqual(['scheduled-skip-archived-chatgpt', 'scheduled-skip-archived-claude'])
      expect(new Set(switches.map(control => control.id)).size).toBe(2)
      for (const control of switches) expect(document.querySelectorAll(`#${control.id}`)).toHaveLength(1)
      expect(switches[0].checked).toBe(true)

      fireEvent.click(switches[0])
      await waitFor(() => expect(patches.at(-1)?.scheduledExport?.platforms?.chatgpt).toEqual({ skipAlreadyExported: false }))
      expect(switches[1].checked).toBe(true)
    })

    it('exposes a separate opt-in scheduled overwrite switch with a stable-name warning', async () => {
      await renderSchedule()
      const overwrite = screen.getByLabelText('ChatGPT: Overwrite same-name scheduled files') as HTMLInputElement
      const skip = screen.getByLabelText('ChatGPT: Skip Already Archived') as HTMLInputElement
      expect(overwrite.getAttribute('role')).toBe('switch')
      expect(overwrite.id).toBe('scheduled-overwrite-existing-chatgpt')
      expect(overwrite.id).not.toBe(skip.id)
      // Opt-in: off until the user enables it, independent of skip-archived.
      expect(overwrite.checked).toBe(false)
      expect(skip.checked).toBe(true)

      const warning = screen.getAllByRole('tooltip').map(node => node.textContent ?? '').find(text => text.includes('Replaces an existing file'))!
      expect(warning).toContain('Use {platform}-{full_id} for one stable file per chat.')
      expect(warning).toContain('Manual exports are unchanged.')

      fireEvent.click(overwrite)
      await waitFor(() => expect(patches.at(-1)?.scheduledExport?.platforms?.chatgpt).toEqual({ overwriteExistingFiles: true }))
    })

    it('puts the editable background-check interval in the schedule rail', async () => {
      await renderSchedule()
      const input = screen.getByLabelText('Scheduled export interval (minutes)') as HTMLInputElement
      expect(input.closest('.schedule-rail-interval-control')).not.toBeNull()
      expect(input.closest('.schedule-rail')).not.toBeNull()
      expect(input.min).toBe(String(MIN_SCHEDULE_CHECK_INTERVAL_MINUTES))

      fireEvent.change(input, { target: { value: '90' } })
      await waitFor(() => expect(patches.at(-1)?.scheduledExport?.checkIntervalMinutes).toBe(90))
      // The interval applies to every enabled platform as a rolling custom schedule.
      expect(patches.at(-1)?.scheduledExport?.platforms?.chatgpt).toMatchObject({ frequency: 'custom', intervalMinutes: 90 })

      expect(readCss('options.css')).toContain('.schedule-rail-interval-control input')
    })
  })
})
