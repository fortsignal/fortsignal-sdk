export interface FortSignalOptions {
  apiKey: string
  baseUrl?: string
}

// Register — shapes match `POST /register/start` and `/register/complete`
export interface RegisterStartParams {
  userId: string
  /** `"passwords"` (platform) / `"authenticator"` (cross-platform key). Omit for browser default. */
  saveMode?: 'passwords' | 'authenticator'
  /**
   * Explicit credential rotation (lost-device recovery). Registration is never
   * idempotent: re-registering without `rotate` fails with 409 `credential_exists`.
   * With `rotate: true`, the ceremony may replace the existing passkey.
   * Rotations are recorded in the API's audit log.
   */
  rotate?: boolean
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
  source?: string
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
  source?: string
  metadata?: unknown
  /** Ed25519-signed execution artifact (JWT) — present on allow decisions. */
  artifact?: string
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
  source?: string
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
  /**
   * True when this registration overwrote an existing agent key and therefore
   * invalidated the agent's active delegation. The agent cannot act until a
   * human re-approves a delegation in the dashboard — surface this to the
   * operator instead of continuing silently.
   */
  delegationInvalidated?: boolean
}

export interface AgentChallengeStartParams {
  agentId: string
  action: string
  amount?: number
  recipient: string
  source?: string
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
  source?: string
  metadata?: unknown
  /** Ed25519-signed execution artifact (JWT) — present on allow decisions. */
  artifact?: string
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

/**
 * Result of `GET /agent/delegation/:id/status`. The API accepts a delegationId
 * (`del_…`), a proposalId (`prop_…`), or an agentId. `NONE` means no active or
 * pending delegation exists for the id (the API's 404 is mapped, not thrown).
 */
export interface DelegationStatusResponse {
  status: 'ACTIVE' | 'PENDING_APPROVAL' | 'NONE' | 'EXPIRED' | 'CANCELLED' | (string & {})
  delegationId?: string
  proposalId?: string
  expiresAt?: string
  /** Present on PENDING_APPROVAL — signatures collected so far. */
  signed?: number
  /** Present on PENDING_APPROVAL — signatures required to activate. */
  required?: number
}

// Execution artifact verification (Task 6)
export type SeenStore = {
  /** Atomic check-and-mark. Returns true if this jti was NOT seen before. */
  claim(jti: string, expEpochSeconds: number): Promise<boolean>
}

export type ArtifactClaims = {
  iss: string
  sub: string
  jti: string
  iat: number
  nbf: number
  exp: number
  act?: { typ: 'agent'; id: string }
  fs: {
    v: 1
    verifiedBy: 'human' | 'agent'
    userId?: string
    delegationId?: string
    policyId?: string
    intentNonce: string
    paramsHash: string
    action: string
    recipient: string
    amount?: number
    source?: string
  }
}

export type ArtifactErrorCode =
  | 'artifact_malformed' | 'artifact_alg_rejected' | 'artifact_unknown_kid'
  | 'artifact_bad_signature' | 'artifact_expired' | 'artifact_not_yet_valid'
  | 'artifact_issuer_mismatch' | 'artifact_params_mismatch' | 'artifact_replayed'
  | 'artifact_store_unavailable' | 'artifact_keys_unavailable'

export type ArtifactVerdict =
  | { valid: true; claims: ArtifactClaims }
  | { valid: false; error: ArtifactErrorCode }

export type VerifyArtifactOptions = {
  expected: {
    action: string
    recipient: string
    amount?: number
    source?: string
    metadata?: Record<string, unknown>
  }
  seenStore: SeenStore
}
