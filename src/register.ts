import { request } from './http'
import type {
  RegisterStartParams,
  RegisterStartResponse,
  RegisterCompleteParams,
  RegisterCompleteResponse,
} from './types'

export class RegisterResource {
  constructor(private apiKey: string, private baseUrl: string) {}

  start(params: RegisterStartParams): Promise<RegisterStartResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/register/start', params)
  }

  complete(params: RegisterCompleteParams): Promise<RegisterCompleteResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/register/complete', params)
  }
}
