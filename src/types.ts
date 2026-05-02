export interface FortSignalOptions {
  apiKey: string
  baseUrl?: string
}

// Register — shapes match `POST /register/start` and `/register/complete`
export interface RegisterStartParams {
  userId: string
  /** `"passwords"` (platform) / `"authenticator"` (cross-platform key). Omit for browser default. */
  saveMode?: 'passwords' | 'authenticator'
}

export interface RegisterStartResponse {
  challenge: string
  rp: { name: string; id: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: Array<{ type: string; alg: number }>
  timeout: number
  attestation: string
}

/**
 * Raw JSON returned by `@simplewebauthn/browser` `startRegistration()` — send unchanged.
 * The API resolves `userId` from its nonce store using `response.clientDataJSON`.
 */
export type RegisterCompleteBody = Record<string, unknown>

export interface RegisterCompleteResponse {
  status: string
  userId: string
}

// Challenge (human flow)
export interface ChallengeStartParams {
  userId: string
  action: string
  amount?: number
  recipient: string
  from?: string
  metadata?: Record<string, unknown>
  requireBiometric?: boolean
}

export interface ChallengeStartResponse {
  challenge: string
  [key: string]: unknown
}

export interface ChallengeVerifyParams {
  [key: string]: unknown
}

export interface ChallengeVerifyResponse {
  decision: 'allow' | 'deny'
  signalId?: string
  policyId?: string
  reason?: string
  verifiedBy?: 'human' | 'agent'
  verifiedAt?: string
  action?: string
  amount?: number
  recipient?: string
  from?: string
  metadata?: unknown
}

/** Stored allow record from `GET /signal/:signalId` (matches verify-time payload; optional fields depend on human vs agent). */
export interface SignalLookupResponse {
  tenantId: string
  verifiedAt: string
  verifiedBy: 'human' | 'agent'
  action: string
  amount: number
  recipient: string
  userId?: string
  agentId?: string
  delegationId?: string
  policyId?: string
  from?: string
  metadata?: unknown
}

// Agent
export interface AgentRegisterParams {
  agentId: string
  publicKey: string
}

export interface AgentRegisterResponse {
  status: string
  agentId: string
  registeredAt: string
}

export interface AgentChallengeStartParams {
  agentId: string
  action: string
  amount?: number
  recipient: string
  from?: string
  metadata?: Record<string, unknown>
  /** Optional — must match the active delegation if provided (API validates). */
  delegationId?: string
}

export interface AgentChallengeStartResponse {
  challenge: string
  agentId: string
  delegationId: string
  expiresIn: number
}

export interface AgentVerifyParams {
  agentId: string
  challenge: string
  signature: string
}

export interface AgentVerifyResponse {
  decision: 'allow' | 'deny'
  signalId?: string
  policyId?: string
  delegationId?: string
  reason?: string
  verifiedBy?: 'agent'
  verifiedAt?: string
  action?: string
  amount?: number
  recipient?: string
  from?: string
  metadata?: unknown
}

export interface AgentRevokeParams {
  agentId: string
}

export interface AgentRevokeResponse {
  status: string
  agentId: string
}

export interface AgentRotateParams {
  agentId: string
  publicKey: string
}

export interface AgentRotateResponse {
  status: string
  agentId: string
  message: string
}

export interface AgentListResponse {
  agents: Array<{
    agentId: string
    registeredAt: string
    rotatedAt?: string
    delegation?: {
      delegationId: string
      policyId: string
      issuedAt: string
      expiresAt: string
    }
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
