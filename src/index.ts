import { RegisterResource } from './register'
import { ChallengeResource } from './challenge'
import { AgentResource } from './agent'
import type { FortSignalOptions } from './types'

export { FortSignalError } from './types'
export type {
  FortSignalOptions,
  RegisterStartParams,
  RegisterStartResponse,
  RegisterCompleteParams,
  RegisterCompleteResponse,
  ChallengeStartParams,
  ChallengeStartResponse,
  ChallengeVerifyParams,
  ChallengeVerifyResponse,
  AgentRegisterParams,
  AgentRegisterResponse,
  AgentVerifyParams,
  AgentVerifyResponse,
} from './types'

const DEFAULT_BASE_URL = 'https://api.fortsignal.com'

export class FortSignal {
  readonly register: RegisterResource
  readonly challenge: ChallengeResource
  readonly agent: AgentResource

  constructor(options: FortSignalOptions) {
    if (!options.apiKey) throw new Error('apiKey is required')
    const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.register = new RegisterResource(options.apiKey, base)
    this.challenge = new ChallengeResource(options.apiKey, base)
    this.agent = new AgentResource(options.apiKey, base)
  }
}
