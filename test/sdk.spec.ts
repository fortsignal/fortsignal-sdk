import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FortSignal, FortSignalError } from '../src/index'

const API_KEY = 'fs_test_sdk'
const BASE = 'https://api.fortsignal.com'

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('request contract', () => {
  it('sends the API key as a bearer token and JSON body', async () => {
    const fn = mockFetchOnce(200, { status: 'registered', userId: 'u1' })
    const fs = new FortSignal({ apiKey: API_KEY })
    await fs.register.complete({ id: 'x' })

    const [url, init] = fn.mock.calls[0]
    expect(url).toBe(`${BASE}/register/complete`)
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`)
    expect(init.method).toBe('POST')
  })

  it('maps API errors to FortSignalError with status and code', async () => {
    mockFetchOnce(409, { error: 'credential_exists' })
    const fs = new FortSignal({ apiKey: API_KEY })

    const err = await fs.register.complete({ id: 'x' }).catch(e => e)
    expect(err).toBeInstanceOf(FortSignalError)
    expect(err.status).toBe(409)
    expect(err.code).toBe('credential_exists')
  })
})

// ── 2026-07 behavior contract (A12) ──

describe('register.start — rotation support (A3)', () => {
  it('passes rotate: true through to /register/start', async () => {
    const fn = mockFetchOnce(200, { challenge: 'abc' })
    const fs = new FortSignal({ apiKey: API_KEY })
    await fs.register.start({ userId: 'u1', rotate: true })

    const [, init] = fn.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ userId: 'u1', rotate: true })
  })

  it('omits rotate when not requested', async () => {
    const fn = mockFetchOnce(200, { challenge: 'abc' })
    const fs = new FortSignal({ apiKey: API_KEY })
    await fs.register.start({ userId: 'u1' })

    const [, init] = fn.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ userId: 'u1' })
  })
})

describe('agent.register — delegationInvalidated visibility (F-11)', () => {
  it('exposes delegationInvalidated from the API response', async () => {
    mockFetchOnce(200, {
      status: 'registered',
      agentId: 'a1',
      registeredAt: '2026-07-31T00:00:00Z',
      delegationInvalidated: true,
    })
    const fs = new FortSignal({ apiKey: API_KEY })
    const res = await fs.agent.register({ agentId: 'a1', publicKey: 'pk' })

    expect(res.delegationInvalidated).toBe(true)
  })
})

describe('agent.delegationStatus — multi-sig polling (M-of-N)', () => {
  it('GETs the status endpoint with the bearer token', async () => {
    const fn = mockFetchOnce(200, { delegationId: 'del_1', status: 'ACTIVE', expiresAt: '2026-08-09T00:00:00Z' })
    const fs = new FortSignal({ apiKey: API_KEY })
    const res = await fs.agent.delegationStatus('test111')

    const [url, init] = fn.mock.calls[0]
    expect(url).toBe(`${BASE}/agent/delegation/test111/status`)
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`)
    expect(res.status).toBe('ACTIVE')
    expect(res.delegationId).toBe('del_1')
  })

  it('returns signed/required counts for a pending proposal', async () => {
    mockFetchOnce(200, { proposalId: 'prop_1', status: 'PENDING_APPROVAL', signed: 1, required: 3 })
    const fs = new FortSignal({ apiKey: API_KEY })
    const res = await fs.agent.delegationStatus('prop_1')

    expect(res.status).toBe('PENDING_APPROVAL')
    expect(res.signed).toBe(1)
    expect(res.required).toBe(3)
  })

  it('maps the API 404 to a NONE status instead of throwing', async () => {
    mockFetchOnce(404, { status: 'NONE' })
    const fs = new FortSignal({ apiKey: API_KEY })
    const res = await fs.agent.delegationStatus('del_nonexistent')

    expect(res.status).toBe('NONE')
  })
})
