# @fortsignal/sdk

The official TypeScript SDK for [FortSignal](https://fortsignal.com) — intent verification infrastructure for agents and human-authorized actions.

**Full documentation:** [fortsignal.com/docs](https://fortsignal.com/docs)

## What it does

FortSignal verifies that the exact parameters a user or agent approved are the same parameters that execute. Every sensitive action gets a fresh hardware-signed approval — cryptographically bound to the action, amount, recipient, and any other fields you define.

## Installation

```bash
npm install @fortsignal/sdk
```

**Human flow only** — if you are verifying human actions via passkey, also install the WebAuthn browser library for your frontend:

```bash
npm install @simplewebauthn/browser
```

**Agent flow only** — no browser library needed. Agents sign with an Ed25519 private key on the server. No WebAuthn, no browser interaction, no additional dependencies.

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

### Step 3 — Require approval before a sensitive action

```typescript
// Server: start a challenge before the action executes
const { challengeId, challenge } = await client.challenge.start({
  userId: 'user_123',
  action: 'transfer',
  amount: 500,
  recipient: 'bob@example.com',
  from: 'alice@example.com',
  metadata: { orderId: 'ord_123' }, // optional — any JSON object
})

// Browser: prompt the user to sign with their passkey
import { startAuthentication } from '@simplewebauthn/browser'
const assertion = await startAuthentication({ optionsJSON: { challenge, ... } })

// Server: verify the signature
const result = await client.challenge.verify({ challengeId, assertion })

if (result.allowed) {
  // result.signalId — store this as your audit receipt
  await executeTransfer()
} else {
  // result.reason — why it was denied
  // 'policy_expired' | 'action_not_allowed' | 'amount_exceeds_policy'
  // 'recipient_not_allowed' | 'biometric_required' | 'parameters_tampered'
  throw new Error(result.reason)
}
```

---

## Agent Flow

### Step 1 — Register an agent's public key (one time per agent)

Generate an Ed25519 keypair for your agent and register the public key.

```typescript
const { agentId } = await client.agent.register({
  agentId: 'my-agent-01',        // your identifier — alphanumeric, dash, underscore, max 64 chars
  publicKey: agentPublicKeyBase64, // Ed25519 public key, base64url encoded
})
// Store agentId — you'll need it to issue a delegation from the dashboard
```

### Step 2 — Issue a delegation (dashboard)

Go to your [FortSignal dashboard](https://fortsignal.com/dashboard) and issue a delegation for the agent. Set the scope — allowed actions, max amount per action, allowed recipients, and expiry. Copy the `delegationId` and store it with your agent.

> Delegation management requires owner authentication and cannot be done via API key. This is intentional — a compromised API key cannot grant or revoke agent permissions.

### Step 3 — Verify each agent action

The agent signs a nonce with its Ed25519 private key before each action.

```typescript
const result = await client.agent.verify({
  delegationId: 'del_abc123',
  action: 'transfer',
  amount: 250,
  recipient: 'acct_456',
  signature: agentSignature,  // Ed25519 signature over the nonce
  nonce: challengeNonce,
})

if (result.allowed) {
  // result.signalId — audit receipt
  await executeAction()
} else {
  // result.reason — scope exceeded, delegation expired, signature invalid, etc.
}
```

---

## Error Handling

**Deny decisions** are not errors — they come back in the response body:

```typescript
const result = await client.challenge.verify({ challengeId, assertion })

if (!result.allowed) {
  // result.reason — why it was denied:
  // 'policy_expired' | 'action_not_allowed' | 'amount_exceeds_policy'
  // 'recipient_not_allowed' | 'biometric_required' | 'parameters_tampered'
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
| `challenge.start({ userId, action, amount, recipient, from, metadata? })` | Start a challenge |
| `challenge.verify({ challengeId, assertion })` | Verify the signed assertion |

### `client.agent`
| Method | Description |
|--------|-------------|
| `agent.register({ agentId, publicKey })` | Register an agent's Ed25519 public key |
| `agent.verify({ delegationId, action, amount, recipient, signature, nonce })` | Verify an agent-signed action |

---

## Requirements

- Node.js 18+
- An API key from [fortsignal.com](https://fortsignal.com)

## Full Documentation

[fortsignal.com/docs](https://fortsignal.com/docs)
