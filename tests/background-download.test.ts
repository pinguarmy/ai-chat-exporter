// @ts-nocheck
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('background download filename behavior', () => {
  it('does not register onDeterminingFilename without preserving the requested filename', () => {
    const source = readFileSync(join(process.cwd(), 'src/background.ts'), 'utf8')

    expect(source).not.toContain('onDeterminingFilename.addListener((downloadItem, suggest) => {\n  suggest()')
    expect(source).not.toContain('onDeterminingFilename.addListener')
  })

  it('does not create blob URLs inside the MV3 service worker', () => {
    const source = readFileSync(join(process.cwd(), 'src/background.ts'), 'utf8')

    expect(source).not.toContain('URL.createObjectURL')
    expect(source).toContain("textToDataUrl(markdown, 'text/markdown')")
  })
})
