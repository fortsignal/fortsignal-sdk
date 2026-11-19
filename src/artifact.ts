import { toBase64Url, fromBase64Url } from './base64url'
import type { ArtifactClaims, ArtifactVerdict, SeenStore, VerifyArtifactOptions } from './types'

/** Hosted FortSignal artifact issuer. Self-hosted deployments override this on the client. */
export const DEFAULT_ARTIFACT_ISSUER = 'https://api.fortsignal.com'

/**
 * Acceptance slack on both sides of `nbf`/`exp`. Seen-store retention must
 * cover this too: the verifier still accepts an artifact until `exp + skew`.
 */
export const ARTIFACT_CLOCK_SKEW_SECONDS = 30

/** Hosted API cap on `exp - iat`. Override per call with `maxLifetimeSeconds`. */
export const DEFAULT_MAX_ARTIFACT_LIFETIME_SECONDS = 300

const JWKS_PATH = '/.well-known/fs-keys.json'
const JWKS_CACHE_MS = 5 * 60 * 1000
/** Minimum gap between JWKS fetches triggered by an unknown `kid` or a failed refresh. */
const JWKS_REFRESH_COOLDOWN_MS = 30 * 1000
/**
 * After a successful fetch, keep using those keys when later refreshes fail,
 * but not forever: a removed (compromised) key must stop verifying once the
 * JWKS has been unreachable for this long.
 */
const JWKS_MAX_STALE_MS = 60 * 60 * 1000

export type JwksCache = {
  keys: any[]
  /** `Date.now()` when this payload stops being fresh and a refresh is attempted. */
  expiresAt: number
  /** `Date.now()` of the last successful fetch. Stale serving is bounded from here. */
  fetchedAt?: number
  /** `Date.now()` of the last attempt, success or failure. Drives the cooldown. */
  attemptedAt?: number
}

export type JwksState = {
  cache: JwksCache | null
  /** In-flight refresh, shared so concurrent verifies don't stampede the JWKS. */
  inflight: Promise<LoadResult> | null
}

type LoadResult = { keys: any[] } | { error: 'artifact_keys_unavailable' }

/**
 * Redis `PX` (milliseconds) for a seen-store `claim`.
 *
 * `retainUntilEpochSeconds` is the deadline `verifyArtifact` passes to
 * `SeenStore.claim`: the last second it will still accept the artifact
 * (`exp` + clock skew). The TTL runs through the end of that second — a
 * millisecond TTL aimed at the start of the second drops the id while the
 * verifier is still accepting — and is always an integer ≥ 1. Redis rejects
 * `PX <= 0` (`ERR invalid expire time`), which the verifier surfaces as
 * `artifact_store_unavailable`, including for a legitimate first use inside
 * the skew window.
 */
export function seenRetentionMs(retainUntilEpochSeconds: number, nowMs: number = Date.now()): number {
  if (!Number.isFinite(retainUntilEpochSeconds) || !Number.isFinite(nowMs)) return 1
  const ttl = (retainUntilEpochSeconds + 1) * 1000 - nowMs
  if (ttl <= 1) return 1
  return Math.ceil(ttl)
}

/**
 * Single-process replay store. Production executors need a shared store
 * (see `seenRetentionMs`); this one is for dev and tests.
 *
 * Entries are retained until the deadline passed to `claim` (the verifier
 * passes `exp` + clock skew, inclusive of that second) and expired entries
 * are dropped from a deadline heap, so a claim does not scan the map.
 */
export class MemorySeenStore implements SeenStore {
  private readonly seen = new Map<string, number>()
  private readonly heap: Array<{ jti: string; until: number }> = []

  async claim(jti: string, retainUntilEpochSeconds: number): Promise<boolean> {
    if (typeof jti !== 'string' || jti.length === 0) return false
    if (!Number.isFinite(retainUntilEpochSeconds)) return false
    const now = Math.floor(Date.now() / 1000)
    this.evict(now)
    if (this.seen.has(jti)) return false
    this.seen.set(jti, retainUntilEpochSeconds)
    this.heapPush({ jti, until: retainUntilEpochSeconds })
    return true
  }

