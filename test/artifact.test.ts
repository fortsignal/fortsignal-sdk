import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FortSignal, MemorySeenStore, seenRetentionMs } from '../src/index'
import type { SeenStore } from '../src/index'
import { ARTIFACT_CLOCK_SKEW_SECONDS, DEFAULT_MAX_ARTIFACT_LIFETIME_SECONDS } from '../src/artifact'

const realDateNow = Date.now.bind(Date)
afterEach(() => {
  Date.now = realDateNow
  vi.unstubAllGlobals()
})

async function makeKey() {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as any
  jwk.kid = 'fs-test-a'
  return { pair, jwk }
}

const b64u = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

async function mint(jwk: any, pair: CryptoKeyPair, claims: any): Promise<string> {
  const header = b64u(new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'fs-artifact+jwt', kid: jwk.kid })))
  const body = b64u(new TextEncoder().encode(JSON.stringify(claims)))
  const sig = await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(`${header}.${body}`))
  return `${header}.${body}.${b64u(new Uint8Array(sig))}`
}

function validClaims(overrides: any = {}) {
  const iat = Math.floor(Date.now() / 1000)
  return {
    iss: 'https://api.fortsignal.com', sub: 'tenant_1', jti: crypto.randomUUID(),
    iat, nbf: iat, exp: iat + 60,
    fs: {
      v: 1, verifiedBy: 'agent', intentNonce: 'nonce123',
      paramsHash: '', action: 'execute', recipient: 'cmd:git status', amount: 0,
    },
    ...overrides,
  }
}

// Must mirror the server canonicalization EXACTLY:
// SHA-256(`${intentNonce}:${action}:${String(amount)}:${recipient}:${source}:${metadataStr}`)
// + `:${mandateId}` when the action ran under a mandate (Track B)
async function fillParamsHash(claims: any, expected: any) {
  const metadataStr = expected.metadata ? JSON.stringify(expected.metadata) : ''
  const payload = `${claims.fs.intentNonce}:${expected.action}:${String(expected.amount ?? 0)}:${expected.recipient}:${expected.source ?? ''}:${metadataStr}`
    + (expected.mandateId ? `:${expected.mandateId}` : '')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  claims.fs.paramsHash = b64u(new Uint8Array(hash))
  return claims
}

const EXPECTED = { action: 'execute', recipient: 'cmd:git status', amount: 0 }

function clientWithJwks(jwk: any, opts: { issuer?: string; baseUrl?: string } = {}) {
  const client = new FortSignal({
    apiKey: 'fs_live_test',
    baseUrl: opts.baseUrl ?? 'http://localhost:9',
    ...(opts.issuer ? { issuer: opts.issuer } : {}),
  })
  const now = Date.now()
  ;(client as any).jwksState.cache = {
    keys: [{ kty: 'OKP', crv: 'Ed25519', kid: jwk.kid, x: jwk.x, alg: 'EdDSA', use: 'sig' }],
    expiresAt: now + 24 * 60 * 60 * 1000,
    fetchedAt: now,
    attemptedAt: now,
  }
  return client
}

