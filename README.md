# @fortsignal/sdk

The official TypeScript SDK for [FortSignal](https://fortsignal.com) — You Approve the Action. We Enforce It.

Cryptographic authorization that binds every approval to the exact parameters that execute — for humans and AI agents.

**Full documentation:** [fortsignal.com/docs](https://fortsignal.com/docs)

## What it does

FortSignal verifies that the exact parameters a user or agent approved are the same parameters that execute. Every action gets a fresh hardware-signed approval — cryptographically bound to the action, amount, recipient, and any other fields you define.

### Three separate layers

**Action parameters** (`action`, `amount`, `recipient`, and optionally `from`, `metadata`) describe the specific action being requested. They are sent per-request and cryptographically signed — proof that the exact values were approved at that moment.

**Policy constraints** are separate. Policy profiles are persistent rules you configure once in your FortSignal dashboard and attach to users or agents. After the signature passes, FortSignal checks the action parameter values against those rules — `allowedActions`, `maxAmountPerAction`, `allowedRecipients`. A valid signature is not enough on its own; if the action violates any policy constraint, FortSignal returns `decision: deny`.

For agents there is a third layer: the delegation must be active and not expired. All three must pass — valid signature, active delegation, within policy — for the decision to be `allow`.

## Installation

```bash
npm install @fortsignal/sdk
```

**Human interaction required** — if humans approve actions via passkey in your app, install the WebAuthn browser library for your frontend:

```bash
npm install @simplewebauthn/browser
```

**Agent only (no human interaction)** — if agents act autonomously within their policy, no browser library is needed. Agents sign with an Ed25519 private key on the server — no WebAuthn, no browser, no additional dependencies.

## Get an API key

Sign up at [fortsignal.com/signup](https://fortsignal.com/signup). You'll get a `fs_live_...` key immediately after checkout.

---

## Human Flow

### Step 1 — Initialize the client (server-side)

```typescript
import { FortSignal } from '@fortsignal/sdk'

const client = new FortSignal({ apiKey: process.env.FORTSIGNAL_API_KEY })
```

### Step 2 — Register a user's passkey (one time per user)

Call this when the user sets up their account or enables high-security actions.

```typescript
// Server: start registration
const options = await client.register.start({
  userId: 'user_123',
  username: 'alice@example.com',
})

// Browser: prompt the user to create a passkey
import { startRegistration } from '@simplewebauthn/browser'
const attestation = await startRegistration({ optionsJSON: options })

// Server: complete registration
await client.register.complete({
  userId: 'user_123',
  challenge: options.challenge,
  attestation,
})
```

### Step 3 — Authorize an action

```typescript
// Server: start a challenge before the action executes
const options = await client.challenge.start({
  userId: 'user_123',
  action: 'transfer',
  amount: 500,              // optional — defaults to 0 for non-monetary actions
  recipient: 'bob@example.com',
  from: 'alice@example.com',
  metadata: { orderId: 'ord_123' }, // optional — must be a JSON object, not a string
})

// Browser: prompt the user to sign with their passkey
import { startAuthentication } from '@simplewebauthn/browser'
const assertion = await startAuthentication({ optionsJSON: options })

// Server: verify the signature
const result = await client.challenge.verify(assertion)

if (result.decision === 'allow') {
  // result.signalId — store this as your audit receipt
  await executeTransfer()
} else {
  // result.reason — why it was denied:
  // 'policy_expired' | 'action_not_allowed' | 'amount_exceeds_policy'
  // 'recipient_not_allowed' | 'parameters_tampered' | 'invalid_challenge'
  throw new Error(result.reason)
}
```

---

## Agent Flow

### Step 1 — Register an agent's public key (one time per agent)

Generate an Ed25519 keypair for your agent and register the public key.

```typescript
await client.agent.register({
  agentId: 'my-agent-01',
  publicKey: agentPublicKeyBase64url, // Ed25519 public key, base64url encoded
})
// Agent now appears in your dashboard — assign a policy before it can act
```

### Step 2 — Assign a policy (dashboard)

Go to your [FortSignal dashboard](https://fortsignal.com/dashboard) and assign a policy to the agent. The policy defines allowed actions, amount caps, and approved recipients. Set an expiry for the delegation.

> Policy assignment requires owner authentication and cannot be done via API key. This is intentional — a compromised API key cannot grant or revoke agent permissions.

### Step 3 — Verify each agent action

The agent starts a challenge, signs it with its Ed25519 private key, then submits the signature.

```typescript
// 1. Start a challenge — FortSignal checks delegation and policy before issuing it
const { challenge } = await client.agent.startChallenge({
  agentId: 'my-agent-01',
  action: 'transfer',
  amount: 250,
  recipient: 'acct_456',
})

// 2. Sign the challenge bytes with your agent's Ed25519 private key
const challengeBytes = Buffer.from(challenge, 'base64url')
const sigBytes = await crypto.subtle.sign('Ed25519', privateKey, challengeBytes)
const signature = Buffer.from(sigBytes).toString('base64url')

// 3. Verify
const result = await client.agent.verify({
  agentId: 'my-agent-01',
  challenge,
  signature,
})

if (result.decision === 'allow') {
  // result.signalId — audit receipt
  // result.delegationId — traces back to the human who approved this agent
  await executeAction()
} else {
  // result.reason — why it was denied:
  // 'delegation_invalid' | 'policy_expired' | 'action_not_allowed'
  // 'amount_exceeds_policy' | 'recipient_not_allowed' | 'verification_failed'
}
```

---

## Error Handling

**Deny decisions** are not errors — they come back in the response body with `decision: 'deny'`:

```typescript
const result = await client.challenge.verify(assertion)

if (result.decision === 'deny') {
  // result.reason — why it was denied
  console.error(result.reason)
}
```

**HTTP errors** (bad API key, rate limit, server error) throw a `FortSignalError`:

```typescript
import { FortSignal, FortSignalError } from '@fortsignal/sdk'

try {
  const result = await client.challenge.start({ ... })
} catch (err) {
  if (err instanceof FortSignalError) {
    console.error(err.code)   // e.g. 'invalid_api_key'
    console.error(err.status) // e.g. 401
  }
}
```

---

## API Reference

### `client.register`
| Method | Description |
|--------|-------------|
| `register.start({ userId, username })` | Begin passkey registration |
| `register.complete({ userId, challenge, attestation })` | Complete passkey registration |

### `client.challenge`
| Method | Description |
|--------|-------------|
| `challenge.start({ userId, action, amount?, recipient, from?, metadata?, requireBiometric? })` | Start a challenge. `amount` defaults to `0` if omitted — safe to omit for non-monetary actions. |
| `challenge.verify(assertion)` | Verify the signed assertion |

### `client.agent`
| Method | Description |
|--------|-------------|
| `agent.register({ agentId, publicKey })` | Register an agent's Ed25519 public key |
| `agent.startChallenge({ agentId, action, amount?, recipient, from?, metadata? })` | Start a challenge for an agent action. `amount` defaults to `0` if omitted. |
| `agent.verify({ agentId, challenge, signature })` | Submit the signed challenge |

---

## Requirements

- Node.js 18+
- An API key from [fortsignal.com](https://fortsignal.com)

## Full Documentation

[fortsignal.com/docs](https://fortsignal.com/docs)
