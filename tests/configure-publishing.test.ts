// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { replaceEdgeValues, saveCredentials, readValues } from '../scripts/configure-publishing.mjs'

describe('local publishing credential renewal', () => {
  const original = '# private config\nPLASMO_CHROME_REFRESH_TOKEN=chrome-test\nPLASMO_EDGE_API_KEY=old-test\nPLASMO_EDGE_CLIENT_ID=client-test\nPLASMO_EDGE_PRODUCT_ID=product-test\n'
  const updates = { PLASMO_EDGE_API_KEY: 'new-test', PLASMO_EDGE_CLIENT_ID: 'client-new-test' }

  it('updates only Edge key/client and preserves all other settings', () => {
    const next = replaceEdgeValues(original, updates)
    expect(readValues(next)).toEqual({
      PLASMO_CHROME_REFRESH_TOKEN: 'chrome-test',
      PLASMO_EDGE_API_KEY: 'new-test',
      PLASMO_EDGE_CLIENT_ID: 'client-new-test',
      PLASMO_EDGE_PRODUCT_ID: 'product-test'
    })
    expect(next).toContain('# private config')
    expect(() => replaceEdgeValues(original, { ...updates, PLASMO_EDGE_API_KEY: 'injected\nOTHER=value' })).toThrow()
  })

  it('saves matching private copies and retains the previous configuration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aice-credential-test-'))
    try {
      const repo = path.join(dir, '.env.local')
      const backup = path.join(dir, 'private/credentials.env')
      fs.writeFileSync(repo, original)
      const result = saveCredentials(repo, backup, updates)
      expect(fs.readFileSync(repo, 'utf8')).toBe(fs.readFileSync(backup, 'utf8'))
      expect(fs.readFileSync(result.previousFile, 'utf8')).toBe(original)
      for (const file of [repo, backup, result.previousFile]) expect(fs.statSync(file).mode & 0o777).toBe(0o600)
      expect(fs.statSync(path.dirname(backup)).mode & 0o777).toBe(0o700)
      fs.writeFileSync(backup, 'different preserved configuration')
      expect(() => saveCredentials(repo, backup, updates)).toThrow('differ')
      expect(fs.readFileSync(backup, 'utf8')).toBe('different preserved configuration')
    } finally {
      const resolved = fs.realpathSync(dir)
      if (!path.basename(resolved).startsWith('aice-credential-test-')) throw new Error('Unexpected test directory')
      fs.rmSync(resolved, { recursive: true })
    }
  })
})
