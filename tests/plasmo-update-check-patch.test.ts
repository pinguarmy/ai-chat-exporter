import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isPlasmoUpdateCheckPatched,
  original,
  patched,
} from '../scripts/patch-plasmo-update-check.js'

const repoRoot = resolve(__dirname, '..')
const originalNeedle = 'fe(),kt(),process.env.NODE_ENV='
const patchedNeedle = 'process.env.PLASMO_NO_UPDATE_CHECK||kt()'

describe('Plasmo update-check patch', () => {
  it('still mentions both the original and patched needles', () => {
    const patchScript = readFileSync(resolve(repoRoot, 'scripts/patch-plasmo-update-check.js'), 'utf8')
    expect(patchScript).toContain(originalNeedle)
    expect(patchScript).toContain(patchedNeedle)
    expect(original).toBe(originalNeedle)
    expect(patched).toContain(patchedNeedle)
  })

  it('fails the release build when the patch is required but missing', () => {
    const buildScript = readFileSync(resolve(repoRoot, 'scripts/build-all.sh'), 'utf8')
    const verifier = readFileSync(resolve(repoRoot, 'scripts/verify-plasmo-update-check.js'), 'utf8')
    const plasmoBuild = buildScript.indexOf('PLASMO_NO_UPDATE_CHECK=1 npx plasmo build')
    const verifyCall = buildScript.indexOf('node scripts/verify-plasmo-update-check.js')

    expect(verifyCall).toBeGreaterThan(-1)
    expect(plasmoBuild).toBeGreaterThan(verifyCall)
    expect(buildScript).toContain('if [[ -n "${PLASMO_NO_UPDATE_CHECK}" ]]; then')
    expect(verifier).toContain('isPlasmoUpdateCheckPatched()')
    expect(verifier).toContain('process.exit(1)')
  })

  it('contains the patched needle in the installed Plasmo CLI', () => {
    const cliPath = resolve(repoRoot, 'node_modules/plasmo/dist/index.js')
    expect(existsSync(cliPath), 'npm ci should have installed plasmo').toBe(true)
    expect(readFileSync(cliPath, 'utf8')).toContain(patchedNeedle)
    expect(isPlasmoUpdateCheckPatched()).toBe(true)
  })
})
