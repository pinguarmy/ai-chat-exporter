import type { GeminiCredential } from '../../src/providers/gemini/credentials'

/**
 * View an object through an interface that names its private members, for
 * tests that must drive or stub internals the public type hides. This is the
 * single place those unchecked casts live, so a renamed member is a one-line fix.
 */
export function internals<T>(instance: object): T {
  return instance as unknown as T
}

/** Private surface of `GeminiParser` that tests call or stub. */
export interface GeminiParserInternals {
  getAuthToken(): Promise<string | null>
  getSessionId(): Promise<string>
  getStoredCredentials(): Promise<{
    credentials?: GeminiCredential
    credentialsMap: Record<string, GeminiCredential>
  }>
  injectPlaceCardLabels(root: Element | null): void
}
