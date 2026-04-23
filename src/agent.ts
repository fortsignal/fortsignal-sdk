import { request } from './http'
import type {
  AgentRegisterParams,
  AgentRegisterResponse,
  AgentDelegateParams,
  AgentDelegateResponse,
  AgentVerifyParams,
  AgentVerifyResponse,
  AgentRevokeParams,
  AgentRevokeResponse,
  AgentListResponse,
} from './types'

export class AgentResource {
  constructor(private apiKey: string, private baseUrl: string) {}

  register(params: AgentRegisterParams): Promise<AgentRegisterResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/agent/register', params)
  }

  delegate(params: AgentDelegateParams): Promise<AgentDelegateResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/agent/delegate', params)
  }

  verify(params: AgentVerifyParams): Promise<AgentVerifyResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/challenge/verify', params)
  }

  revoke(params: AgentRevokeParams): Promise<AgentRevokeResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/agent/revoke', params)
  }

  list(): Promise<AgentListResponse> {
    return request(this.apiKey, this.baseUrl, 'GET', '/agent/list')
  }
}
