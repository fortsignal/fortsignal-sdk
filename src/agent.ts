import { request } from './http'
import type {
  AgentRegisterParams,
  AgentRegisterResponse,
  AgentVerifyParams,
  AgentVerifyResponse,
} from './types'

export class AgentResource {
  constructor(private apiKey: string, private baseUrl: string) {}

  register(params: AgentRegisterParams): Promise<AgentRegisterResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/agent/register', params)
  }

  verify(params: AgentVerifyParams): Promise<AgentVerifyResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/challenge/verify', params)
  }
}
