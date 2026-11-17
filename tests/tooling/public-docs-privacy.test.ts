import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('public documentation privacy', () => {
  for (const file of ['README.md', 'docs/release-workflow.md', 'docs/chrome-publishing-auth.md']) {
    it(`${file} contains reusable guidance, not maintainer machine or cloud identifiers`, () => {
      const text = readFileSync(resolve(__dirname, '..', '..', file), 'utf8')
      expect(text).not.toMatch(/\/Users\/[^/\s`]+\//)
      expect(text).not.toMatch(/C:\\Users\\[^\\\s`]+\\/i)
      expect(text).not.toMatch(/\b[a-z]+-[a-z]+-\d{6}-[a-z0-9]{2,}\b/)
      expect(text).not.toContain('02-项目/ACTIVE/')
    })
  }
})
