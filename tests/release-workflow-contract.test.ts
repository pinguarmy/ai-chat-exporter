// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('yaml')

describe('release publication recovery contracts', () => {
  it('preserves original packages before independent store submissions and reports any failure', () => {
    const text = fs.readFileSync('.github/workflows/release.yml', 'utf8')
    const steps = yaml.parse(text).jobs['build-and-release'].steps
    const index = (name: string) => steps.findIndex((step: { name: string }) => step.name === name)
    expect(index('Check publishing configuration before build')).toBeLessThan(index('Build browser and source packages'))
    const stores = ['Publish to Chrome Web Store', 'Publish to Firefox AMO', 'Publish to Microsoft Edge Add-ons']
    for (const name of stores) {
      expect(index('Publish GitHub release')).toBeLessThan(index(name))
      expect(index('Upload workflow artifacts')).toBeLessThan(index(name))
      expect(steps[index(name)]['continue-on-error']).toBe(true)
      expect(steps[index(name)].if).toBeUndefined()
    }
    expect(text).not.toContain('--clobber')
    const summary = steps[index('Summarize store submissions')]
    expect(summary.if).toBe('always()')
    expect(summary.run).toContain('CHROME_OUTCOME')
    expect(summary.run).toContain('FIREFOX_OUTCOME')
    expect(summary.run).toContain('EDGE_OUTCOME')
  })

  it('extracts both actual release note sections without adding verification claims', () => {
    const text = fs.readFileSync('docs/releases/1.5.0.md', 'utf8')
    const zh = text.match(/^## 中文\s*\n([\s\S]*?)(?=^## English\s*$)/m)?.[1]?.trim()
    const en = text.match(/^## English\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.trim()
    expect(zh).toContain('导出流程')
    expect(en).toContain('Export workflow')
    expect(en).not.toContain('## Verification')
  })

  it('submits an existing Chrome draft without opening or uploading a ZIP', async () => {
    let source = fs.readFileSync('scripts/publish-cws.mjs', 'utf8')
    source = source.replace(/^import .*;\n/gm, '')
      .replace("const __dirname = path.dirname(fileURLToPath(import.meta.url));", "const __dirname = '/fake/scripts';")
      .replace(/main\(\)\.catch\([\s\S]*$/, '')
    const calls: Array<{ url: string; method: string }> = []
    const context = vm.createContext({
      fs: { existsSync: () => false, readFileSync: (file: string) => { if (!file.endsWith('package.json')) throw new Error('ZIP should not be read'); return '{"version":"1.5.0"}' } },
      path: require('node:path'),
      URLSearchParams,
      process: { env: { PLASMO_CHROME_ID: 'test-item', PLASMO_CHROME_CLIENT_ID: 'test-client', PLASMO_CHROME_CLIENT_SECRET: 'test-secret', PLASMO_CHROME_REFRESH_TOKEN: 'test-refresh' }, argv: ['node', 'script', '--submit-only'], exit: () => { throw new Error('unexpected exit') } },
      console: { log: () => {}, error: () => {} },
      fetch: async (url: string, init: { method?: string }) => {
        calls.push({ url, method: init?.method || 'GET' })
        return { ok: true, status: 200, json: async () => url.includes('/token') ? { access_token: 'test-token' } : url.includes('/publish') ? { status: ['OK'] } : { crxVersion: '1.5.0' } }
      }
    })
    vm.runInContext(source, context)
    await vm.runInContext('main()', context)
    expect(calls.map(call => call.method)).toEqual(['POST', 'GET', 'POST'])
    expect(calls.some(call => call.url.includes('/upload/'))).toBe(false)
    expect(calls[2].url).toContain('/publish')
  })

  it('refuses an existing Firefox version before uploading anything', async () => {
    let source = fs.readFileSync('scripts/publish-firefox.mjs', 'utf8')
    source = source.replace(/^import .*;\n/gm, '')
      .replace("const __dirname = path.dirname(fileURLToPath(import.meta.url));", "const __dirname = '/fake/scripts';")
      .replace(/main\(\)\.catch\([\s\S]*$/, '')
    const calls: Array<{ url: string; method: string }> = []
    const context = vm.createContext({
      fs: { existsSync: () => true, readFileSync: (file: string) => file.endsWith('package.json') ? '{"version":"1.5.0"}' : '' },
      path: require('node:path'),
      crypto: require('node:crypto'),
      Buffer,
      process: { env: { PLASMO_FIREFOX_ISSUER: 'test-issuer', PLASMO_FIREFOX_SECRET: 'test-secret' }, argv: ['node', 'script'], exit: () => { throw new Error('unexpected exit') } },
      console: { log: () => {}, error: () => {}, warn: () => {} },
      fetch: async (url: string, init: { method?: string }) => {
        calls.push({ url, method: init?.method || 'GET' })
        return { ok: true, status: 200, json: async () => url.includes('/versions/') ? { results: [{ id: 42, version: '1.5.0' }], next: null } : { name: 'Test', status: 'public' } }
      }
    })
    vm.runInContext(source, context)
    await expect(vm.runInContext('main()', context)).rejects.toThrow('already exists as version 42')
    expect(calls).toHaveLength(2)
    expect(calls.every(call => call.method === 'GET')).toBe(true)
  })
})
