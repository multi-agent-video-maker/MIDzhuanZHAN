import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExchangePurchase } from '../purchase'
import { ExchangeRedeem } from '../redeem'

const requests = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/lib/api', () => ({ api: requests }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

function renderExchange(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  requests.get.mockReset()
  requests.post.mockReset()
  sessionStorage.clear()
})

describe('exchange purchase and redemption', () => {
  it('disables buying when the shop is closed and keeps order lookup available', async () => {
    requests.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          configured: true,
          ordering_open: false,
          products: [{ type: 'sms', name: '接码服务 Key' }],
        },
      },
    })
    renderExchange(<ExchangePurchase userId={21} onRedeem={() => {}} />)
    expect(
      await screen.findByText('Key purchases are temporarily closed.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create order' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Order number'), {
      target: { value: '9b693009-f6b9-465d-9f4a-f7f0496a8551' },
    })
    expect(screen.getByRole('button', { name: 'Find order' })).toBeEnabled()
  })

  it('reuses the same membership claim after a failed request and displays the delivered voucher', async () => {
    requests.post
      .mockRejectedValueOnce(new Error('Test connection interrupted'))
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: { name: 'Plus', content: 'test-voucher-42' },
        },
      })
    const key = `mem_${'a'.repeat(48)}`
    renderExchange(<ExchangeRedeem initialKey={key} active />)
    fireEvent.click(screen.getByRole('button', { name: 'Redeem a key' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Redeem a key' }))
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Membership voucher' })
      ).toHaveValue('test-voucher-42')
    )
    const first = requests.post.mock.calls[0]
    expect(first[0]).toBe('/api/exchange/membership/redeem')
    expect(first[1]).toEqual({
      key,
      claim_nonce: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(requests.post.mock.calls[1][1]).toEqual(first[1])
    expect(sessionStorage.length).toBe(0)
  })
})
