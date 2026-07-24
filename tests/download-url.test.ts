import { describe, expect, it } from 'vitest'
import { textToDataUrl } from '../src/lib/download-url'

describe('textToDataUrl', () => {
  it('preserves Unicode and reserved URL characters', () => {
    const input = '# 你好\nA&B? #fragment'
    const url = textToDataUrl(input, 'text/markdown')

    expect(url).toBe(`data:text/markdown;charset=utf-8,${encodeURIComponent(input)}`)
    expect(decodeURIComponent(url.split(',')[1])).toBe(input)
  })
})
