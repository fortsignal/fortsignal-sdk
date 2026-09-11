import { RegisterResource } from './register'
import { ChallengeResource } from './challenge'
import { AgentResource } from './agent'
import { SignalResource } from './signal'
import { verifyArtifact, MemorySeenStore } from './artifact'
import { FortSignalError } from './types'
import type { FortSignalOptions, VerifyArtifactOptions, ArtifactVerdict, ConsumeArtifactResponse } from './types'

export { FortSignalError } from './types'
export { MemorySeenStore }
export type {
  FortSignalOptions,
  RegisterStartParams,
  RegisterStartResponse,
  RegisterCompleteBody,
  RegisterCompleteResponse,
  ChallengeStartParams,
  ChallengeStartResponse,
  ChallengeVerifyParams,
  ChallengeVerifyResponse,
  SignalLookupResponse,
  AgentRegisterParams,
  AgentRegisterResponse,
  AgentChallengeStartParams,
  AgentChallengeStartResponse,
  AgentVerifyParams,
  AgentVerifyResponse,
  DelegationStatusResponse,
  SeenStore,
  ArtifactClaims,
  ArtifactErrorCode,
  ArtifactVerdict,
  VerifyArtifactOptions,
  ConsumeArtifactReason,
  ConsumeArtifactResponse,
} from './types'

const DEFAULT_BASE_URL = 'https://api.fortsignal.com'

export class FortSignal {
  readonly register: RegisterResource
  readonly challenge: ChallengeResource
  readonly agent: AgentResource
  readonly signal: SignalResource

  private jwksCache: { keys: any[]; expiresAt: number } | null = null
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(options: FortSignalOptions) {
    if (!options.apiKey) throw new Error('apiKey is required')
    const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.baseUrl = base
    this.apiKey = options.apiKey
    this.register = new RegisterResource(options.apiKey, base)
    this.challenge = new ChallengeResource(options.apiKey, base)
    this.agent = new AgentResource(options.apiKey, base)
    this.signal = new SignalResource(options.apiKey, base)
  }

  verifyArtifact(artifact: string, options: VerifyArtifactOptions): Promise<ArtifactVerdict> {
    return verifyArtifact(this.baseUrl, this.jwksCache, (c) => { this.jwksCache = c }, artifact, options)
  }

  // Server-side enforcement point: re-checks revocation + policy version in
  // one atomic operation and burns the jti on first use. 200 = this caller
  // won the claim; 409 = typed business deny (never throws); 5xx / transport
  // throw FortSignalError — a failed consume aborts the action.
  async consumeArtifact(artifact: string): Promise<ConsumeArtifactResponse> {
    const res = await fetch(`${this.baseUrl}/artifact/consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ artifact }),
    })
    if (res.status === 200) return { consumed: true }
    if (res.status === 409) {
      let reason: unknown
      try {
        reason = (await res.json())?.reason
      } catch {
        reason = undefined
      }
      return { consumed: false, reason: typeof reason === 'string' ? reason : 'artifact_invalid' }
    }
    let data: Record<string, unknown> = {}
    try {
      data = await res.json()
    } catch {
      // no body — keep the fallback code below
    }
    throw new FortSignalError(
      (data.error as string) ?? 'consume_failed',
      res.status,
      (data.error as string) ?? 'consume_failed',
    )
  }
}
