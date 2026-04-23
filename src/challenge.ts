import { request } from './http'
import type {
  ChallengeStartParams,
  ChallengeStartResponse,
  ChallengeVerifyParams,
  ChallengeVerifyResponse,
} from './types'

export class ChallengeResource {
  constructor(private apiKey: string, private baseUrl: string) {}

  start(params: ChallengeStartParams): Promise<ChallengeStartResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/challenge/start', params)
  }

  verify(params: ChallengeVerifyParams): Promise<ChallengeVerifyResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/challenge/verify', params)
  }
}
