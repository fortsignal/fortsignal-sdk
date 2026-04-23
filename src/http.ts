import { FortSignalError } from './types'

export async function request<T>(
  apiKey: string,
  baseUrl: string,
  method: string,
  path: string,
  body?: object,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const data = await res.json() as any

  if (!res.ok) {
    throw new FortSignalError(
      data?.error ?? 'Unknown error',
      res.status,
      data?.error ?? 'unknown_error',
    )
  }

  return data as T
}
