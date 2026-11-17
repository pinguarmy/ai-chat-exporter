/**
 * Gemini credential bridge: validation, bounded retention and storage of the
 * `at` token / `f.sid` session id the page-world hook script observes.
 *
 * Tokens are session secrets. They are never logged, never exported and are
 * kept in memory-backed chrome.storage.session whenever it is reachable.
 */
export interface GeminiCredential {
  at?: string
  sid?: string
  accountSlot?: string
  lastUsed?: number
}

const GEMINI_CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000
const GEMINI_CREDENTIAL_MAX_ENTRIES = 8
export const GEMINI_CREDENTIAL_STORAGE_KEYS = ['gemini_credentials', 'gemini_credentials_map'] as const

/**
 * Auth tokens are session secrets: keep them in chrome.storage.session, which
 * is memory-backed and never written to disk. Older versions persisted the
 * same keys to chrome.storage.local (unencrypted on-disk JSON); those legacy
 * copies are migrated into the session area and deleted on first read/write.
 * When the session area is unreachable from this context the parser falls
 * back to chrome.storage.local so exports keep working.
 */
export type GeminiCredentialArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>

let geminiCredentialArea: Promise<GeminiCredentialArea> | null = null

/** Test hook: re-arm the probe and migration after swapping storage mocks. */
export function resetGeminiCredentialMigrationForTests(): void {
  geminiCredentialArea = null
}

/**
 * Resolve the credential storage area once per content-script lifetime, then
 * migrate any legacy on-disk copies into it.
 *
 * This module runs as a content script, and chrome.storage.session is only
 * reachable from an untrusted context after the service worker calls
 * storage.session.setAccessLevel('TRUSTED_AND_UNTRUSTED_CONTEXTS') — see
 * src/background.ts. That call can be absent or unsupported (older Chromium,
 * a Firefox build without setAccessLevel, a worker that has not started yet),
 * and in those cases the property can exist while every call rejects. So the
 * area is probed once rather than assumed.
 */
export function getGeminiCredentialArea(): Promise<GeminiCredentialArea> {
  if (!geminiCredentialArea) {
    geminiCredentialArea = (async () => {
      const session = chrome.storage.session as GeminiCredentialArea | undefined
      if (!session) return chrome.storage.local

      try {
        // A read is the cheapest way to learn whether this context may touch
        // the session area; an access error surfaces here rather than on the
        // first real credential write.
        await session.get(GEMINI_CREDENTIAL_STORAGE_KEYS[0])
      } catch {
        return chrome.storage.local
      }

      await migrateLegacyGeminiCredentials(session)
      return session
    })().catch(() => chrome.storage.local)
  }
  return geminiCredentialArea
}

/** One-shot move of pre-migration credentials out of the on-disk area. */
async function migrateLegacyGeminiCredentials(target: GeminiCredentialArea): Promise<void> {
  if (target === chrome.storage.local) return
  try {
    const legacy = await chrome.storage.local.get([...GEMINI_CREDENTIAL_STORAGE_KEYS])
    const writes: Record<string, unknown> = {}
    for (const key of GEMINI_CREDENTIAL_STORAGE_KEYS) {
      if (legacy[key] !== undefined) writes[key] = legacy[key]
    }
    if (Object.keys(writes).length > 0) await target.set(writes)
    await chrome.storage.local.remove([...GEMINI_CREDENTIAL_STORAGE_KEYS])
  } catch {
    // A failed migration must not break credential reads. The legacy copies
    // stay readable on disk and the next content-script load retries.
  }
}

const GEMINI_AUTH_TOKEN_MAX_LENGTH = 4096
const GEMINI_SESSION_ID_MAX_LENGTH = 64
const GEMINI_ACCOUNT_SLOT_MAX_LENGTH = 16

/** Validate page-world credentials before they enter extension storage. */
export function validateGeminiCredentialPayload(payload: unknown, now = Date.now()): GeminiCredential | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as GeminiCredential
  const at = candidate.at
  const sid = candidate.sid
  const accountSlot = candidate.accountSlot
  const lastUsed = candidate.lastUsed

  if (at !== undefined && (typeof at !== 'string' || !at || at.length > GEMINI_AUTH_TOKEN_MAX_LENGTH)) return null
  if (sid !== undefined && (typeof sid !== 'string' || !/^[+-]?\d+$/.test(sid) || sid.length > GEMINI_SESSION_ID_MAX_LENGTH)) return null
  if (!at && !sid) return null
  if (typeof accountSlot !== 'string' || accountSlot.length > GEMINI_ACCOUNT_SLOT_MAX_LENGTH || !/^(?:default|u\d+)$/.test(accountSlot)) return null
  if (typeof lastUsed !== 'number' || !Number.isFinite(lastUsed) || lastUsed < now - GEMINI_CREDENTIAL_TTL_MS || lastUsed > now + 5 * 60 * 1000) return null

  return { at, sid, accountSlot, lastUsed }
}

/** Keep only recent, valid credentials and cap retained account sessions. */
export function pruneGeminiCredentialMap(
  credentialsMap: Record<string, GeminiCredential> | undefined,
  now = Date.now()
): Record<string, GeminiCredential> {
  const validEntries = Object.entries(credentialsMap || {})
    .map(([key, credential]) => {
      // Older extension versions stored mapped credentials before lastUsed was
      // available. Retain them once, timestamping their migration so TTL
      // enforcement starts immediately rather than breaking active sessions.
      const normalized = credential.lastUsed === undefined ? { ...credential, lastUsed: now } : credential
      return [key, validateGeminiCredentialPayload(normalized, now)] as const
    })
    .filter((entry): entry is readonly [string, GeminiCredential] => entry[1] !== null)
    .sort(([, left], [, right]) => (right.lastUsed || 0) - (left.lastUsed || 0))
    .slice(0, GEMINI_CREDENTIAL_MAX_ENTRIES)

  return Object.fromEntries(validEntries)
}