  /** Drop ids whose deadline second is already over. `until` is inclusive. */
  private evict(now: number): void {
    while (this.heap.length > 0 && this.heap[0].until < now) {
      const top = this.heapPop()
      // A newer claim of the same jti may have replaced the deadline.
      if (this.seen.get(top.jti) === top.until) this.seen.delete(top.jti)
    }
  }

  private heapPush(entry: { jti: string; until: number }): void {
    const h = this.heap
    h.push(entry)
    let i = h.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (h[parent].until <= h[i].until) break
      const tmp = h[parent]
      h[parent] = h[i]
      h[i] = tmp
      i = parent
    }
  }

  private heapPop(): { jti: string; until: number } {
    const h = this.heap
    const top = h[0]
    const last = h.pop()
    if (last !== undefined && h.length > 0) {
      h[0] = last
      let i = 0
      for (;;) {
        const left = i * 2 + 1
        const right = left + 1
        let smallest = i
        if (left < h.length && h[left].until < h[smallest].until) smallest = left
        if (right < h.length && h[right].until < h[smallest].until) smallest = right
        if (smallest === i) break
        const tmp = h[smallest]
        h[smallest] = h[i]
        h[i] = tmp
        i = smallest
      }
    }
    return top
  }
}

// Server canonicalization — docs/golden vectors pin this exact form:
// SHA-256(`${intentNonce}:${action}:${String(amount)}:${recipient}:${source}:${metadataStr}`)
// + `:${mandateId}` when the action ran under a mandate (Track B — the API
// appends the same trailing field; mismatch in either direction fails binding).
async function computeParamsHash(intentNonce: string, expected: VerifyArtifactOptions['expected']): Promise<string> {
  const metadataStr = expected.metadata ? JSON.stringify(expected.metadata) : ''
  const payload = `${intentNonce}:${expected.action}:${String(expected.amount ?? 0)}:${expected.recipient}:${expected.source ?? ''}:${metadataStr}`
    + (expected.mandateId ? `:${expected.mandateId}` : '')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return toBase64Url(new Uint8Array(hash))
}

function isFresh(cache: JwksCache | null, now: number): boolean {
  // `expiresAt` in the future means a successful fetch (even of zero keys).
  // A failed fetch stores `expiresAt: 0`, so it is not fresh and can be retried
  // after the cooldown. This is a boolean on purpose: a type predicate would
  // tell TypeScript that a stale cache is `null`, which it is not.
  return !!cache && cache.expiresAt >= now && Array.isArray(cache.keys)
}

function fetchedAtOf(cache: JwksCache): number {
  if (typeof cache.fetchedAt === 'number') return cache.fetchedAt
  // Objects minted before `fetchedAt` existed: freshness still implies a recent fetch.
  return cache.expiresAt - JWKS_CACHE_MS
}

function attemptedAtOf(cache: JwksCache, now: number): number {
  if (typeof cache.attemptedAt === 'number') return cache.attemptedAt
  // A still-fresh legacy cache was fetched inside its TTL. Treat that as
  // "just now" so an unknown kid does not immediately refetch keys we trust.
  if (cache.expiresAt >= now) return now
  return 0
}

function inCooldown(cache: JwksCache, now: number): boolean {
  return now - attemptedAtOf(cache, now) < JWKS_REFRESH_COOLDOWN_MS
}

function staleUsable(cache: JwksCache, now: number): boolean {
  if (!Array.isArray(cache.keys) || cache.keys.length === 0) return false
  return now - fetchedAtOf(cache) < JWKS_MAX_STALE_MS
}

function findJwk(keys: any[], kid: unknown): any | undefined {
  if (typeof kid !== 'string' || kid.length === 0) return undefined
  return keys.find((k) => k && k.kid === kid)
}

function audienceIncludes(aud: unknown, tenant: string): boolean {
  if (typeof aud === 'string') return aud === tenant
  if (Array.isArray(aud)) return aud.some((entry) => entry === tenant)
  return false
}

