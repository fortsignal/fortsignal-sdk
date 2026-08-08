import { RegisterResource } from './register'
import { ChallengeResource } from './challenge'
import { AgentResource } from './agent'
import { SignalResource } from './signal'
import { verifyArtifact, MemorySeenStore } from './artifact'
import type { FortSignalOptions, VerifyArtifactOptions, ArtifactVerdict } from './types'

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
} from './types'

const DEFAULT_BASE_URL = 'https://api.fortsignal.com'

export class FortSignal {
  readonly register: RegisterResource
  readonly challenge: ChallengeResource
  readonly agent: AgentResource
  readonly signal: SignalResource

  private jwksCache: { keys: any[]; expiresAt: number } | null = null
  private readonly baseUrl: string

  constructor(options: FortSignalOptions) {
    if (!options.apiKey) throw new Error('apiKey is required')
    const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.baseUrl = base
    this.register = new RegisterResource(options.apiKey, base)
    this.challenge = new ChallengeResource(options.apiKey, base)
    this.agent = new AgentResource(options.apiKey, base)
    this.signal = new SignalResource(options.apiKey, base)
  }

  verifyArtifact(artifact: string, options: VerifyArtifactOptions): Promise<ArtifactVerdict> {
    return verifyArtifact(this.baseUrl, this.jwksCache, (c) => { this.jwksCache = c }, artifact, options)
  }
}
