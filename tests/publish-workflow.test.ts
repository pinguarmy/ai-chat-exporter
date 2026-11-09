// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { checkPublishingConfig, runConfigCheck } from '../scripts/check-publishing-config.mjs'
import { runPublishAll } from '../scripts/publish-all.mjs'

const requiredNames = [
  'PLASMO_CHROME_ID', 'PLASMO_CHROME_CLIENT_ID', 'PLASMO_CHROME_CLIENT_SECRET', 'PLASMO_CHROME_REFRESH_TOKEN',
  'PLASMO_FIREFOX_ISSUER', 'PLASMO_FIREFOX_SECRET',
  'PLASMO_EDGE_CLIENT_ID', 'PLASMO_EDGE_API_KEY', 'PLASMO_EDGE_PRODUCT_ID'
]

// All files and configuration are in memory. Never read local credentials or start a publisher.
function fixture() {
  const rootDir = path.resolve('/publishing-test')
  const files = new Map([
    ['package.json', JSON.stringify({ version: '1.5.0' })],
    ['docs/releases/1.5.0.md', 'Version notes'],
    ['ai-chat-exporter.zip', ''],
    ['ai-chat-exporter-firefox.zip', ''],
    ['ai-chat-exporter-source.zip', '']
  ])
  const env: Record<string, string> = Object.fromEntries(requiredNames.map(name => [name, 'configured-test-value']))
  const fsImpl = {
    existsSync: vi.fn((filename: string) => files.has(path.relative(rootDir, filename))),
    readFileSync: vi.fn((filename: string) => {
      const contents = files.get(path.relative(rootDir, filename))
      if (contents === undefined) throw new Error('Unexpected read')
      return contents
    })
  }
  const spawn = vi.fn(() => ({ status: 0 }))
  const log = vi.fn()
  const error = vi.fn()
  const dependencies = { rootDir, env, fsImpl, spawn, log, error }
  const output = () => [...log.mock.calls, ...error.mock.calls].flat().join('\n')
  const targets = () => spawn.mock.calls.map(call => path.basename(call[1][0]))
  return { files, dependencies, output, targets }
}

describe('publishing preflight', () => {
  it.each(requiredNames)('blocks every child when %s is missing', name => {
    const { dependencies, output } = fixture()
    delete dependencies.env[name]
    expect(runPublishAll([], dependencies)).toBe(1)
    expect(dependencies.spawn).not.toHaveBeenCalled()
    expect(output()).toContain(name)
    expect(output()).not.toContain('configured-test-value')
  })

  it('reports all nine missing names without configured values', () => {
    const { dependencies, output } = fixture()
    dependencies.env = {}
    expect(runConfigCheck([], dependencies)).toBe(1)
    for (const name of requiredNames) expect(output()).toContain(name)
    expect(dependencies.spawn).not.toHaveBeenCalled()
  })

  it('accepts process configuration first and local-file fallback without mutating the environment', () => {
    const { files, dependencies, output } = fixture()
    dependencies.env = { PLASMO_EDGE_CLIENT_ID: 'process-test-value' }
    files.set('.env.local', 'PLASMO_EDGE_CLIENT_ID=""\nPLASMO_EDGE_API_KEY="local-test-value"\nPLASMO_EDGE_PRODUCT_ID=product-test-value\n')
    expect(runConfigCheck(['--only=edge'], dependencies)).toBe(0)
    expect(dependencies.env).toEqual({ PLASMO_EDGE_CLIENT_ID: 'process-test-value' })
    expect(output()).not.toMatch(/process-test-value|local-test-value|product-test-value/)
  })

  it('rejects blank local values and prints names, not file contents', () => {
    const { files, dependencies, output } = fixture()
    dependencies.env = {}
    files.set('.env.local', 'PLASMO_EDGE_CLIENT_ID=""\nPLASMO_EDGE_API_KEY="   "\nPLASMO_EDGE_PRODUCT_ID=private-test-marker\n')
    expect(runConfigCheck(['--only=edge'], dependencies)).toBe(1)
    expect(output()).toContain('PLASMO_EDGE_CLIENT_ID')
    expect(output()).toContain('PLASMO_EDGE_API_KEY')
    expect(output()).not.toContain('private-test-marker')
  })

  it('does not echo errors from reading local configuration', () => {
    const { files, dependencies, output } = fixture()
    files.set('.env.local', 'not read')
    dependencies.fsImpl.readFileSync.mockImplementation(() => { throw new Error('private-test-marker') })
    expect(runConfigCheck([], dependencies)).toBe(1)
    expect(output()).toContain('Could not read .env.local')
    expect(output()).not.toContain('private-test-marker')
  })

  it('requires current-version release notes before starting any child', () => {
    const { files, dependencies, output } = fixture()
    files.delete('docs/releases/1.5.0.md')
    files.set('docs/releases/1.4.0.md', 'Old version notes')
    expect(runPublishAll([], dependencies)).toBe(1)
    expect(dependencies.spawn).not.toHaveBeenCalled()
    expect(output()).toContain('docs/releases/1.5.0.md')
  })

  it('checks all required packages before starting the first publisher', () => {
    const { files, dependencies, output } = fixture()
    files.delete('ai-chat-exporter-source.zip')
    expect(runPublishAll([], dependencies)).toBe(1)
    expect(dependencies.spawn).not.toHaveBeenCalled()
    expect(output()).toContain('ai-chat-exporter-source.zip')
  })

  it('keeps the config CLI local and usable before build without ZIPs', () => {
    const { files, dependencies, output } = fixture()
    for (const filename of files.keys()) if (filename.endsWith('.zip')) files.delete(filename)
    expect(runConfigCheck([], dependencies)).toBe(0)
    expect(dependencies.spawn).not.toHaveBeenCalled()
    expect(output()).toContain('No store API requests were made')
  })
})

