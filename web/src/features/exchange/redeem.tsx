import { useMutation } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { exchangeNonce, postExchange } from './api'
import { ExchangeSMS } from './sms'

const smsKey = /^relay_[a-f0-9]{48}$/
const membershipKey = /^mem_[a-f0-9]{48}$/

type Redemption =
  | { type: 'sms'; session: string }
  | { type: 'membership'; name: string; content: string }

export function ExchangeRedeem(props: { initialKey: string; active: boolean }) {
  const { t } = useTranslation()
  const [key, setKey] = useState(props.initialKey)
  const [result, setResult] = useState<Redemption | null>(null)
  const attempt = useRef<{ key: string; nonce: string } | null>(null)
  const redeem = useMutation({
    mutationFn: async (value: string): Promise<Redemption> => {
      if (attempt.current?.key !== value) {
        attempt.current = { key: value, nonce: exchangeNonce() }
      }
      if (smsKey.test(value)) {
        const response = await postExchange<{ session: string }>(
          '/api/exchange/sms/activate',
          {
            key: value,
            claim_token: `session_${attempt.current.nonce}`,
          }
        )
        return { type: 'sms', session: response.session }
      }
      const response = await postExchange<{ name: string; content: string }>(
        '/api/exchange/membership/redeem',
        {
          key: value,
          claim_nonce: attempt.current.nonce,
        }
      )
      return { type: 'membership', ...response }
    },
    onSuccess: (value) => {
      setResult(value)
      setKey('')
      attempt.current = null
      redeem.reset()
    },
  })
  const normalizedKey = key.trim().toLowerCase()
  const canRedeem =
    smsKey.test(normalizedKey) || membershipKey.test(normalizedKey)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canRedeem && !redeem.isPending) redeem.mutate(normalizedKey)
  }

  if (result?.type === 'sms') {
    return (
      <ExchangeSMS
        session={result.session}
        active={props.active}
        onReset={() => setResult(null)}
      />
    )
  }

  return (
    <Card className='max-w-2xl'>
      <CardHeader>
        <CardTitle>{result?.name || t('Redeem a key')}</CardTitle>
        <CardDescription>
          {result
            ? t('Copy the voucher and follow its redemption instructions.')
            : t('Enter an SMS or membership key to redeem it.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className='space-y-3'>
            <Textarea
              aria-label={t('Membership voucher')}
              className='min-h-28 font-mono'
              readOnly
              value={result.content}
            />
            <div className='flex flex-wrap gap-2'>
              <CopyButton
                value={result.content}
                variant='outline'
                size='default'
              >
                {t('Copy voucher')}
              </CopyButton>
              <Button variant='ghost' onClick={() => setResult(null)}>
                {t('Redeem another key')}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className='space-y-4'>
            <Field>
              <FieldLabel htmlFor='exchange-key'>
                {t('Exchange key')}
              </FieldLabel>
              <Input
                id='exchange-key'
                value={key}
                onChange={(event) => setKey(event.target.value)}
                type='password'
                autoComplete='off'
                spellCheck={false}
                maxLength={64}
                required
              />
            </Field>
            <p className='text-muted-foreground text-sm'>
              {t('For SMS, keep this page open until the code arrives.')}
            </p>
            {redeem.error && (
              <p role='alert' className='text-destructive text-sm'>
                {getServerErrorMessage(redeem.error)}
              </p>
            )}
            <Button type='submit' disabled={!canRedeem || redeem.isPending}>
              <KeyRound /> {t('Redeem')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
