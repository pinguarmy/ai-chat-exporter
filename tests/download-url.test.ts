import { describe, expect, it } from 'vitest'
import { bytesToDataUrl, textToDataUrl } from '../src/lib/download-url'

function decodeDataUrl(url: string): string {
  const encoded = url.slice(url.indexOf(',') + 1)
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

describe('textToDataUrl', () => {
  it('preserves arbitrary binary archive bytes across chunk boundaries', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256)
    const url = bytesToDataUrl(bytes, 'application/zip')
    expect(url).toMatch(/^data:application\/zip;base64,/)
    expect(Uint8Array.from(atob(url.split(',')[1]), char => char.charCodeAt(0))).toEqual(bytes)
  })
  it('preserves Unicode and reserved URL characters', () => {
    const input = '# 你好\nA&B? #fragment'
    const url = textToDataUrl(input, 'text/markdown')

    expect(url).toMatch(/^data:text\/markdown;base64,/)
    expect(decodeDataUrl(url)).toBe(input)
  })

  it('does not throw for malformed provider text and handles chunk boundaries', () => {
    const input = `${'界'.repeat(20_000)}\uD800`

    expect(() => textToDataUrl(input)).not.toThrow()
    // TextEncoder normalizes a lone UTF-16 surrogate to U+FFFD rather than
    // aborting the whole scheduled export with URIError.
    expect(decodeDataUrl(textToDataUrl(input))).toBe(`${'界'.repeat(20_000)}�`)
  })
})