async function fetchJwks(baseUrl: string, state: JwksState, now: number): Promise<LoadResult> {
  if (state.inflight) return state.inflight
  const run = (async (): Promise<LoadResult> => {
    try {
      const res = await fetch(`${baseUrl}${JWKS_PATH}`)
      if (!res.ok) return keepStaleOrFail(state, now)
      const body = await res.json() as any
      if (!body || !Array.isArray(body.keys)) return keepStaleOrFail(state, now)
      const fetched = Date.now()
      state.cache = {
        keys: body.keys,
        expiresAt: fetched + JWKS_CACHE_MS,
        fetchedAt: fetched,
        attemptedAt: fetched,
      }
      return { keys: body.keys }
    } catch {
      return keepStaleOrFail(state, now)
    }
  })()
  state.inflight = run
  try {
    return await run
  } finally {
    if (state.inflight === run) state.inflight = null
  }
}

function keepStaleOrFail(state: JwksState, now: number): LoadResult {
  const cache = state.cache
  if (cache && staleUsable(cache, now)) {
    state.cache = { ...cache, attemptedAt: now }
    return { keys: cache.keys }
  }
  if (cache) state.cache = { ...cache, attemptedAt: now }
  else state.cache = { keys: [], expiresAt: 0, fetchedAt: 0, attemptedAt: now }
  return { error: 'artifact_keys_unavailable' }
}

/**
 * Fresh cache is returned as-is. Otherwise refresh, unless a recent attempt
 * failed and the cached keys are still inside the stale window.
 */
async function loadKeys(baseUrl: string, state: JwksState): Promise<LoadResult> {
  const now = Date.now()
  const cache = state.cache
  if (cache && isFresh(cache, now)) return { keys: cache.keys }
  if (cache && inCooldown(cache, now)) {
    if (staleUsable(cache, now)) return { keys: cache.keys }
    return { error: 'artifact_keys_unavailable' }
  }
  return fetchJwks(baseUrl, state, now)
}

