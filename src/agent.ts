import { request } from './http'
import { FortSignalError } from './types'
import type {
  AgentRegisterParams,
  AgentRegisterResponse,
  AgentChallengeStartParams,
  AgentChallengeStartResponse,
  AgentVerifyParams,
  AgentVerifyResponse,
  DelegationStatusResponse,
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

  /**
   * Poll delegation state — accepts a delegationId (`del_…`), proposalId
   * (`prop_…`), or agentId. Use it to gate agent execution on multi-sig
   * approval: PENDING_APPROVAL means pause/notify, ACTIVE means run.
   * The API's 404 (nothing active or pending) maps to `{ status: 'NONE' }`
   * rather than throwing — NONE is a legitimate answer, not an error.
   */
  async delegationStatus(id: string): Promise<DelegationStatusResponse> {
    try {
      return await request<DelegationStatusResponse>(
        this.apiKey, this.baseUrl, 'GET',
        `/agent/delegation/${encodeURIComponent(id)}/status`,
      )
    } catch (e) {
      if (e instanceof FortSignalError && e.status === 404) return { status: 'NONE' }
      throw e
    }
  }
}
