import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'))

describe('package.json build contract', () => {
  it('declares the Node toolchain floor through devEngines, never engines', () => {
    // Parcel treats engines.node as a build target, which breaks the Plasmo
    // extension build (entry pages resolve as a Node environment).
    expect(pkg.engines).toBeUndefined()
    expect(pkg.devEngines?.runtime?.name).toBe('node')
    expect(typeof pkg.devEngines?.runtime?.version).toBe('string')
  })
})
