import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger, errorName, isDebugLogging, setDebugLogging } from '../../src/core/logger'

describe('logger', () => {
  const originalDebug = isDebugLogging()
  const spies = {
    debug: vi.spyOn(console, 'debug'),
    info: vi.spyOn(console, 'info'),
    warn: vi.spyOn(console, 'warn'),
    error: vi.spyOn(console, 'error')
  }

  beforeEach(() => {
    for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined)
  })
  afterEach(() => {
    for (const spy of Object.values(spies)) spy.mockClear()
    setDebugLogging(originalDebug)
  })

  it('prefixes the scope and emits a single string when no metadata is given', () => {
    createLogger('Scope').warn('Something failed')
    expect(spies.warn).toHaveBeenCalledWith('[Scope] Something failed')
  })

  it('passes numeric/boolean metadata as a second argument', () => {
    createLogger('Scope').error('API error', { status: 503, retried: false })
    expect(spies.error).toHaveBeenCalledWith('[Scope] API error', { status: 503, retried: false })
  })

  it('routes each level to the matching console method', () => {
    setDebugLogging(true)
    const log = createLogger('S')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    expect(spies.debug).toHaveBeenCalledWith('[S] d')
    expect(spies.info).toHaveBeenCalledWith('[S] i')
    expect(spies.warn).toHaveBeenCalledWith('[S] w')
    expect(spies.error).toHaveBeenCalledWith('[S] e')
  })

  it('suppresses debug output when debug logging is off but keeps higher levels', () => {
    setDebugLogging(false)
    const log = createLogger('S')
    log.debug('hidden')
    log.warn('shown')
    expect(spies.debug).not.toHaveBeenCalled()
    expect(spies.warn).toHaveBeenCalledTimes(1)
  })

  it('treats empty metadata like no metadata', () => {
    createLogger('S').info('x', {})
    expect(spies.info).toHaveBeenCalledWith('[S] x')
  })
})

describe('errorName', () => {
  it('returns only the class name, never the message', () => {
    expect(errorName(new TypeError('https://example.com/c/secret-id failed'))).toBe('TypeError')
  })

  it('labels non-Error values by type', () => {
    expect(errorName('private string')).toBe('string')
    expect(errorName(null)).toBe('null')
    expect(errorName(undefined)).toBe('undefined')
    expect(errorName({ message: 'x' })).toBe('object')
  })
})
