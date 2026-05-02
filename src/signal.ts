import { request } from './http'
import type { SignalLookupResponse } from './types'

export class SignalResource {
  constructor(private apiKey: string, private baseUrl: string) {}

  /** Fetch the stored allow record for `signalId` (tenant-scoped; same API key as challenge flow). */
  get(signalId: string): Promise<SignalLookupResponse> {
    const id = encodeURIComponent(signalId.trim())
    return request<SignalLookupResponse>(this.apiKey, this.baseUrl, 'GET', `/signal/${id}`)
  }
}
