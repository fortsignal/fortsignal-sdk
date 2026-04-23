# @fortsignal/sdk

The official TypeScript SDK for [FortSignal](https://fortsignal.com) — intent verification infrastructure for AI agents and human-authorized actions.

## Installation

```bash
npm install @fortsignal/sdk
```

## Quick Start

```typescript
import { FortSignal } from '@fortsignal/sdk'

const client = new FortSignal({ apiKey: 'fs_live_...' })
```

## Human Flow

Register a user's passkey once, then require a fresh signature for every sensitive action.

```typescript
// 1. Register a user's passkey (one time)
const options = await client.register.start({ userId: 'user_123', username: 'alice@example.com' })
// Pass options to navigator.credentials.create() in the browser
const attestation = await navigator.credentials.create({ publicKey: options })
await client.register.complete({ userId: 'user_123', challenge: options.challenge, attestation })

// 2. Require approval for a sensitive action
const { challengeId, challenge } = await client.challenge.start({
  userId: 'user_123',
  action: 'transfer',
  amount: 500,
  recipient: 'bob@example.com',
  from: 'alice@example.com',
})
// Pass challenge to navigator.credentials.get() in the browser
const assertion = await navigator.credentials.get({ publicKey: { challenge, ... } })

// 3. Verify the signature
const result = await client.challenge.verify({ challengeId, assertion })
if (result.allowed) {
  // Execute the action — result.signalId is your audit receipt
} else {
  // Denied — result.reason explains why
}
```

## Agent Flow

Register an AI agent, issue a scoped delegation, and verify every action it takes.

```typescript
// 1. Register the agent
const { agentId } = await client.agent.register({ publicKey: agentPublicKey })

// 2. Issue a delegation with scope constraints
const { delegationId } = await client.agent.delegate({
  agentId,
  scope: {
    actions: ['transfer', 'payment'],
    maxAmountPerAction: 1000,
    recipients: ['bob@example.com'],
    expiresAt: '2026-12-31T00:00:00Z',
  },
})

// 3. Verify each agent action (agent signs the challenge with its private key)
const result = await client.agent.verify({
  delegationId,
  action: 'transfer',
  amount: 500,
  recipient: 'bob@example.com',
  signature: agentSignature,
  nonce: challengeNonce,
})

if (result.allowed) {
  // Execute — result.signalId is your audit receipt
}
```

## Error Handling

```typescript
import { FortSignal, FortSignalError } from '@fortsignal/sdk'

try {
  const result = await client.challenge.verify({ challengeId, assertion })
} catch (err) {
  if (err instanceof FortSignalError) {
    console.error(err.code)   // e.g. 'policy_expired'
    console.error(err.status) // HTTP status
  }
}
```

## API Reference

### `client.register`
| Method | Description |
|--------|-------------|
| `register.start(params)` | Begin passkey registration for a user |
| `register.complete(params)` | Complete passkey registration |

### `client.challenge`
| Method | Description |
|--------|-------------|
| `challenge.start(params)` | Start a challenge for a human action |
| `challenge.verify(params)` | Verify the signed assertion |

### `client.agent`
| Method | Description |
|--------|-------------|
| `agent.register(params)` | Register an AI agent's public key |
| `agent.delegate(params)` | Issue a scoped delegation to an agent |
| `agent.verify(params)` | Verify an agent-signed action |
| `agent.revoke(params)` | Revoke a delegation |
| `agent.list()` | List all registered agents and delegations |

## Requirements

- Node.js 18+
- An API key from [fortsignal.com](https://fortsignal.com)
