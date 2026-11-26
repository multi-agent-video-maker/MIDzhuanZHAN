import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, MessageSquare, RefreshCw, Ticket } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import {
  EXCHANGE_PROVIDERS,
  useExchangeLedger,
  type ExchangeFinanceLine,
} from './exchange-ledger'

function parseAmount(value: string): number | null | undefined {
  const amount = value.trim().replace(',', '.')
  if (amount === '') return null
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount)) return undefined
  const [whole, fraction = ''] = amount.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return cents <= 100_000_000 ? cents : undefined
}

export function ExchangeFinance() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [month, setMonth] = useState('')
  const [editing, setEditing] = useState<ExchangeFinanceLine | null>(null)
  const ledger = useExchangeLedger(month)
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'code',
  })
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
  })
  const channels = [
    {
      kind: 'sms' as const,
      title: t('SMS channel'),
      balance: ledger.data?.sms_balance,
      icon: MessageSquare,
    },
    {
      kind: 'membership' as const,
      title: t('Membership channel'),
      balance: ledger.data?.membership_balance,
      icon: Ticket,
    },
  ]
  const money = (cents: number | null | undefined) =>
    cents == null ? '—' : formatter.format(cents / 100)
  const lines = ledger.data?.lines ?? []

  return (
    <SectionPageLayout stackActionsOnMobile>
      <SectionPageLayout.Title>{t('Exchange finance')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          size='sm'
          variant='outline'
          nativeButton={false}
          render={<Link to='/finance' />}
        >
          <ArrowLeft /> {t('Finance Accounting')}
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={ledger.isFetching}
          onClick={() => void ledger.refetch()}
        >
          <RefreshCw /> {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <div className='flex flex-wrap items-end gap-2'>
            <Field className='max-w-52'>
              <FieldLabel htmlFor='exchange-finance-month'>
                {t('Month')}
              </FieldLabel>
              <Input
                id='exchange-finance-month'
                type='month'
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </Field>
            {month && (
              <Button variant='ghost' onClick={() => setMonth('')}>
                {t('Clear')}
              </Button>
            )}
          </div>
          {ledger.isPending && (
            <p role='status' className='text-muted-foreground text-sm'>
              {t('Loading...')}
            </p>
          )}
          {ledger.error && (
            <p role='alert' className='text-destructive text-sm'>
              {getServerErrorMessage(ledger.error)}
            </p>
          )}
          {ledger.data && !ledger.data.configured && (
            <Alert>
              <AlertDescription>
                {t('Exchange finance is not configured.')}
              </AlertDescription>
            </Alert>
          )}
          {ledger.data?.configured && (
            <>
              <div className='grid gap-3 xl:grid-cols-2'>
                {channels.map((channel) => {
                  const total = ledger.data?.totals?.[channel.kind]
                  const metrics = [
                    {
                      label: t('Available balance'),
                      value: channel.balance
                        ? money(channel.balance.cents)
                        : t('Unavailable'),
                    },
                    {
                      label: t('Revenue'),
                      value: money(
                        total?.revenue_count ? total.revenue_cents : null
                      ),
                    },
                    {
                      label: t('Cost'),
                      value: money(total?.cost_count ? total.cost_cents : null),
                    },
                    { label: t('Profit'), value: money(total?.profit_cents) },
                  ]
                  return (
                    <Card key={channel.kind}>
                      <CardHeader className='gap-2'>
                        <CardTitle className='flex items-center gap-2'>
                          <channel.icon className='text-primary size-4' />{' '}
                          {EXCHANGE_PROVIDERS[channel.kind]} · {channel.title}
                        </CardTitle>
                        <p className='text-muted-foreground text-sm'>
                          {t('Orders')}{' '}
                          {formatNumber(total?.orders ?? 0, locale)}
                          {Boolean(total?.missing) && (
                            <Badge className='ms-2' variant='outline'>
                              {t('Pending reconciliation')}{' '}
                              {formatNumber(total?.missing ?? 0, locale)}
                            </Badge>
                          )}
                        </p>
                      </CardHeader>
                      <CardContent>
                        <dl className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
                          {metrics.map((metric) => (
                            <div key={metric.label} className='space-y-1'>
                              <dt className='text-muted-foreground text-xs'>
                                {metric.label}
                              </dt>
                              <dd className='text-base font-semibold tabular-nums'>
                                {metric.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
              {ledger.data.limited && (
                <Alert>
                  <AlertDescription>
                    {t(
                      'Totals cover the latest 200 orders. Select a month to narrow the report.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>{t('Finance ledger')}</CardTitle>
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'Profit includes orders with both revenue and cost recorded.'
                    )}
                  </p>
                </CardHeader>
                <CardContent>
                  {lines.length === 0 ? (
                    <p className='text-muted-foreground py-6 text-center text-sm'>
                      {t('No exchange orders to reconcile.')}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('Orders')}</TableHead>
                          <TableHead>{t('Date')}</TableHead>
                          <TableHead>{t('Revenue')}</TableHead>
                          <TableHead>{t('Cost')}</TableHead>
                          <TableHead>{t('Profit')}</TableHead>
                          <TableHead>{t('Actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell>
                              <p className='font-medium'>
                                {line.channel === 'sms'
                                  ? t('SMS key')
                                  : line.name}
                              </p>
                              <div className='text-muted-foreground flex items-center gap-1 font-mono text-xs'>
                                {line.id.slice(0, 8)}{' '}
                                <CopyButton
                                  value={line.id}
                                  aria-label={t('Copy order number')}
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              {dateFormatter.format(
                                new Date(line.confirmed_at)
                              )}
                            </TableCell>
                            <TableCell className='tabular-nums'>
                              {money(line.revenue_cents)}
                            </TableCell>
                            <TableCell className='tabular-nums'>
                              {money(line.actual_cost_cents)}
                            </TableCell>
                            <TableCell className='tabular-nums'>
                              {money(line.profit_cents)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() => setEditing(line)}
                              >
                                {t('Record amounts')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
          {editing && (
            <ExchangeAmountsDialog
              key={editing.id}
              line={editing}
              onClose={() => setEditing(null)}
            />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function ExchangeAmountsDialog(props: {
  line: ExchangeFinanceLine
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [revenue, setRevenue] = useState(
    props.line.revenue_cents == null
      ? ''
      : (props.line.revenue_cents / 100).toFixed(2)
  )
  const [cost, setCost] = useState(
    props.line.manual_cost_cents == null
      ? ''
      : (props.line.manual_cost_cents / 100).toFixed(2)
  )
  const queryClient = useQueryClient()
  const synced = props.line.cost_cents != null
  const revenueCents = parseAmount(revenue)
  const costCents = parseAmount(cost)
  const save = useMutation({
    mutationFn: async () =>
      requireServerSuccess(
        (
          await api.put(
            `/api/finance/exchange/${props.line.id}`,
            {
              revenue_cents: revenueCents,
              cost_cents: costCents,
            },
            { skipErrorHandler: true }
          )
        ).data
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance', 'exchange'] })
      props.onClose()
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      revenueCents !== undefined &&
      costCents !== undefined &&
      !save.isPending
    ) {
      save.mutate()
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Record amounts')}</DialogTitle>
          <DialogDescription>
            {t('Enter actual amounts in USD. Leave unknown amounts blank.')}
          </DialogDescription>
        </DialogHeader>
        <form className='space-y-4' onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor='exchange-received-amount'>
              {t('Revenue')} (USD)
            </FieldLabel>
            <Input
              id='exchange-received-amount'
              inputMode='decimal'
              value={revenue}
              maxLength={10}
              aria-invalid={revenueCents === undefined}
              onChange={(event) => setRevenue(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='exchange-recorded-cost'>
              {t('Cost')} (USD)
            </FieldLabel>
            <Input
              id='exchange-recorded-cost'
              inputMode='decimal'
              maxLength={10}
              readOnly={synced}
              value={
                synced ? ((props.line.cost_cents ?? 0) / 100).toFixed(2) : cost
              }
              aria-invalid={costCents === undefined}
              onChange={(event) => setCost(event.target.value)}
            />
            {synced && (
              <p className='text-muted-foreground text-sm'>
                {t('Cost synced from the SMS order.')}
              </p>
            )}
          </Field>
          {save.error && (
            <p role='alert' className='text-destructive text-sm'>
              {getServerErrorMessage(save.error)}
            </p>
          )}
          <DialogFooter>
            <Button
              variant='outline'
              disabled={save.isPending}
              onClick={props.onClose}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='submit'
              disabled={
                save.isPending ||
                revenueCents === undefined ||
                costCents === undefined
              }
            >
              {t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
