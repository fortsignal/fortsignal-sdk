import { request } from './http'
import type {
  RegisterStartParams,
  RegisterStartResponse,
  RegisterCompleteBody,
  RegisterCompleteResponse,
} from './types'

export class RegisterResource {
  constructor(private apiKey: string, private baseUrl: string) {}

  start(params: RegisterStartParams): Promise<RegisterStartResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/register/start', params)
  }

  /** Pass through the object returned by `startRegistration()` unchanged. */
  complete(registration: RegisterCompleteBody): Promise<RegisterCompleteResponse> {
    return request(this.apiKey, this.baseUrl, 'POST', '/register/complete', registration)
  }
}
