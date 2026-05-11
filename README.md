# @fortsignal/sdk


**TypeScript client for FortSignal** — register passkeys, run intent-bound challenges, and verify humans or agents.

The SDK gives you the same API as `api.fortsignal.com`.  
FortSignal hashes your action fields (`action`, `amount`, `recipient`, …) and has the device or agent sign that hash. Any change after approval → verification fails.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)

---

## Install

```bash
npm install @fortsignal/sdk
For humans (WebAuthn in browser):
Bashnpm install @simplewebauthn/browser

Quick Start
Humans (passkey / WebAuthn)
TypeScriptimport { FortSignal } from '@fortsignal/sdk'

const client = new FortSignal({ apiKey: process.env.FORTSIGNAL_API_KEY! })
Register once:
TypeScriptconst options = await client.register.start({ userId: 'user_123' })
const registrationJSON = await startRegistration({ optionsJSON: options })
await client.register.complete(registrationJSON)
Every sensitive action:
TypeScriptconst options = await client.challenge.start({
  userId: 'user_123',
  action: 'transfer',
  amount: 500,
  recipient: 'bob@example.com',
  from: 'alice@example.com',
  metadata: { orderId: 'ord_123' },
})

const assertion = await startAuthentication({ optionsJSON: options })
const result = await client.challenge.verify(assertion)

if (result.decision === 'allow') {
  console.log('✅ Allowed – signalId:', result.signalId)
} else {
  console.log('❌ Denied – reason:', result.reason)
}
Agents (Ed25519 signing)
Register via Dashboard (recommended) → Agent Passports → download key.
Or via API:
TypeScriptawait client.agent.register({
  agentId: 'my-agent-01',
  publicKey: agentPublicKeyBase64url,
})
Sign & verify:
TypeScriptconst { challenge } = await client.agent.startChallenge({
  agentId: 'my-agent-01',
  action: 'transfer',
  amount: 250,
  recipient: 'acct_456',
})

const sigBytes = await crypto.subtle.sign('Ed25519', privateKey, Buffer.from(challenge, 'base64url'))
const signature = Buffer.from(sigBytes).toString('base64url')

const result = await client.agent.verify({ agentId: 'my-agent-01', challenge, signature })

Errors

decision: 'deny' is a normal response — check result.reason
Real failures throw FortSignalError (with err.code and err.status)


API Surface

Namespace,Key Methods
client.register,"start(), complete()"
client.challenge,"start(), verify()"
client.signal,get(signalId)
client.agent,"register(), startChallenge(), verify()"

Full detail → api.fortsignal.com/docs

Requirements

Node.js 18+
TypeScript 5.x (optional)


Made with ❤️ by the FortSignal team
fortsignal.com · Dashboard

MIT
