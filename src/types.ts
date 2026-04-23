export interface FortSignalOptions {
  apiKey: string
  baseUrl?: string
}

// Register
export interface RegisterStartParams {
  userId: string
  username: string
}

export interface RegisterStartResponse {
  challenge: string
  rp: { name: string; id: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: Array<{ type: string; alg: number }>
  timeout: number
  attestation: string
}

export interface RegisterCompleteParams {
  userId: string
  challenge: string
  attestation: object
}

export interface RegisterCompleteResponse {
  status: string
  userId: string
}

// Challenge
export interface ChallengeStartParams {
  action: string
  amount: number
  recipient: string
  from: string
  metadata?: string
  userId: string
}

export interface ChallengeStartResponse {
  challengeId: string
  challenge: string
  expiresAt: string
}

export interface ChallengeVerifyParams {
  challengeId: string
  assertion: object
}

export interface ChallengeVerifyResponse {
  allowed: boolean
  signalId?: string
  policyId?: string
  reason?: string
}

// Agent
export interface AgentRegisterParams {
  publicKey: string
}

export interface AgentRegisterResponse {
  agentId: string
  registeredAt: string
}

export interface AgentDelegateParams {
  agentId: string
  scope: {
    actions: string[]
    maxAmountPerAction: number
    recipients: string[]
    expiresAt: string
  }
  policyId?: string
}

export interface AgentDelegateResponse {
  delegationId: string
  agentId: string
  scope: object
  issuedAt: string
  expiresAt: string
}

export interface AgentVerifyParams {
  delegationId: string
  action: string
  amount: number
  recipient: string
  signature: string
  nonce: string
}

export interface AgentVerifyResponse {
  allowed: boolean
  signalId?: string
  policyId?: string
  reason?: string
}

export interface AgentRevokeParams {
  delegationId: string
}

export interface AgentRevokeResponse {
  status: string
  delegationId: string
}

export interface AgentListResponse {
  agents: Array<{
    agentId: string
    registeredAt: string
    rotatedAt?: string
    delegations: Array<{
      delegationId: string
      scope: object
      issuedAt: string
      expiresAt: string
    }>
  }>
}

export class FortSignalError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'FortSignalError'
    this.status = status
    this.code = code
  }
}
