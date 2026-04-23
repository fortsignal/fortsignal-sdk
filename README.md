# @fortsignal/sdk

The official TypeScript SDK for [FortSignal](https://fortsignal.com) — intent verification infrastructure for agents and human-authorized actions.

**Full documentation:** [fortsignal.com/docs](https://fortsignal.com/docs)

## What it does

FortSignal verifies that the exact parameters a user or agent approved are the same parameters that execute. Every sensitive action gets a fresh hardware-signed approval — cryptographically bound to the action, amount, recipient, and any other fields you define.

## Installation

```bash
npm install @fortsignal/sdk
```

You'll also need the WebAuthn browser library for your frontend:

```bash
npm install @simplewebauthn/browser
```

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
  publicKey: agentPublicKeyBase64,
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

All API errors throw a `FortSignalError` with a `status` (HTTP code) and `code` (machine-readable reason).

```typescript
import { FortSignal, FortSignalError } from '@fortsignal/sdk'

try {
  const result = await client.challenge.verify({ challengeId, assertion })
} catch (err) {
  if (err instanceof FortSignalError) {
    console.error(err.code)   // e.g. 'invalid_challenge'
    console.error(err.status) // e.g. 400
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
| `agent.register({ publicKey })` | Register an agent's Ed25519 public key |
| `agent.verify({ delegationId, action, amount, recipient, signature, nonce })` | Verify an agent-signed action |

---

## Requirements

- Node.js 18+
- An API key from [fortsignal.com](https://fortsignal.com)

## Full Documentation

[fortsignal.com/docs](https://fortsignal.com/docs)
