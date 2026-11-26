import { useQuery } from '@tanstack/react-query'

import { getExchange, type ExchangeKind } from '@/features/exchange/api'

export const EXCHANGE_PROVIDERS = {
  sms: 'DogeSMS',
  membership: 'BirdPay',
} as const

type ChannelTotals = {
  revenue_cents: number
  cost_cents: number
  revenue_count: number
  cost_count: number
  profit_cents: number | null
  missing: number
  orders: number
}

export type ExchangeFinanceLine = {
  id: string
  channel: ExchangeKind
  confirmed_at: string
  name: string
  cost_cents: number | null
  actual_cost_cents: number | null
  manual_cost_cents: number | null
  revenue_cents: number | null
  profit_cents: number | null
}

type WalletBalance = { currency: 'USD'; cents: number }
type ExchangeFinanceLedger = {
  configured: boolean
  sms_balance: WalletBalance | null
  membership_balance: WalletBalance | null
  limited: boolean
  totals: Record<ExchangeKind, ChannelTotals> | null
  lines: ExchangeFinanceLine[] | null
}

export function useExchangeLedger(month = '') {
  return useQuery({
    queryKey: ['finance', 'exchange', month],
    queryFn: ({ signal }) =>
      getExchange<ExchangeFinanceLedger>('/api/finance/exchange', {
        signal,
        params: { month },
      }),
    retry: false,
  })
}
