import { vi } from 'vitest'

/**
 * `vi.fn` for a `fetch` replacement whose signature is the real one. A bare
 * `vi.fn(async () => ...)` infers a zero-argument function, which makes
 * `mock.calls[n]` an empty tuple and hides the URL and init a test inspects.
 */
export function mockFetch<R>(impl: (url: string, init?: RequestInit) => Promise<R>) {
  return vi.fn(impl)
}
