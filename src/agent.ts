import { request } from './http'
import type {
  AgentRegisterParams,
  AgentRegisterResponse,
  AgentChallengeStartParams,
  AgentChallengeStartResponse,
  AgentVerifyParams,
  AgentVerifyResponse,
} from './types'

export class AgentResource {
  constructor(private apiKey: string, private baseUrl: string) {}

  register(params: AgentRegisterParams): Promise<AgentRegisterResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/agent/register', params)
  }

  startChallenge(params: AgentChallengeStartParams): Promise<AgentChallengeStartResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/challenge/start', params)
  }

  verify(params: AgentVerifyParams): Promise<AgentVerifyResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/challenge/verify', params)
  }
}