function jwksResponse(keys: any[], status = 200) {
  return new Response(JSON.stringify({ keys }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('verifyArtifact', () => {
  let key: Awaited<ReturnType<typeof makeKey>>
  beforeEach(async () => { key = await makeKey() })

  it('accepts a valid artifact', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const verdict = await clientWithJwks(key.jwk).verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() })
    expect(verdict.valid).toBe(true)
  })

  it('rejects when expected params differ (params_mismatch)', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const verdict = await clientWithJwks(key.jwk).verifyArtifact(token, {
      expected: { ...EXPECTED, amount: 99999 }, seenStore: new MemorySeenStore(),
    })
    expect(verdict).toEqual({ valid: false, error: 'artifact_params_mismatch' })
  })

  // ── Mandate binding (Track B) — the mandateId joins the params hash ──

  it('accepts a mandate-bound artifact when the same mandateId is expected', async () => {
    const expected = { ...EXPECTED, mandateId: 'man_0123456789abcdef' }
    const claims = await fillParamsHash(validClaims({ fs: { ...validClaims().fs, mandateId: expected.mandateId, mandateHash: 'mh' } }), expected)
    const token = await mint(key.jwk, key.pair, claims)
    const verdict = await clientWithJwks(key.jwk).verifyArtifact(token, { expected, seenStore: new MemorySeenStore() })
    expect(verdict.valid).toBe(true)
  })

  it('rejects a mandate-bound artifact when no mandateId is expected (fail closed)', async () => {
    const expected = { ...EXPECTED, mandateId: 'man_0123456789abcdef' }
    const claims = await fillParamsHash(validClaims({ fs: { ...validClaims().fs, mandateId: expected.mandateId } }), expected)
    const token = await mint(key.jwk, key.pair, claims)
    // Executor did not request a mandate — the hash must not match
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_params_mismatch' })
  })

  it('rejects a mandate-free artifact when a mandateId is expected', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, {
      expected: { ...EXPECTED, mandateId: 'man_0123456789abcdef' }, seenStore: new MemorySeenStore(),
    })).toEqual({ valid: false, error: 'artifact_params_mismatch' })
  })

  it('rejects replay (second claim on same jti)', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const store = new MemorySeenStore()
    const client = clientWithJwks(key.jwk)
    expect((await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store })).valid).toBe(true)
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store }))
      .toEqual({ valid: false, error: 'artifact_replayed' })
  })

  it('rejects expired artifacts', async () => {
    const iat = Math.floor(Date.now() / 1000) - 600
    const claims = await fillParamsHash(validClaims({ iat, nbf: iat, exp: iat + 60 }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_expired' })
  })

  it('rejects alg confusion (header alg tampered → alg_rejected)', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const [, body, sig] = token.split('.')
    const hsHeader = b64u(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'fs-artifact+jwt', kid: key.jwk.kid })))
    expect(await clientWithJwks(key.jwk).verifyArtifact(`${hsHeader}.${body}.${sig}`, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_alg_rejected' })
  })

  it('rejects unknown kid', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const other = await makeKey()
    other.jwk.kid = 'fs-test-b' // makeKey defaults kid to 'fs-test-a'; must differ so the kid is NOT in the JWKS
    const token = await mint(other.jwk, other.pair, claims) // signed + kid of a key NOT in the JWKS
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_unknown_kid' })
  })

  it('does not throw on non-string input (emission fails open → artifact may be undefined)', async () => {
    const verdict = await clientWithJwks(key.jwk).verifyArtifact(undefined as any, { expected: EXPECTED, seenStore: new MemorySeenStore() })
    expect(verdict).toEqual({ valid: false, error: 'artifact_malformed' })
  })

  it('throws when seenStore is missing', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    await expect(clientWithJwks(key.jwk).verifyArtifact(token, { expected: EXPECTED } as any)).rejects.toThrow('seenStore')
  })
})