describe('selected publishing and summaries', () => {
  it('checks and starts only a single selected platform', () => {
    const { files, dependencies, targets, output } = fixture()
    for (const name of requiredNames) if (!name.startsWith('PLASMO_EDGE_')) delete dependencies.env[name]
    files.delete('ai-chat-exporter-firefox.zip')
    files.delete('ai-chat-exporter-source.zip')
    expect(runPublishAll(['--only=edge'], dependencies)).toBe(0)
    expect(targets()).toEqual(['publish-edge.mjs'])
    expect(dependencies.spawn.mock.calls[0][1]).toHaveLength(1)
    expect(output()).toContain('edge: submitted for review')
    expect(output()).not.toMatch(/chrome:|firefox:|public|上线/)
  })

  it('selects comma-separated platforms, forwards supported modes and strips --only', () => {
    const { dependencies, targets, output } = fixture()
    delete dependencies.env.PLASMO_FIREFOX_SECRET
    expect(runPublishAll(['--only=edge,chrome', '--upload-only'], dependencies)).toBe(0)
    expect(targets()).toEqual(['publish-cws.mjs', 'publish-edge.mjs'])
    for (const call of dependencies.spawn.mock.calls) expect(call[1].slice(1)).toEqual(['--upload-only'])
    expect(output()).toContain('chrome: uploaded')
    expect(output()).toContain('edge: uploaded')
    expect(output()).not.toMatch(/submitted|review|提审|上线/)
  })

  it('does not require Firefox source ZIP in upload-only mode', () => {
    const { files, dependencies, output } = fixture()
    files.delete('ai-chat-exporter-source.zip')
    expect(runPublishAll(['--only=firefox', '--upload-only'], dependencies)).toBe(0)
    expect(output()).toContain('firefox: uploaded')
  })

  it.each([['--dry-run'], ['--dry-run', '--upload-only']])('does not claim submission or upload in dry-run mode %j', (...args) => {
    const { dependencies, targets, output } = fixture()
    expect(runPublishAll(args, dependencies)).toBe(0)
    expect(targets()).toEqual(['publish-cws.mjs', 'publish-firefox.mjs', 'publish-edge.mjs'])
    expect(output()).toContain('chrome: local checks passed')
    expect(output()).toContain('firefox: local checks passed')
    expect(output()).toContain('edge: local checks passed')
    expect(output()).toContain('Dry run only; no store API requests were made')
    expect(output()).not.toMatch(/submitted|uploaded|review|提审|上线/)
    for (const call of dependencies.spawn.mock.calls) expect(call[1].slice(1)).toEqual(args)
  })

  it('continues after failures and retains per-platform outcomes', () => {
    const { dependencies, targets, output } = fixture()
    dependencies.spawn.mockReturnValueOnce({ status: 1 }).mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 2 })
    expect(runPublishAll([], dependencies)).toBe(1)
    expect(targets()).toEqual(['publish-cws.mjs', 'publish-firefox.mjs', 'publish-edge.mjs'])
    expect(output()).toContain('chrome: failed')
    expect(output()).toContain('firefox: submitted for review')
    expect(output()).toContain('edge: failed')
  })

  it('continues after a child cannot start without logging thrown data', () => {
    const { dependencies, targets, output } = fixture()
    dependencies.spawn.mockImplementationOnce(() => { throw new Error('private-test-marker') })
    expect(runPublishAll([], dependencies)).toBe(1)
    expect(targets()).toHaveLength(3)
    expect(output()).toContain('chrome: failed')
    expect(output()).toContain('edge: submitted for review')
    expect(output()).not.toContain('private-test-marker')
  })

  it.each(['--dryrun', '--check-auth', '--only=safari', '--only=', '--only', '--api-key=private-test-marker'])('rejects unsupported arguments %s before starting any child', arg => {
    const { dependencies, output } = fixture()
    expect(runPublishAll([arg], dependencies)).toBe(1)
    expect(dependencies.spawn).not.toHaveBeenCalled()
    expect(dependencies.fsImpl.readFileSync).not.toHaveBeenCalled()
    expect(output()).not.toContain('private-test-marker')
  })

  it('rejects repeated selection rather than silently changing targets', () => {
    const { dependencies } = fixture()
    expect(runPublishAll(['--only=edge', '--only=chrome'], dependencies)).toBe(1)
    expect(dependencies.spawn).not.toHaveBeenCalled()
  })

  it('rejects publisher modes in the local config CLI', () => {
    const { dependencies } = fixture()
    expect(runConfigCheck(['--upload-only'], dependencies)).toBe(1)
    expect(dependencies.fsImpl.readFileSync).not.toHaveBeenCalled()
  })

  it('exports a side-effect-free config check using only injected files and environment', () => {
    const { dependencies } = fixture()
    expect(checkPublishingConfig(dependencies)).toEqual({ ok: true, errors: [] })
    expect(dependencies.spawn).not.toHaveBeenCalled()
  })
})
