import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '..')

describe('unpacked extension delivery', () => {
  it('refreshes and verifies the directory that can be loaded directly in Chrome', () => {
    const buildScript = readFileSync(resolve(repoRoot, 'scripts/build-all.sh'), 'utf8')
    const verifyScript = readFileSync(resolve(repoRoot, 'scripts/verify-build.js'), 'utf8')

    expect(buildScript).toContain('rsync -a --delete build/chrome-mv3-prod/ ai-chat-exporter/')
    expect(buildScript).toContain('node scripts/verify-build.js unpacked')
    expect(verifyScript).toContain("'unpacked'")
    expect(verifyScript).toContain('Unpacked extension differs')
  })
})
