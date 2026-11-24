import { describe, expect, it } from 'vitest'

import {
  calculateFinanceEntry,
  financeMonth,
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

  it('orders monthly totals chronologically and retains records without a month', () => {
    const groups = summarizeFinance(
      [
        entry({ month: '2026-10', revenue: 30 }),
        entry({ id: 'entry-2', month: '2026-11', revenue: 10 }),
        entry({ id: 'entry-3', month: '2026-11', revenue: 12 }),
        entry({ id: 'entry-4', revenue: 8 }),
      ],
      'month'
    )

    expect(
      groups.map(({ key, revenue, cost, profit }) => ({
        key,
        revenue,
        cost,
        profit,
      }))
    ).toEqual([
      { key: '2026-11', revenue: 22, cost: 14, profit: 8 },
      { key: '2026-10', revenue: 30, cost: 7, profit: 23 },
      { key: '', revenue: 8, cost: 7, profit: 1 },
    ])
  })

  it('keeps two users with the same username separate and combines records for a user ID', () => {
    const groups = summarizeFinance(
      [
        entry({ userId: 12, username: 'member', revenue: 20 }),
        entry({ id: 'entry-2', userId: 13, username: 'member', revenue: 10 }),
        entry({ id: 'entry-3', userId: 12, revenue: 25 }),
      ],
      'user'
    )

    expect(
      groups.map(({ key, revenue, requests }) => ({ key, revenue, requests }))
    ).toEqual([
      { key: '12', revenue: 45, requests: 20 },
      { key: '13', revenue: 10, requests: 10 },
    ])
  })

  it('groups manual records by username when no user ID was entered', () => {
    const groups = summarizeFinance(
      [
        entry({ username: ' test-user ', revenue: 28 }),
        entry({ id: 'entry-2', username: 'test-user' }),
        entry({ id: 'entry-3', revenue: 12 }),
      ],
      'user'
    )

    expect(
      groups.map(({ revenue, requests }) => ({ revenue, requests }))
    ).toEqual([
      { revenue: 48, requests: 20 },
      { revenue: 12, requests: 10 },
    ])
  })

  it('assigns settlements at the China-time month boundary to the next month', () => {
    expect(financeMonth(Date.UTC(2026, 9, 31, 15, 59, 59))).toBe('2026-10')
    expect(financeMonth(Date.UTC(2026, 9, 31, 16))).toBe('2026-11')
  })
})
