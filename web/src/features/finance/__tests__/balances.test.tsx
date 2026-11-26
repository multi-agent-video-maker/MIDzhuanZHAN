import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { Finance } from '..'

const requests = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/api', () => ({ api: requests }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

afterEach(() => {
  cleanup()
  requests.get.mockReset()
  localStorage.clear()
})

it('shows both provider balances on the finance landing page and refreshes them', async () => {
  let smsCents = 0
  requests.get.mockImplementation(async (path: string) => ({
    data: {
      success: true,
      data:
        path === '/api/finance/exchange'
          ? {
              configured: true,
              sms_balance: { currency: 'USD', cents: smsCents },
              membership_balance: { currency: 'USD', cents: 4215 },
              limited: false,
              totals: null,
              lines: [],
            }
          : { configured: false, limited: false, pending: 0, records: [] },
    },
  }))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: Finance }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  expect(await screen.findByText('DogeSMS')).toBeInTheDocument()
  expect(screen.getByText('BirdPay')).toBeInTheDocument()
  expect(await screen.findByText(/^USD\s+0\.00$/)).toBeInTheDocument()
  expect(screen.getByText(/^USD\s+42\.15$/)).toBeInTheDocument()

  smsCents = 175
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(await screen.findByText(/^USD\s+1\.75$/)).toBeInTheDocument()
})
