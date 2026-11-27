import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SMSKeyIssuer } from '../sms-key-issuer'

const post = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({ api: { post } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => {
  cleanup()
  post.mockReset()
})

it('keeps the same issuance request on retry and shows a copyable SMS key', async () => {
  const key = 'relay_0123456789abcdef0123456789abcdef0123456789abcdef'
  post
    .mockRejectedValueOnce(new Error('Connection interrupted'))
    .mockResolvedValueOnce({ data: { success: true, data: { key } } })
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <SMSKeyIssuer />
    </QueryClientProvider>
  )
  const name = screen.getByRole('textbox', { name: 'Key name' })
  const submit = screen.getByRole('button', { name: 'Issue SMS key' })
  fireEvent.change(name, { target: { value: '  SMS trial  ' } })
  fireEvent.click(submit)
  await screen.findByRole('alert')
  fireEvent.click(submit)
  expect(await screen.findByText(key)).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Copy to clipboard' })
  ).toBeEnabled()
  expect(post).toHaveBeenCalledTimes(2)
  const [path, payload] = post.mock.calls[0]
  expect(path).toBe('/api/exchange/admin/sms/keys')
  expect(payload).toEqual({
    name: 'SMS trial',
    request_id: expect.stringMatching(/^[a-f0-9-]{36}$/),
  })
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0])
})
