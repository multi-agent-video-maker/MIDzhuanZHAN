export type FinanceEntry = {
  id: string
  model: string
  port: string
  month?: string
  userId?: number
  username?: string
  requests: number
  inputTokens: number
  outputTokens: number
  inputPricePerMillion: number
  outputPricePerMillion: number
  fixedCost: number
  revenue: number
}

export type FinanceResult = FinanceEntry & {
  variableCost: number
  cost: number
  profit: number
  margin: number
}

export type FinanceGroup = {
  key: string
  label?: string
  requests: number
  inputTokens: number
  outputTokens: number
  revenue: number
  cost: number
  profit: number
  margin: number
}

export type FinanceGroupBy = 'total' | 'model' | 'port' | 'month' | 'user'

export const EMPTY_FINANCE_ENTRY: Omit<FinanceEntry, 'id'> = {
  model: '',
  port: '',
  requests: 1,
  inputTokens: 0,
  outputTokens: 0,
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
  fixedCost: 0,
  revenue: 0,
}

export function isFinanceMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

export function isFinanceUserId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function financeUsername(entry: FinanceEntry): string {
  return typeof entry.username === 'string' ? entry.username.trim() : ''
}

export function financeUserLabel(entry: FinanceEntry): string {
  const username = financeUsername(entry)
  if (!isFinanceUserId(entry.userId)) return username || '—'
  const id = `#${entry.userId}`
  return username ? `${username} (${id})` : id
}

export function financeMonth(timestampMs: number): string {
  // Accounting months use UTC+8 regardless of the browser's local timezone.
  const date = new Date(timestampMs + 8 * 60 * 60 * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 7) : ''
}

export function calculateFinanceEntry(entry: FinanceEntry): FinanceResult {
  const variableCost =
    (Math.max(0, entry.inputTokens) / 1_000_000) *
      Math.max(0, entry.inputPricePerMillion) +
    (Math.max(0, entry.outputTokens) / 1_000_000) *
      Math.max(0, entry.outputPricePerMillion)
  const cost = variableCost + Math.max(0, entry.fixedCost)
  const revenue = Math.max(0, entry.revenue)
  const profit = revenue - cost

  return {
    ...entry,
    requests: Math.max(0, entry.requests),
    variableCost,
    cost,
    profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
  }
}

export function summarizeFinance(
  entries: FinanceEntry[],
  groupBy: FinanceGroupBy
): FinanceGroup[] {
  const results = entries.map(calculateFinanceEntry)
  if (groupBy === 'total') {
    return [buildGroup('total', results)]
  }

  const grouped = new Map<string, FinanceResult[]>()
  for (const result of results) {
    const username = financeUsername(result)
    const userKey = username ? `username:${username}` : ''
    const key = {
      model: result.model || '—',
      port: result.port || '—',
      month: isFinanceMonth(result.month) ? result.month : '',
      user: isFinanceUserId(result.userId) ? String(result.userId) : userKey,
    }[groupBy]
    const bucket = grouped.get(key) ?? []
    bucket.push(result)
    grouped.set(key, bucket)
  }

  const groups = Array.from(grouped, ([key, bucket]) => {
    const group = buildGroup(key, bucket)
    if (groupBy === 'user') {
      const entry = bucket.find(financeUsername) ?? bucket[0]
      group.label = financeUserLabel(entry)
    }
    return group
  })
  if (groupBy === 'month') {
    return groups.sort((left, right) => right.key.localeCompare(left.key))
  }
  return groups.sort((left, right) => right.profit - left.profit)
}

function buildGroup(key: string, results: FinanceResult[]): FinanceGroup {
  const summary = results.reduce(
    (total, result) => ({
      requests: total.requests + result.requests,
      inputTokens: total.inputTokens + result.inputTokens,
      outputTokens: total.outputTokens + result.outputTokens,
      revenue: total.revenue + result.revenue,
      cost: total.cost + result.cost,
      profit: total.profit + result.profit,
    }),
    {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
    }
  )

  return {
    key,
    ...summary,
    margin: summary.revenue > 0 ? (summary.profit / summary.revenue) * 100 : 0,
  }
}
