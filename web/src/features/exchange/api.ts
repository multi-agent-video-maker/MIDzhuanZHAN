import { api, type ApiRequestConfig } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type ExchangeKind = 'sms' | 'membership'

export type ExchangeProduct = {
  type: ExchangeKind
  name: string
  available?: number
}

export type ExchangeCatalog = {
  configured: boolean
  ordering_open: boolean
  products: ExchangeProduct[]
}

export type ExchangeOrder = {
  id: string
  type: ExchangeKind
  name: string
  status: 'pending' | 'approving' | 'fulfilled' | 'cancelled'
  payment_instructions: string
  payment_deadline?: string
  delivery?: { key: string }
}

export type SMSOrder = {
  id: string
  status: string
  phone_number?: string
  sms_code?: string
  expires_at?: string
  can_retry: boolean
}

type ExchangeReply<T> = { success: boolean; data: T }

export async function getExchange<T>(
  path: string,
  options?: ApiRequestConfig
): Promise<T> {
  const response = await api.get<ExchangeReply<T>>(path, {
    ...options,
    skipErrorHandler: true,
  })
  return requireServerSuccess(response.data).data
}

export async function postExchange<T>(
  path: string,
  body: unknown,
  options?: ApiRequestConfig
): Promise<T> {
  const response = await api.post<ExchangeReply<T>>(path, body, {
    ...options,
    skipErrorHandler: true,
  })
  return requireServerSuccess(response.data).data
}

export function exchangeNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

export function exchangeSMSOptions(session: string): ApiRequestConfig {
  return { headers: { 'X-Exchange-Session': session } }
}
