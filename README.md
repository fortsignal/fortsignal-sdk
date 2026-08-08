
# @fortsignal/sdk

TypeScript client for [FortSignal](https://fortsignal.com) — execution governance infrastructure. Cryptographic authorization before execution, deterministic policy enforcement, delegation-backed agent boundaries.

FortSignal hashes your action fields (`action`, `amount`, `recipient`, `source`, `metadata`) and has the device or agent sign that hash. Any change after approval → verification fails.

**Intent fields:**
- `action` — what the agent/user is doing (`transfer`, `approve`, `deploy`)
- `amount` — value involved, optional (default 0)
- `recipient` — who receives (`acct_456`, `vendor_portal`)
- `source` — optional context about where the request originates (`production-cluster`, `payment-service`, `us-east-1`). Not agent identity — that's proven by Ed25519 passport + delegation. Used with `allowedFromSources` policy constraint.
- `metadata` — arbitrary key-value context (`{ platform: 'ACH', env: 'production' }`). Used with `requiredMetadata` policy constraint.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![npm](https://img.shields.io/badge/npm-latest-orange)](https://www.npmjs.com/package/@fortsignal/sdk)

---

## Before you start

Get an API key at [fortsignal.com/signup](https://fortsignal.com/signup) — free tier: enter your email, click the verification link we send you, and your key is shown once at claim (also later in Dashboard → **API Keys**). Your key starts with `fs_live_`.

For agents: register the public key below, then approve a delegation in the [dashboard](https://www.fortsignal.com/login) — `challenge/start` and `verify` return `delegation_invalid` until a delegation is active.

---

## Install

```bash
npm install @fortsignal/sdk

# For humans (WebAuthn in browser)
npm install @simplewebauthn/browser
```

---

## Humans (passkey / WebAuthn)

```ts
// server
import { FortSignal } from '@fortsignal/sdk'
const client = new FortSignal({ apiKey: process.env.FORTSIGNAL_API_KEY! })
```

**Register once**

```ts
// server → send options to browser
const options = await client.register.start({ userId: 'user_123' })

// browser
import { startRegistration } from '@simplewebauthn/browser'
const registrationJSON = await startRegistration({ optionsJSON: options })

// server
await client.register.complete(registrationJSON)
```

**Every sensitive action**

```ts
// server → send options to browser
const options = await client.challenge.start({
  userId: 'user_123',
  action: 'transfer',
  amount: 500,
  recipient: 'bob@example.com',
  source: 'payment-service',       // optional — matches allowedFromSources policy constraint
  metadata: { orderId: 'ord_123' }, // optional — matches requiredMetadata policy constraint
})

// browser
import { startAuthentication } from '@simplewebauthn/browser'
const assertion = await startAuthentication({ optionsJSON: options })

// server
const result = await client.challenge.verify(assertion)

if (result.decision === 'allow') {
  // result.signalId — store as receipt, then execute the action
} else {
  // result.reason — e.g. parameters_tampered, policy_*, invalid_challenge
}
```

---

## Agents (Ed25519 signing)

**Register** (or use the dashboard):

```typescript
// Multi-sig teams: gate execution on delegation status before running.
// Accepts an agentId, delegationId (del_…), or proposalId (prop_…).
const del = await client.agent.delegationStatus('agent-01')
if (del.status === 'ACTIVE') {
  // run agent
} else if (del.status === 'PENDING_APPROVAL') {
  // pause / notify — waiting on signer approvals (del.signed of del.required)
}
// 'NONE' — no active or pending delegation for this id (404 maps to NONE, never throws)
```

```ts
// server
await client.agent.register({
  agentId: 'my-agent-01',
  publicKey: agentPublicKeyBase64url,
})
```

Then approve a delegation in the [dashboard](https://www.fortsignal.com/login) before running actions.

**Every action:**

```ts
// server
const startData = await client.agent.startChallenge({
  agentId: 'my-agent-01',
  action: 'transfer',
  amount: 250,
  recipient: 'acct_456',
})

if (startData.decision === 'deny') {
  // startData.reason — e.g. delegation_invalid, policy_*, agent_not_found
  return
}

const { challenge } = startData

const sigBytes = await crypto.subtle.sign('Ed25519', privateKey, Buffer.from(challenge, 'base64url'))
const signature = Buffer.from(sigBytes).toString('base64url')

const result = await client.agent.verify({ agentId: 'my-agent-01', challenge, signature })

if (result.decision === 'allow') {
  // result.signalId — execute the action
} else {
  // result.reason
}
```

---

## Verifying execution artifacts

Every `allow` from `challenge.verify()` / `agent.verify()` returns an `artifact` — an Ed25519-signed JWT proving FortSignal verified those exact parameters under this policy/delegation. Denies never carry one: **absence of an artifact IS the deny.** In rare failure cases an `allow` may be returned without an `artifact` field (artifact emission fails open so a signing error never blocks a legitimate allow) — executors must treat a missing artifact exactly like a deny. Executors verify it offline before acting:

```ts
const verdict = await client.verifyArtifact(result.artifact, {
  expected: { action, recipient, amount, source, metadata },
  seenStore: redisSeenStore,   // SET NX PX — see below
})
if (!verdict.valid) throw new Error(`Not authorized: ${verdict.error}`)
await execute(action)
```

**One-shot guarantee.** Replay protection is mandatory — `verifyArtifact` throws without a `seenStore`. Each artifact `jti` can be claimed exactly once; a second verifier gets `{ valid: false, error: 'artifact_replayed' }`.

**`MemorySeenStore` is single-process only** — fine for dev, never for production. Multi-instance executors MUST use a shared store; the production pattern is Redis `SET fs:seen:{jti} 1 NX PX {ttlMs}` (the claim succeeds only when the command returns OK). The `SeenStore` interface is exported for exactly this:

```ts
import { MemorySeenStore } from '@fortsignal/sdk'   // dev / single-process only
import type { SeenStore } from '@fortsignal/sdk'    // implement over Redis for production

const seenStore: SeenStore = {
  async claim(jti, expEpochSeconds) {
    const ttlMs = expEpochSeconds * 1000 - Date.now()
    const res = await redis.set(`fs:seen:${jti}`, '1', 'PX', ttlMs, 'NX')
    return res === 'OK'
  },
}
```

For high-value actions, add the consume step — `POST /artifact/consume` re-checks revocation at consume time and guarantees one-shot even against the seen-store window. Full spec (canonicalization, golden vector, all eleven error codes) → [api.fortsignal.com/docs#execution-artifacts](https://api.fortsignal.com/docs#execution-artifacts)

---

## Errors

- `decision: 'deny'` is a normal response — check `result.reason`
- Real failures throw `FortSignalError` (with `err.code` and `err.status`)

---

## Behavior contract (2026-07 API hardening)

Three API behaviors you must code against:

**1. Registration is never idempotent.** Re-registering a user who already has a passkey fails — `register.start()` without `rotate` returns 409, and `register.complete()` throws `FortSignalError` with `code: 'credential_exists'`. Treat that as "already registered → verify." For lost devices, rotate explicitly:

```typescript
// Lost-device recovery — replaces the existing passkey (audit-logged)
const options = await client.register.start({ userId: 'alice', rotate: true })
```

**2. Challenges are single-use on ANY verify attempt.** A challenge is consumed on the first `verify()` call regardless of outcome — allow, failed signature, policy deny, or quota. Any second call with the same payload returns `deny: invalid_challenge`, immediately and everywhere. On `invalid_challenge`, always start a fresh ceremony:

```typescript
let result = await client.challenge.verify(assertion)
if (result.decision === 'deny' && result.reason === 'invalid_challenge') {
  // Never retry the same payload — start over
  const fresh = await client.challenge.start(params)
  // ...collect a new signature, then verify
}
```

Do not add retry logic around `verify()` — retries cannot succeed.

**3. Re-registering an agent invalidates its delegation.** Call `agent.register()` once at provisioning, not on every service boot. Check the response:

```typescript
const res = await client.agent.register({ agentId, publicKey })
if (res.delegationInvalidated) {
  // Human must re-approve delegation in the dashboard before the agent can act
  console.error('Agent delegation invalidated — re-delegate at fortsignal.com/dashboard')
}
```

**Also note:** user-verification (biometric) strength is decided by your server-side policy. The `requireBiometric` param on `challenge.start()` can upgrade a ceremony to required, but a policy that requires biometric always enforces it — the client cannot downgrade.

**Quota meters decisions, not just approvals.** Every governed decision counts against your monthly quota — allows **and** policy blocks (a block is a delivered verification with an audit receipt). Failed signatures and `invalid_challenge` replays are always free. At the cap, `quota_exceeded` takes precedence over policy deny reasons.

---

## API Surface

| Namespace          | Key Methods                                  |
|--------------------|----------------------------------------------|
| `client.register`  | `start()`, `complete()`                      |
| `client.challenge` | `start()`, `verify()`                        |
| `client.signal`    | `get(signalId)`                              |
| `client.agent`     | `register()`, `startChallenge()`, `verify()`, `delegationStatus(id)` |
| `client.verifyArtifact` | `verifyArtifact(artifact, options)` — offline artifact verification |

Full detail → [api.fortsignal.com/docs](https://api.fortsignal.com/docs)
Enterprise integration guide → [ENTERPRISE.md](ENTERPRISE.md)

---

## Requirements

- Node.js 18+
- TypeScript 5.x (optional)

---

---

## Publishing (maintainers)

**README or docs change only** — push to GitHub, do not publish to npm:
```bash
git commit -m "Update README"
git push
```

**Code change** — bump version, tag, then publish:
```bash
npm version patch        # bumps package.json + creates git tag automatically
git push && git push --tags
npm publish
```

Never run `npm publish` for README-only changes. The npm version must reflect actual SDK code changes only.

---

**License**  
MIT © FortSignal
