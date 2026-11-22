import { describe, expect, it } from 'vitest'

import {
  calculateFinanceEntry,
  summarizeFinance,
  type FinanceEntry,
} from '../types'

const entry = (overrides: Partial<FinanceEntry> = {}): FinanceEntry => ({
  id: 'entry-1',
  model: 'gpt-6.2-sol',
  port: 'openai-prod',
  requests: 10,
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 4,
  fixedCost: 3,
  revenue: 20,
  ...overrides,
})

describe('finance calculations', () => {
  it('calculates variable cost, total cost, profit, and margin', () => {
    expect(calculateFinanceEntry(entry())).toMatchObject({
      variableCost: 4,
      cost: 7,
      profit: 13,
      margin: 65,
    })
  })

  it('groups entries by model and keeps totals accurate', () => {
    const groups = summarizeFinance(
      [entry(), entry({ id: 'entry-2', model: 'claude', revenue: 10 })],
      'model'
    )

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ key: 'gpt-6.2-sol', revenue: 20 })
    expect(groups[1]).toMatchObject({ key: 'claude', revenue: 10 })
  })

  it('returns a zero margin when revenue is zero', () => {
    expect(calculateFinanceEntry(entry({ revenue: 0 }))).toMatchObject({
      profit: -7,
      margin: 0,
    })
  })
})
