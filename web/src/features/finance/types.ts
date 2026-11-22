export type FinanceEntry = {
  id: string
  model: string
  port: string
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
  requests: number
  inputTokens: number
  outputTokens: number
  revenue: number
  cost: number
  profit: number
  margin: number
}

export type FinanceGroupBy = 'total' | 'model' | 'port'

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
    const key = groupBy === 'model' ? result.model : result.port
    const bucket = grouped.get(key || '—') ?? []
    bucket.push(result)
    grouped.set(key || '—', bucket)
  }

  return Array.from(grouped, ([key, bucket]) => buildGroup(key, bucket)).sort(
    (left, right) => right.profit - left.profit
  )
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
