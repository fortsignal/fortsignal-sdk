import { describe, it, expect, beforeEach } from 'vitest'
import { FortSignal, MemorySeenStore } from '../src/index'

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
async function fillParamsHash(claims: any, expected: any) {
  const metadataStr = expected.metadata ? JSON.stringify(expected.metadata) : ''
  const payload = `${claims.fs.intentNonce}:${expected.action}:${String(expected.amount ?? 0)}:${expected.recipient}:${expected.source ?? ''}:${metadataStr}`
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  claims.fs.paramsHash = b64u(new Uint8Array(hash))
  return claims
}

const EXPECTED = { action: 'execute', recipient: 'cmd:git status', amount: 0 }

function clientWithJwks(jwk: any) {
  const client = new FortSignal({ apiKey: 'fs_live_test', baseUrl: 'http://localhost:9' })
  ;(client as any).jwksCache = {
    keys: [{ kty: 'OKP', crv: 'Ed25519', kid: jwk.kid, x: jwk.x, alg: 'EdDSA', use: 'sig' }],
    expiresAt: Date.now() + 60_000,
  }
  return client
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