export async function verifyArtifact(
  baseUrl: string,
  jwksState: JwksState,
  artifact: string,
  options: VerifyArtifactOptions,
  issuer: string = DEFAULT_ARTIFACT_ISSUER,
): Promise<ArtifactVerdict> {
  // Emission fails open, so executors can legitimately receive undefined —
  // a missing artifact must be a verdict, never a throw.
  if (typeof artifact !== 'string' || !artifact) return { valid: false, error: 'artifact_malformed' }
  if (!options?.seenStore || typeof options.seenStore.claim !== 'function') {
    throw new Error('verifyArtifact requires a seenStore (replay protection is mandatory)')
  }
  if (!options.expected?.action || !options.expected?.recipient) {
    return { valid: false, error: 'artifact_params_mismatch' }
  }
  const maxLifetime = options.maxLifetimeSeconds ?? DEFAULT_MAX_ARTIFACT_LIFETIME_SECONDS
  if (typeof maxLifetime !== 'number' || !Number.isFinite(maxLifetime) || maxLifetime < 0) {
    throw new Error('verifyArtifact maxLifetimeSeconds must be a finite number >= 0')
  }

  const parts = artifact.split('.')
  if (parts.length !== 3) return { valid: false, error: 'artifact_malformed' }
  const [header, body, sig] = parts

  let headerObj: any, claims: ArtifactClaims
  try {
    headerObj = JSON.parse(new TextDecoder().decode(fromBase64Url(header)))
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
  } catch {
    return { valid: false, error: 'artifact_malformed' }
  }

  // 1. Algorithm + type — exact match, no negotiation, ever
  if (headerObj.alg !== 'EdDSA' || headerObj.typ !== 'fs-artifact+jwt') {
    return { valid: false, error: 'artifact_alg_rejected' }
  }

  // 2. Key lookup. Unknown kid → one rate-limited refetch (rotation).
  //    A failed fetch keeps serving the last keys until JWKS_MAX_STALE_MS.
  const loaded = await loadKeys(baseUrl, jwksState)
  if ('error' in loaded) return { valid: false, error: loaded.error }

  let jwk = findJwk(loaded.keys, headerObj.kid)
  if (!jwk) {
    const now = Date.now()
    const cache = jwksState.cache
    if (!cache || !inCooldown(cache, now)) {
      const refreshed = await fetchJwks(baseUrl, jwksState, now)
      if (!('error' in refreshed)) jwk = findJwk(refreshed.keys, headerObj.kid)
    }
    if (!jwk) return { valid: false, error: 'artifact_unknown_kid' }
  }

  // 3. Signature
  try {
    const key = await crypto.subtle.importKey(
      'jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x } as JsonWebKey,
      { name: 'Ed25519' }, false, ['verify'])
    const valid = await crypto.subtle.verify('Ed25519', key,
      fromBase64Url(sig).buffer as ArrayBuffer,
      new TextEncoder().encode(`${header}.${body}`).buffer as ArrayBuffer)
    if (!valid) return { valid: false, error: 'artifact_bad_signature' }
  } catch {
    return { valid: false, error: 'artifact_bad_signature' }
  }

  // 4. Temporal window
  const now = Math.floor(Date.now() / 1000)
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    return { valid: false, error: 'artifact_malformed' }
  }
  if (claims.exp + ARTIFACT_CLOCK_SKEW_SECONDS < now) return { valid: false, error: 'artifact_expired' }
  if (typeof claims.nbf === 'number' && claims.nbf - ARTIFACT_CLOCK_SKEW_SECONDS > now) {
    return { valid: false, error: 'artifact_not_yet_valid' }
  }

  // 5. Issuer — configurable, never skipped. Default is the hosted API.
  if (claims.iss !== issuer) return { valid: false, error: 'artifact_issuer_mismatch' }

  // 6. jti is mandatory. Without one, every such artifact shares a single
  //    replay slot (or none), so distinct artifacts replay-reject each other
  //    and a missing id cannot be remembered across the skew window.
  if (typeof claims.jti !== 'string' || claims.jti.length === 0) {
    return { valid: false, error: 'artifact_missing_jti' }
  }

  // 7. Lifetime cap. `exp - iat` above the maximum (hosted API: 300s) is
  //    rejected. A missing `iat` would skip the cap, so it fails closed too.
  //    Checked before the seen-store claim so an invalid artifact is not burned.
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.exp - claims.iat > maxLifetime) {
    return { valid: false, error: 'artifact_lifetime_exceeded' }
  }

  // 8. Tenant. Opt-in so existing callers keep working; production executors
  //    should set it. `sub` is the tenant. `aud`, when the token carries one,
  //    must include the same value (string or array, per RFC 7519).
  const tenant = options.tenant
  if (typeof tenant === 'string' && tenant.length > 0) {
    if (claims.sub !== tenant) return { valid: false, error: 'artifact_tenant_mismatch' }
    if (claims.aud !== undefined && !audienceIncludes(claims.aud, tenant)) {
      return { valid: false, error: 'artifact_audience_mismatch' }
    }
  }

  // 9. Params binding — the heart of the artifact
  if (!claims.fs?.intentNonce) return { valid: false, error: 'artifact_malformed' }
  const expectedHash = await computeParamsHash(claims.fs.intentNonce, options.expected)
  if (expectedHash !== claims.fs.paramsHash
    || claims.fs.action !== options.expected.action
    || claims.fs.recipient !== options.expected.recipient) {
    return { valid: false, error: 'artifact_params_mismatch' }
  }

  // 10. Replay — only after every cryptographic and policy check has passed.
  //     The deadline is the last second the verifier will accept (`exp` + skew),
  //     not raw `exp`. Stores that evict at `exp` forget the id while this
  //     function still returns valid.
  let claimed: boolean
  try {
    claimed = await options.seenStore.claim(claims.jti, claims.exp + ARTIFACT_CLOCK_SKEW_SECONDS)
  } catch {
    return { valid: false, error: 'artifact_store_unavailable' }
  }
  if (!claimed) return { valid: false, error: 'artifact_replayed' }

  return { valid: true, claims }
}
