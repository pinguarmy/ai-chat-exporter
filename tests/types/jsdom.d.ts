/**
 * Minimal typing for the jsdom surface the tests use (`@types/jsdom` is not a
 * dependency). Extend here when a test needs more of the API.
 */
declare module 'jsdom' {
  export interface JSDOMOptions {
    runScripts?: 'dangerously' | 'outside-only'
    url?: string
  }
  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions)
    readonly window: Omit<Window & typeof globalThis, 'fetch'> & {
      fetch: unknown
      eval(code: string): unknown
    }
  }
}
