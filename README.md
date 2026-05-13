
# @fortsignal/sdk

TypeScript client for [FortSignal](https://fortsignal.com) — execution governance infrastructure. Cryptographic authorization before execution, deterministic policy enforcement, delegation-backed agent boundaries.

FortSignal hashes your action fields (`action`, `amount`, `recipient`, …) and has the device or agent sign that hash. Any change after approval → verification fails.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![npm](https://img.shields.io/badge/npm-latest-orange)](https://www.npmjs.com/package/@fortsignal/sdk)

---

## Before you start

Get an API key at [fortsignal.com/signup](https://fortsignal.com/signup) → Dashboard → **API Keys**. Your key starts with `fs_live_`.

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
  from: 'alice@example.com',
  metadata: { orderId: 'ord_123' },
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

## Errors

- `decision: 'deny'` is a normal response — check `result.reason`
- Real failures throw `FortSignalError` (with `err.code` and `err.status`)

---

## API Surface

| Namespace          | Key Methods                                  |
|--------------------|----------------------------------------------|
| `client.register`  | `start()`, `complete()`                      |
| `client.challenge` | `start()`, `verify()`                        |
| `client.signal`    | `get(signalId)`                              |
| `client.agent`     | `register()`, `startChallenge()`, `verify()` |

Full detail → [api.fortsignal.com/docs](https://api.fortsignal.com/docs)

---

## Requirements

- Node.js 18+
- TypeScript 5.x (optional)

---

**License**  
MIT © FortSignal