/**
 * The legacy singleton has no account-slot binding, but it is still used as a
 * fallback while an older page has not produced a hooked credential yet. Give
 * it the same bounded lifetime as the account map and persist the migration so
 * an old entry cannot receive a fresh 24-hour lease on every read.
 */
export function normalizeGeminiSingletonCredential(
  value: unknown,
  now = Date.now()
): GeminiCredential | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as GeminiCredential
  const at = candidate.at
  const sid = candidate.sid
  const lastUsed = candidate.lastUsed

  if (at !== undefined && (typeof at !== 'string' || !at || at.length > GEMINI_AUTH_TOKEN_MAX_LENGTH)) return undefined
  if (sid !== undefined && (typeof sid !== 'string' || !/^[+-]?\d+$/.test(sid) || sid.length > GEMINI_SESSION_ID_MAX_LENGTH)) return undefined
  if (!at && !sid) return undefined
  if (lastUsed !== undefined && (
    typeof lastUsed !== 'number' ||
    !Number.isFinite(lastUsed) ||
    lastUsed < now - GEMINI_CREDENTIAL_TTL_MS ||
    lastUsed > now + 5 * 60 * 1000
  )) return undefined

  return { at, sid, lastUsed: lastUsed ?? now }
}


/** Select the newest credential for the active account without cross-account
 * token reuse. Exported so credential selection can be regression-tested
 * without exposing real credentials. */
export function selectGeminiCredential(
  credentialsMap: Record<string, GeminiCredential>,
  accountSlot: string,
  required?: 'at' | 'sid'
): GeminiCredential | null {
  const candidates = Object.values(credentialsMap)
    .filter(credential => credential.accountSlot === accountSlot)
    .filter(credential => Boolean(required ? credential[required] : credential.at || credential.sid))
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
  return candidates[0] || null
}

/**
 * Get the account slot from the URL path (e.g., /u/0/app/...)
 */
export function getGeminiAccountSlot(): string {
  try {
    const matched = window.location.pathname.match(/\/u\/(\d+)(?:\/|$)/)
    if (matched?.[1]) return `u${matched[1]}`
  } catch { /* no readable location; use the default account slot */ }
  return 'default'
}

/** Read bridge credentials while removing expired or malformed map entries. */
export async function readStoredGeminiCredentials(): Promise<{
  credentials?: GeminiCredential
  credentialsMap: Record<string, GeminiCredential>
}> {
  const area = await getGeminiCredentialArea()
  const stored = await area.get([...GEMINI_CREDENTIAL_STORAGE_KEYS])
  const storedMap: Record<string, GeminiCredential> = stored.gemini_credentials_map || {}
  const now = Date.now()
  const credentialsMap = pruneGeminiCredentialMap(storedMap, now)
  const credentials = normalizeGeminiSingletonCredential(stored.gemini_credentials, now)
  const mapChanged = JSON.stringify(credentialsMap) !== JSON.stringify(storedMap)
  const singletonChanged = JSON.stringify(credentials) !== JSON.stringify(stored.gemini_credentials)

  if (mapChanged || (singletonChanged && credentials)) {
    await area.set({
      ...(mapChanged ? { gemini_credentials_map: credentialsMap } : {}),
      ...(singletonChanged && credentials ? { gemini_credentials: credentials } : {})
    })
  }
  if (singletonChanged && !credentials && stored.gemini_credentials !== undefined) {
    await area.remove('gemini_credentials')
  }
  return { credentials, credentialsMap }
}

/** Remove only credentials that are demonstrably invalid for this account. */
export async function clearStoredGeminiCredentialsForAccount(accountSlot: string): Promise<void> {
  try {
    const area = await getGeminiCredentialArea()
    const stored = await area.get(['gemini_credentials_map'])
    const credentialsMap = pruneGeminiCredentialMap(stored.gemini_credentials_map)
    for (const [key, credential] of Object.entries(credentialsMap)) {
      if (credential.accountSlot === accountSlot) delete credentialsMap[key]
    }
    await area.set({ gemini_credentials_map: credentialsMap })
    await area.remove('gemini_credentials')
  } catch {
    // Storage is optional for DOM parsing and must not mask the API failure.
  }
}

/**
 * Persist a credential posted by the page-world hook script. The payload comes
 * from an untrusted page context, so it is validated before it is stored;
 * storage failures are swallowed because credentials are optional for DOM
 * parsing.
 */
export async function storeGeminiCredentialFromPage(payload: unknown): Promise<void> {
  const credential = validateGeminiCredentialPayload(payload)
  if (!credential) return
  try {
    const area = await getGeminiCredentialArea()

    // Get existing map to merge
    const existing = await area.get(['gemini_credentials_map'])
    const credentialsMap = pruneGeminiCredentialMap(existing.gemini_credentials_map)

    // Update the map with new credentials for this session
    const key = credential.sid || 'default'
    credentialsMap[key] = {
      ...credential
    }
    const prunedCredentialsMap = pruneGeminiCredentialMap(credentialsMap)

    await area.set({
      gemini_credentials: { at: credential.at, sid: credential.sid, lastUsed: credential.lastUsed },
      gemini_credentials_map: prunedCredentialsMap
    })
  } catch {
    // Storage may not be available in some contexts
  }
}