describe('replay across the clock-skew window', () => {
  let key: Awaited<ReturnType<typeof makeKey>>
  beforeEach(async () => { key = await makeKey() })

  it('rejects a second use inside the skew window, including after another claim', async () => {
    const t0 = 1_700_000_000_000
    Date.now = () => t0
    const iat = t0 / 1000
    const claims = await fillParamsHash(validClaims({ iat, nbf: iat, exp: iat + 60, jti: 'jti-replay' }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const store = new MemorySeenStore()
    const client = clientWithJwks(key.jwk)

    expect((await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store })).valid).toBe(true)
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store }))
      .toEqual({ valid: false, error: 'artifact_replayed' })

    // exp + 10s: still inside the 30s acceptance window. Evicting at raw exp
    // used to forget the jti here and accept the replay.
    const atExpPlus10 = (claims.exp + 10) * 1000
    Date.now = () => atExpPlus10
    const other = await fillParamsHash(validClaims({ iat, nbf: iat, exp: iat + 60, jti: 'jti-other' }), EXPECTED)
    const otherToken = await mint(key.jwk, key.pair, other)
    expect((await client.verifyArtifact(otherToken, { expected: EXPECTED, seenStore: store })).valid).toBe(true)
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store }))
      .toEqual({ valid: false, error: 'artifact_replayed' })
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store }))
      .toEqual({ valid: false, error: 'artifact_replayed' })

    // Last accepted second is still a replay, not a fresh accept.
    Date.now = () => (claims.exp + ARTIFACT_CLOCK_SKEW_SECONDS) * 1000
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store }))
      .toEqual({ valid: false, error: 'artifact_replayed' })

    Date.now = () => (claims.exp + ARTIFACT_CLOCK_SKEW_SECONDS + 1) * 1000
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store }))
      .toEqual({ valid: false, error: 'artifact_expired' })
  })

  it('accepts a first use inside the skew window', async () => {
    const t0 = 1_700_000_000_000
    Date.now = () => t0
    const iat = t0 / 1000
    const exp = iat + 60
    Date.now = () => (exp + 10) * 1000
    const claims = await fillParamsHash(validClaims({ iat, nbf: iat, exp, jti: 'jti-late' }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const verdict = await clientWithJwks(key.jwk).verifyArtifact(token, {
      expected: EXPECTED,
      seenStore: new MemorySeenStore(),
    })
    expect(verdict.valid).toBe(true)
  })

  it('passes exp + skew as the seen-store retention deadline', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const seen: Array<{ jti: string; until: number }> = []
    const store: SeenStore = {
      async claim(jti, until) {
        seen.push({ jti, until })
        return true
      },
    }
    expect((await clientWithJwks(key.jwk).verifyArtifact(token, { expected: EXPECTED, seenStore: store })).valid).toBe(true)
    expect(seen).toEqual([{ jti: claims.jti, until: claims.exp + ARTIFACT_CLOCK_SKEW_SECONDS }])
  })

  it('evicts by deadline, not insertion order', async () => {
    const base = 1_800_000_000_000
    Date.now = () => base
    const store = new MemorySeenStore()
    const now = base / 1000
    const deadlines = [now + 50, now + 5, now + 40, now + 1, now + 20]
    for (let i = 0; i < deadlines.length; i++) {
      expect(await store.claim('j' + i, deadlines[i])).toBe(true)
    }
    Date.now = () => (now + 10) * 1000
    expect(await store.claim('j1', now + 100)).toBe(true) // now+5, expired
    expect(await store.claim('j3', now + 100)).toBe(true) // now+1, expired
    expect(await store.claim('j0', now + 50)).toBe(false)
    expect(await store.claim('j2', now + 40)).toBe(false)
    expect(await store.claim('j4', now + 20)).toBe(false)
  })
})

describe('seenRetentionMs (Redis PX)', () => {
  // Mirrors the README recipe: SET key 1 PX ttl NX, PX must be a positive integer.
  class FakeRedis {
    readonly m = new Map<string, number>()
    async set(key: string, _val: string, _px: string, ms: number, _nx: string) {
      if (!Number.isInteger(ms) || ms <= 0) throw new Error("ERR invalid expire time in 'set' command")
      const exp = this.m.get(key)
      if (exp && exp > Date.now()) return null
      this.m.set(key, Date.now() + ms)
      return 'OK'
    }
  }

  function redisSeenStore(redis: FakeRedis): SeenStore {
    return {
      async claim(jti, retainUntilEpochSeconds) {
        const ttlMs = seenRetentionMs(retainUntilEpochSeconds)
        const res = await redis.set(`fs:seen:${jti}`, '1', 'PX', ttlMs, 'NX')
        return res === 'OK'
      },
    }
  }

  let key: Awaited<ReturnType<typeof makeKey>>
  beforeEach(async () => { key = await makeKey() })

  it('covers a first use and a replay inside the skew window', async () => {
    const t0 = 1_700_000_000_000
    Date.now = () => t0
    const iat = t0 / 1000
    const claims = await fillParamsHash(validClaims({ iat, nbf: iat, exp: iat + 60, jti: 'jti-redis' }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const client = clientWithJwks(key.jwk)
    const store = redisSeenStore(new FakeRedis())

    expect((await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store })).valid).toBe(true)

    const atExpPlus10 = (claims.exp + 10) * 1000
    Date.now = () => atExpPlus10
    // The old recipe (PX = exp*1000 - now) is non-positive here, which Redis rejects.
    expect(claims.exp * 1000 - atExpPlus10).toBeLessThanOrEqual(0)
    expect(seenRetentionMs(claims.exp + ARTIFACT_CLOCK_SKEW_SECONDS, atExpPlus10)).toBeGreaterThan(0)

    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store }))
      .toEqual({ valid: false, error: 'artifact_replayed' })

    // Legitimate first use of a different artifact whose own exp is 10s ago.
    const lateIat = Math.floor(atExpPlus10 / 1000)
    const late = await fillParamsHash(validClaims({
      iat: lateIat, nbf: lateIat, exp: lateIat + 60, jti: 'jti-late',
    }), EXPECTED)
    const lateToken = await mint(key.jwk, key.pair, late)
    Date.now = () => (late.exp + 10) * 1000
    expect((await client.verifyArtifact(lateToken, { expected: EXPECTED, seenStore: store })).valid).toBe(true)
  })

  it('stays a positive integer through the last millisecond of the acceptance window', () => {
    const exp = 1_700_000_060
    const retain = exp + ARTIFACT_CLOCK_SKEW_SECONDS
    const lastMs = retain * 1000 + 999
    const ttl = seenRetentionMs(retain, lastMs)
    expect(ttl).toBe(1)
    expect(Number.isInteger(seenRetentionMs(retain, exp * 1000))).toBe(true)
    expect(seenRetentionMs(Number.NaN, lastMs)).toBe(1)
  })
})

