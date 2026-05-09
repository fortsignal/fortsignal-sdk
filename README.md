# @fortsignal/sdk

TypeScript client for **[FortSignal](https://fortsignal.com)** — register passkeys, run intent-bound challenges, verify humans or agents. Same API as **[api.fortsignal.com](https://api.fortsignal.com)**.

[Docs](https://api.fortsignal.com/docs) · [Demo](https://api.fortsignal.com/demo) · [API repo](https://github.com/fortsignal/fortsignal-api)

FortSignal hashes your action fields (`action`, `amount`, `recipient`, …) and has the device or agent sign that hash. Change anything after approval → verification fails. Optional dashboard policies and agent delegations apply when you set them up.

```
challenge = SHA-256(nonce : action : amount : recipient : from : metadata)
```

---

## Install

```bash
npm install @fortsignal/sdk
```

Humans need WebAuthn in the browser:

```bash
npm install @simplewebauthn/browser
```

Agents sign with Ed25519 on the server only — no extra SDK beyond this package.

Get a key after signup: [fortsignal.com/signup](https://fortsignal.com/signup) → `fs_live_...`

---

## Humans

```typescript
import { FortSignal } from '@fortsignal/sdk'

const client = new FortSignal({ apiKey: process.env.FORTSIGNAL_API_KEY! })
```

**Register once** (server starts options → browser creates passkey → server completes):

```typescript
const options = await client.register.start({
  userId: 'user_123',
  saveMode: 'passwords', // optional
})

import { startRegistration } from '@simplewebauthn/browser'
const registrationJSON = await startRegistration({ optionsJSON: options })

await client.register.complete(registrationJSON)
```

**Each sensitive action:**

```typescript
const options = await client.challenge.start({
  userId: 'user_123',
  action: 'transfer',
  amount: 500,
  recipient: 'bob@example.com',
  from: 'alice@example.com',
  metadata: { orderId: 'ord_123' },
})

import { startAuthentication } from '@simplewebauthn/browser'
const assertion = await startAuthentication({ optionsJSON: options })

const result = await client.challenge.verify(assertion)

if (result.decision === 'allow') {
  // result.signalId — log as receipt
} else {
  // result.reason — e.g. parameters_tampered, invalid_challenge, policy_*, …
}
```

**Optional:** if you only get a `signalId` back from the client, confirm it server-side:

```typescript
const stored = await client.signal.get(signalIdFromClient)
```

Throws `FortSignalError` for HTTP failures (`err.code`, `err.status`). Missing or wrong-tenant signals → `signal_not_found`; bad UUID → `invalid_signal_id`.

---

## Agents

**Two ways to register an agent:**

- **Dashboard (recommended):** Open [Agent Passports](https://fortsignal.com/dashboard) → **+ New Agent Passport**. Your browser generates the Ed25519 keypair — download the private key, then approve a delegation with your passkey. No code needed for setup.
- **API (code-first):** Generate an Ed25519 keypair on your server and register the public key:

```typescript
await client.agent.register({
  agentId: ‘my-agent-01’,
  publicKey: agentPublicKeyBase64url,
})
```

Approve policy + delegation in the [dashboard](https://fortsignal.com/dashboard) (not available via API key — by design).

**Each action:**

```typescript
const { challenge } = await client.agent.startChallenge({
  agentId: 'my-agent-01',
  action: 'transfer',
  amount: 250,
  recipient: 'acct_456',
})

const challengeBytes = Buffer.from(challenge, 'base64url')
const sigBytes = await crypto.subtle.sign('Ed25519', privateKey, challengeBytes)
const signature = Buffer.from(sigBytes).toString('base64url')

const result = await client.agent.verify({
  agentId: 'my-agent-01',
  challenge,
  signature,
})
```

---

## Errors

`decision: 'deny'` is a normal response — check `result.reason`.

Auth, rate limits, and real HTTP failures throw **`FortSignalError`**:

```typescript
import { FortSignalError } from '@fortsignal/sdk'

try {
  await client.challenge.start({ ... })
} catch (err) {
  if (err instanceof FortSignalError) {
    console.error(err.code, err.status)
  }
}
```

---

## API surface

| Namespace | Methods |
|-----------|---------|
| `client.register` | `start({ userId, saveMode? })`, `complete(registrationJSON)` |
| `client.challenge` | `start(...)`, `verify(assertion)` |
| `client.signal` | `get(signalId)` |
| `client.agent` | `register(...)`, `startChallenge({ ..., delegationId? })`, `verify(...)` |

Dashboard-only (session auth, not API key): `POST /agent/delegate`, `POST /agent/revoke`, `GET /agent/list`.

Full detail: **[api.fortsignal.com/docs](https://api.fortsignal.com/docs)**

---

## Requirements

Node.js 18+

---

## License

MIT
