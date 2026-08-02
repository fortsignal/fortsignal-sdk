import { RegisterResource } from './register'
import { ChallengeResource } from './challenge'
import { AgentResource } from './agent'
import { SignalResource } from './signal'
import type { FortSignalOptions } from './types'

export { FortSignalError } from './types'
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
} from './types'

const DEFAULT_BASE_URL = 'https://api.fortsignal.com'

export class FortSignal {
  readonly register: RegisterResource
  readonly challenge: ChallengeResource
  readonly agent: AgentResource
  readonly signal: SignalResource

  constructor(options: FortSignalOptions) {
    if (!options.apiKey) throw new Error('apiKey is required')
    const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.register = new RegisterResource(options.apiKey, base)
    this.challenge = new ChallengeResource(options.apiKey, base)
    this.agent = new AgentResource(options.apiKey, base)
    this.signal = new SignalResource(options.apiKey, base)
  }
}
