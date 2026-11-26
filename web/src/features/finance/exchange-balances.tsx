import { MessageSquare, RefreshCw, Ticket } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'

import { EXCHANGE_PROVIDERS, useExchangeLedger } from './exchange-ledger'

export function ExchangeBalances() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const ledger = useExchangeLedger()
  const dollars = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'code',
  })
  const emptyBalance = ledger.isPending ? t('Loading...') : t('Unavailable')
  const accounts = [
    {
      name: EXCHANGE_PROVIDERS.sms,
      channel: t('SMS channel'),
      icon: MessageSquare,
      balance: ledger.data?.sms_balance,
    },
    {
      name: EXCHANGE_PROVIDERS.membership,
      channel: t('Membership channel'),
      icon: Ticket,
      balance: ledger.data?.membership_balance,
    },
  ]

  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle>{t('Available balance')}</CardTitle>
        <CardAction>
          <Button
            variant='outline'
            size='sm'
            disabled={ledger.isFetching}
            onClick={() => void ledger.refetch()}
          >
            <RefreshCw /> {t('Refresh')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className='space-y-2'>
        <dl className='grid gap-3 sm:grid-cols-2' aria-live='polite'>
          {accounts.map((account) => (
            <div
              key={account.name}
              className='bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3'
            >
              <dt className='flex items-center gap-2'>
                <account.icon
                  className='text-primary size-4'
                  aria-hidden='true'
                />
                <div>
                  <div className='font-semibold'>{account.name}</div>
                  <div className='text-muted-foreground text-xs'>
                    {account.channel}
                  </div>
                </div>
              </dt>
              <dd className='font-semibold tabular-nums'>
                {account.balance
                  ? dollars.format(account.balance.cents / 100)
                  : emptyBalance}
              </dd>
            </div>
          ))}
        </dl>
        {ledger.isError && (
          <p role='status' className='text-destructive text-sm'>
            {t('Refresh failed')}
          </p>
        )}
        {ledger.data && !ledger.data.configured && (
          <p className='text-muted-foreground text-sm'>
            {t('Exchange finance is not configured.')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
