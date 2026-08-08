import { toBase64Url, fromBase64Url } from './base64url'
import type { ArtifactClaims, ArtifactVerdict, SeenStore, VerifyArtifactOptions } from './types'

const ISSUER = 'https://api.fortsignal.com'
const CLOCK_SKEW_SECONDS = 30
const JWKS_PATH = '/.well-known/fs-keys.json'
const JWKS_CACHE_MS = 5 * 60 * 1000

export class MemorySeenStore implements SeenStore {
  private seen = new Map<string, number>()
  async claim(jti: string, exp: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000)
    for (const [k, e] of this.seen) if (e < now) this.seen.delete(k)
    if (this.seen.has(jti)) return false
    this.seen.set(jti, exp)
    return true
  }
}

type JwksCache = { keys: any[]; expiresAt: number }

// Server canonicalization — docs/golden vectors pin this exact form:
// SHA-256(`${intentNonce}:${action}:${String(amount)}:${recipient}:${source}:${metadataStr}`)
async function computeParamsHash(intentNonce: string, expected: VerifyArtifactOptions['expected']): Promise<string> {
  const metadataStr = expected.metadata ? JSON.stringify(expected.metadata) : ''
  const payload = `${intentNonce}:${expected.action}:${String(expected.amount ?? 0)}:${expected.recipient}:${expected.source ?? ''}:${metadataStr}`
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return toBase64Url(new Uint8Array(hash))
}

export async function verifyArtifact(
  baseUrl: string,
  jwksCache: JwksCache | null,
  setJwksCache: (c: JwksCache) => void,
  artifact: string,
  options: VerifyArtifactOptions,
): Promise<ArtifactVerdict> {
  if (!options?.seenStore || typeof options.seenStore.claim !== 'function') {
    throw new Error('verifyArtifact requires a seenStore (replay protection is mandatory)')
  }
  if (!options.expected?.action || !options.expected?.recipient) {
    return { valid: false, error: 'artifact_params_mismatch' }
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

  // 2. Key lookup (cached JWKS)
  try {
    if (!jwksCache || jwksCache.expiresAt < Date.now()) {
      const res = await fetch(`${baseUrl}${JWKS_PATH}`)
      if (!res.ok) return { valid: false, error: 'artifact_keys_unavailable' }
      const jwks = await res.json() as any
      jwksCache = { keys: jwks.keys ?? [], expiresAt: Date.now() + JWKS_CACHE_MS }
      setJwksCache(jwksCache)
    }
  } catch {
    return { valid: false, error: 'artifact_keys_unavailable' }
  }
  const jwk = jwksCache.keys.find((k: any) => k.kid === headerObj.kid)
  if (!jwk) return { valid: false, error: 'artifact_unknown_kid' }

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
  if (typeof claims.exp !== 'number') return { valid: false, error: 'artifact_malformed' }
  if (claims.exp + CLOCK_SKEW_SECONDS < now) return { valid: false, error: 'artifact_expired' }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now) {
    return { valid: false, error: 'artifact_not_yet_valid' }
  }

  // 5. Issuer
  if (claims.iss !== ISSUER) return { valid: false, error: 'artifact_issuer_mismatch' }

  // 6. Params binding — the heart of the artifact
  if (!claims.fs?.intentNonce) return { valid: false, error: 'artifact_malformed' }
  const expectedHash = await computeParamsHash(claims.fs.intentNonce, options.expected)
  if (expectedHash !== claims.fs.paramsHash
    || claims.fs.action !== options.expected.action
    || claims.fs.recipient !== options.expected.recipient) {
    return { valid: false, error: 'artifact_params_mismatch' }
  }

  // 7. Replay — only after every cryptographic check has passed
  let claimed: boolean
  try {
    claimed = await options.seenStore.claim(claims.jti, claims.exp)
  } catch {
    return { valid: false, error: 'artifact_store_unavailable' }
  }
  if (!claimed) return { valid: false, error: 'artifact_replayed' }

  return { valid: true, claims }
}
