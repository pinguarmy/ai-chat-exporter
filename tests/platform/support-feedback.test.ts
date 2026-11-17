import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { registerUninstallFeedback, UNINSTALL_URL } from '../../src/platform/support'
import { readCss } from '../helpers/read-css'

const root = resolve(__dirname, '..', '..')
function feedback(fetch: ReturnType<typeof vi.fn>) {
  const dom = new JSDOM(readFileSync(resolve(root, 'uninstall.html'), 'utf8'), {
    runScripts: 'outside-only',
    url: UNINSTALL_URL
  })
  dom.window.fetch = fetch
  dom.window.eval(readFileSync(resolve(root, 'uninstall.js'), 'utf8'))
  return dom
}
type FeedbackFetch = (
  url: string,
  init: { body: string; credentials?: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('optional uninstall feedback', () => {
  it('registers a static URL and tolerates unavailable APIs', async () => {
    const setUninstallURL = vi.fn(async () => {})
    vi.stubGlobal('chrome', { runtime: { setUninstallURL } })
    await registerUninstallFeedback()
    expect(setUninstallURL).toHaveBeenCalledWith(UNINSTALL_URL)
    expect(new URL(UNINSTALL_URL).search).toBe('')
    vi.stubGlobal('chrome', { runtime: {} })
    await expect(registerUninstallFeedback()).resolves.toBeUndefined()
  })

  it('sends only on Submit and confirms successful persisted response', async () => {
    const network = vi.fn<FeedbackFetch>(async (_url, init) => ({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, id: JSON.parse(init.body).id })
    }))
    const dom = feedback(network)
    const document = dom.window.document
    const choice = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    choice.checked = true
    const notes = document.querySelector<HTMLTextAreaElement>('#notes')!
    notes.value = 'Please fix formatting & spacing'
    document.querySelector<HTMLInputElement>('#contact')!.value = 'reply@example.com'
    expect(network).not.toHaveBeenCalled()
    document.querySelector<HTMLButtonElement>('#submit')!.click()
    await settle()
    expect(network).toHaveBeenCalledTimes(1)
    const [url, init] = network.mock.calls[0]
    expect(url).toBe('https://feedback.pengyuhao.com/api/feedback')
    expect(init.credentials).toBe('omit')
    expect(JSON.parse(init.body)).toMatchObject({
      text: notes.value,
      contact: 'reply@example.com',
      reasons: ['Export failed or content was missing']
    })
    expect(document.querySelector('#feedback-status')?.textContent).toContain('received')
    expect(document.querySelector<HTMLButtonElement>('#submit')!.disabled).toBe(true)
    expect(document.querySelector('a[href="mailto:extensions@pengyuhao.com"]')?.textContent).toBe(
      'extensions@pengyuhao.com'
    )
    expect(dom.window.localStorage.length).toBe(0)
    dom.window.close()
  })

  it('preserves input and reuses an idempotency ID on retry after a failed response', async () => {
    const network = vi.fn<FeedbackFetch>(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ ok: false })
    }))
    const dom = feedback(network)
    const document = dom.window.document
    document.querySelector<HTMLTextAreaElement>('#notes')!.value = 'Need help'
    document.querySelector<HTMLButtonElement>('#submit')!.click()
    await settle()
    expect(document.querySelector('#feedback-status')?.textContent).toContain('retry')
    expect(document.querySelector<HTMLTextAreaElement>('#notes')!.value).toBe('Need help')
    document.querySelector<HTMLButtonElement>('#submit')!.click()
    await settle()
    expect(JSON.parse(network.mock.calls[0][1].body).id).toBe(
      JSON.parse(network.mock.calls[1][1].body).id
    )
    dom.window.close()
  })

  it('uses shared locale-aware serif fonts while leaving code separate', () => {
    const css = readCss('popup.css')
    expect(css).toContain("@import '../../typography.css'")
    const typography = readFileSync(resolve(root, 'typography.css'), 'utf8')
    for (const font of ['Iowan Old Style', 'Songti SC', 'Hiragino Mincho ProN', 'AppleMyungjo'])
      expect(typography).toContain(font)
    expect(css).not.toContain('font-family: var(--font-mono)')
  })
})
