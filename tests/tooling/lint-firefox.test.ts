// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { evaluateLintReport, KNOWN_WARNINGS } from '../../scripts/lint-firefox.mjs'

describe('lint-firefox report evaluation', () => {
  it('fails on any web-ext error', () => {
    const result = evaluateLintReport({
      errors: [{ code: 'MANIFEST_FIELD_REQUIRED' }],
      warnings: []
    })
    expect(result.ok).toBe(false)
  })

  it('accepts only documented warnings in documented files', () => {
    const result = evaluateLintReport({
      errors: [],
      warnings: [
        { code: 'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION', file: 'manifest.json' },
        { code: 'UNSAFE_VAR_ASSIGNMENT', file: 'chunks/mount-page-DnfcbUa7.js' },
        { code: 'DANGEROUS_EVAL', file: 'chunks/index.es-DLii8EN2.js' }
      ]
    })
    expect(result.ok).toBe(true)
    expect(result.accepted).toBe(3)
  })

  it('fails on new warning codes and on known codes in new files', () => {
    const result = evaluateLintReport({
      errors: [],
      warnings: [
        { code: 'UNSAFE_VAR_ASSIGNMENT', file: 'new-feature.1234.js' },
        { code: 'PERMISSIONS_UNKNOWN', file: 'manifest.json' }
      ]
    })
    expect(result.ok).toBe(false)
    expect(result.unexpected).toHaveLength(2)
  })

  it('documents a reason for every accepted warning', () => {
    for (const known of KNOWN_WARNINGS) expect(known.reason.length).toBeGreaterThan(20)
  })
})