describe('required jti', () => {
  let key: Awaited<ReturnType<typeof makeKey>>
  beforeEach(async () => { key = await makeKey() })

  it('rejects an artifact with no jti and does not touch the seen store', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    delete (claims as any).jti
    const token = await mint(key.jwk, key.pair, claims)
    const claim = vi.fn(async () => true)
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, { expected: EXPECTED, seenStore: { claim } }))
      .toEqual({ valid: false, error: 'artifact_missing_jti' })
    expect(claim).not.toHaveBeenCalled()
  })

  it('rejects an empty jti', async () => {
    const claims = await fillParamsHash(validClaims({ jti: '' }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_missing_jti' })
  })
})

describe('tenant and audience', () => {
  let key: Awaited<ReturnType<typeof makeKey>>
  beforeEach(async () => { key = await makeKey() })

  it('rejects an artifact issued for a different tenant', async () => {
    const claims = await fillParamsHash(validClaims({ sub: 'tenant_B' }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const claim = vi.fn(async () => true)
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, {
      expected: EXPECTED, seenStore: { claim }, tenant: 'tenant_A',
    })).toEqual({ valid: false, error: 'artifact_tenant_mismatch' })
    expect(claim).not.toHaveBeenCalled()
  })

  it('rejects an artifact with no sub when a tenant is expected', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    delete (claims as any).sub
    const token = await mint(key.jwk, key.pair, claims)
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, {
      expected: EXPECTED, seenStore: new MemorySeenStore(), tenant: 'tenant_1',
    })).toEqual({ valid: false, error: 'artifact_tenant_mismatch' })
  })

  it('accepts a matching tenant and checks aud only when it is present', async () => {
    const claims = await fillParamsHash(validClaims({ sub: 'tenant_1' }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    expect((await clientWithJwks(key.jwk).verifyArtifact(token, {
      expected: EXPECTED, seenStore: new MemorySeenStore(), tenant: 'tenant_1',
    })).valid).toBe(true)

    const withAud = await fillParamsHash(validClaims({ sub: 'tenant_1', aud: 'tenant_1' }), EXPECTED)
    const audToken = await mint(key.jwk, key.pair, withAud)
    expect((await clientWithJwks(key.jwk).verifyArtifact(audToken, {
      expected: EXPECTED, seenStore: new MemorySeenStore(), tenant: 'tenant_1',
    })).valid).toBe(true)

    const withAudList = await fillParamsHash(validClaims({ sub: 'tenant_1', aud: ['other', 'tenant_1'] }), EXPECTED)
    const listToken = await mint(key.jwk, key.pair, withAudList)
    expect((await clientWithJwks(key.jwk).verifyArtifact(listToken, {
      expected: EXPECTED, seenStore: new MemorySeenStore(), tenant: 'tenant_1',
    })).valid).toBe(true)
  })

  it('rejects when aud is present and does not include the tenant', async () => {
    const claims = await fillParamsHash(validClaims({ sub: 'tenant_1', aud: 'someone_else' }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, {
      expected: EXPECTED, seenStore: new MemorySeenStore(), tenant: 'tenant_1',
    })).toEqual({ valid: false, error: 'artifact_audience_mismatch' })
  })

  it('does not check sub when tenant is omitted', async () => {
    const claims = await fillParamsHash(validClaims({ sub: 'tenant_B' }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    expect((await clientWithJwks(key.jwk).verifyArtifact(token, {
      expected: EXPECTED, seenStore: new MemorySeenStore(),
    })).valid).toBe(true)
  })
})

describe('maximum artifact lifetime', () => {
  let key: Awaited<ReturnType<typeof makeKey>>
  beforeEach(async () => { key = await makeKey() })

  it('rejects a lifetime above 300s and accepts exactly 300s', async () => {
    const iat = Math.floor(Date.now() / 1000)
    const tooLong = await fillParamsHash(validClaims({
      iat, nbf: iat, exp: iat + DEFAULT_MAX_ARTIFACT_LIFETIME_SECONDS + 1,
    }), EXPECTED)
    expect(await clientWithJwks(key.jwk).verifyArtifact(await mint(key.jwk, key.pair, tooLong), {
      expected: EXPECTED, seenStore: new MemorySeenStore(),
    })).toEqual({ valid: false, error: 'artifact_lifetime_exceeded' })

    const year = await fillParamsHash(validClaims({ iat, nbf: iat, exp: iat + 365 * 24 * 3600 }), EXPECTED)
    expect(await clientWithJwks(key.jwk).verifyArtifact(await mint(key.jwk, key.pair, year), {
      expected: EXPECTED, seenStore: new MemorySeenStore(),
    })).toEqual({ valid: false, error: 'artifact_lifetime_exceeded' })

    const capped = await fillParamsHash(validClaims({
      iat, nbf: iat, exp: iat + DEFAULT_MAX_ARTIFACT_LIFETIME_SECONDS,
    }), EXPECTED)
    expect((await clientWithJwks(key.jwk).verifyArtifact(await mint(key.jwk, key.pair, capped), {
      expected: EXPECTED, seenStore: new MemorySeenStore(),
    })).valid).toBe(true)
  })

  it('rejects a missing iat so the cap cannot be skipped', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    delete (claims as any).iat
    delete (claims as any).nbf
    const token = await mint(key.jwk, key.pair, claims)
    const claim = vi.fn(async () => true)
    expect(await clientWithJwks(key.jwk).verifyArtifact(token, { expected: EXPECTED, seenStore: { claim } }))
      .toEqual({ valid: false, error: 'artifact_lifetime_exceeded' })
    expect(claim).not.toHaveBeenCalled()
  })

  it('honors maxLifetimeSeconds for a self-hosted cap', async () => {
    const iat = Math.floor(Date.now() / 1000)
    const claims = await fillParamsHash(validClaims({ iat, nbf: iat, exp: iat + 60 }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const client = clientWithJwks(key.jwk)
    expect(await client.verifyArtifact(token, {
      expected: EXPECTED, seenStore: new MemorySeenStore(), maxLifetimeSeconds: 30,
    })).toEqual({ valid: false, error: 'artifact_lifetime_exceeded' })
    expect((await client.verifyArtifact(token, {
      expected: EXPECTED, seenStore: new MemorySeenStore(), maxLifetimeSeconds: 60,
    })).valid).toBe(true)
  })
})

describe('issuer', () => {
  let key: Awaited<ReturnType<typeof makeKey>>
  beforeEach(async () => { key = await makeKey() })

  it('accepts a self-hosted issuer and rejects the hosted issuer for that client', async () => {
    const selfHosted = 'https://fortsignal.internal'
    const claims = await fillParamsHash(validClaims({ iss: selfHosted }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const client = clientWithJwks(key.jwk, { issuer: selfHosted })
    expect((await client.verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() })).valid).toBe(true)

    const hosted = await fillParamsHash(validClaims(), EXPECTED)
    const hostedToken = await mint(key.jwk, key.pair, hosted)
    expect(await client.verifyArtifact(hostedToken, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_issuer_mismatch' })
  })

  it('keeps the hosted issuer when only baseUrl changes', async () => {
    const claims = await fillParamsHash(validClaims({ iss: 'https://fortsignal.internal' }), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const client = clientWithJwks(key.jwk, { baseUrl: 'https://fortsignal.internal' })
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_issuer_mismatch' })
  })
})

describe('JWKS refresh', () => {
  let key: Awaited<ReturnType<typeof makeKey>>
  beforeEach(async () => { key = await makeKey() })

  function signingJwk() {
    return { kty: 'OKP', crv: 'Ed25519', kid: key.jwk.kid, x: key.jwk.x, alg: 'EdDSA', use: 'sig' }
  }

  it('refetches once when the kid is unknown, then rate-limits', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const client = new FortSignal({ apiKey: 'fs_live_test', baseUrl: 'https://jwks.test' })
    const now = Date.now()
    ;(client as any).jwksState.cache = {
      keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'old-kid', x: 'AAAA', alg: 'EdDSA', use: 'sig' }],
      expiresAt: now + 60_000,
      fetchedAt: now - 60_000,
      attemptedAt: now - 60_000,
    }
    const fn = vi.fn().mockResolvedValue(jwksResponse([signingJwk()]))
    vi.stubGlobal('fetch', fn)

    expect((await client.verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() })).valid).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toBe('https://jwks.test/.well-known/fs-keys.json')

    const other = await makeKey()
    other.jwk.kid = 'fs-test-c'
    const claims2 = await fillParamsHash(validClaims(), EXPECTED)
    const token2 = await mint(other.jwk, other.pair, claims2)
    expect(await client.verifyArtifact(token2, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_unknown_kid' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('returns unknown_kid when the refetch still does not contain the kid', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const client = new FortSignal({ apiKey: 'fs_live_test', baseUrl: 'https://jwks.test' })
    const now = Date.now()
    ;(client as any).jwksState.cache = {
      keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'old-kid', x: 'AAAA', alg: 'EdDSA', use: 'sig' }],
      expiresAt: now + 60_000,
      fetchedAt: now - 60_000,
      attemptedAt: now - 60_000,
    }
    const fn = vi.fn().mockResolvedValue(jwksResponse([
      { kty: 'OKP', crv: 'Ed25519', kid: 'still-other', x: 'BBBB', alg: 'EdDSA', use: 'sig' },
    ]))
    vi.stubGlobal('fetch', fn)
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_unknown_kid' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('verifies with stale cached keys when the refresh fails, and does not hammer', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const client = clientWithJwks(key.jwk)
    const now = Date.now()
    const cache = (client as any).jwksState.cache
    cache.expiresAt = now - 1000
    cache.fetchedAt = now - 10 * 60 * 1000
    cache.attemptedAt = now - 10 * 60 * 1000
    const fn = vi.fn().mockResolvedValue(new Response('down', { status: 503 }))
    vi.stubGlobal('fetch', fn)

    const store = new MemorySeenStore()
    expect((await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store })).valid).toBe(true)
    // Second call still has the signing key (stale cache) and does not fetch again.
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: store }))
      .toEqual({ valid: false, error: 'artifact_replayed' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not serve cached keys older than the stale window when refresh fails', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const client = clientWithJwks(key.jwk)
    const now = Date.now()
    const cache = (client as any).jwksState.cache
    cache.expiresAt = now - 2 * 60 * 60 * 1000
    cache.fetchedAt = now - 2 * 60 * 60 * 1000
    cache.attemptedAt = now - 2 * 60 * 60 * 1000
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await client.verifyArtifact(token, { expected: EXPECTED, seenStore: new MemorySeenStore() }))
      .toEqual({ valid: false, error: 'artifact_keys_unavailable' })
  })

  it('rate-limits fetches when there is no cache and JWKS is down', async () => {
    const claims = await fillParamsHash(validClaims(), EXPECTED)
    const token = await mint(key.jwk, key.pair, claims)
    const client = new FortSignal({ apiKey: 'fs_live_test', baseUrl: 'https://jwks.test' })
    const fn = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fn)
    const opts = { expected: EXPECTED, seenStore: new MemorySeenStore() }
    expect(await client.verifyArtifact(token, opts)).toEqual({ valid: false, error: 'artifact_keys_unavailable' })
    expect(await client.verifyArtifact(token, opts)).toEqual({ valid: false, error: 'artifact_keys_unavailable' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent JWKS fetches', async () => {
    const tokenA = await mint(key.jwk, key.pair, await fillParamsHash(validClaims(), EXPECTED))
    const tokenB = await mint(key.jwk, key.pair, await fillParamsHash(validClaims(), EXPECTED))
    const client = new FortSignal({ apiKey: 'fs_live_test', baseUrl: 'https://jwks.test' })
    let release!: (response: Response) => void
    const gate = new Promise<Response>((resolve) => { release = resolve })
    const fn = vi.fn().mockReturnValue(gate)
    vi.stubGlobal('fetch', fn)

    const pendingA = client.verifyArtifact(tokenA, { expected: EXPECTED, seenStore: new MemorySeenStore() })
    const pendingB = client.verifyArtifact(tokenB, { expected: EXPECTED, seenStore: new MemorySeenStore() })
    release(jwksResponse([signingJwk()]))
    const [a, b] = await Promise.all([pendingA, pendingB])
    expect(a.valid).toBe(true)
    expect(b.valid).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
