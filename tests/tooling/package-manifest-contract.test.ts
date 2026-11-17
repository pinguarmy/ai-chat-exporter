import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'))

describe('package.json build contract', () => {
  it('declares the same Node toolchain floor in engines and devEngines', () => {
    // devEngines makes npm fail the install; engines is the conventional field
    // other tools read. The WXT/Vite build ignores both (the previous Parcel
    // build read engines.node as a build target and could not tolerate it).
    expect(pkg.devEngines?.runtime?.name).toBe('node')
    expect(typeof pkg.devEngines?.runtime?.version).toBe('string')
    expect(pkg.devEngines.runtime.onFail).toBe('error')
    expect(pkg.engines?.node).toBe(pkg.devEngines.runtime.version)
  })
})
