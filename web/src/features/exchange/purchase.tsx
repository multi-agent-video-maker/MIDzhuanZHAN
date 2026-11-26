import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, MessageSquare, RefreshCw, Ticket } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import {
  getServerErrorMessage,
  getServerErrorStatus,
} from '@/lib/server-error-message'

import {
  getExchange,
  postExchange,
  type ExchangeCatalog,
  type ExchangeKind,
  type ExchangeOrder,
} from './api'

type PurchaseDraft = { id: string; type: ExchangeKind; name: string }
const orderID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

function readDraft(key: string): PurchaseDraft | null {
  try {
    const stored = sessionStorage.getItem(key)
    if (!stored) return null
    const value: Partial<PurchaseDraft> = JSON.parse(stored)
    return typeof value.id === 'string' &&
      orderID.test(value.id) &&
      (value.type === 'sms' || value.type === 'membership') &&
      typeof value.name === 'string'
      ? { id: value.id, type: value.type, name: value.name }
      : null
  } catch {
    return null
  }
}

export function ExchangePurchase(props: {
  userId?: number
  onRedeem: (key: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const storageKey = `allfun.exchange.order.${props.userId}`
  const [draft, setDraft] = useState(() => readDraft(storageKey))
  const [kind, setKind] = useState<ExchangeKind>('sms')
  const [productName, setProductName] = useState('')
  const [lookup, setLookup] = useState('')
  const queryClient = useQueryClient()
  const catalog = useQuery({
    queryKey: ['exchange', 'products'],
    queryFn: ({ signal }) =>
      getExchange<ExchangeCatalog>('/api/exchange/products', { signal }),
    retry: false,
  })
  const products =
    catalog.data?.products.filter((product) => product.type === kind) ?? []
  const product =
    products.find((value) => value.name === productName) ?? products[0]
  const creation = useMutation({
    mutationFn: (request: PurchaseDraft) =>
      postExchange<ExchangeOrder>('/api/exchange/orders', request),
    onSuccess: (result) =>
      queryClient.setQueryData(
        ['exchange', 'order', props.userId, result.id],
        result
      ),
    onError: (error) => {
      if ([400, 409, 422].includes(getServerErrorStatus(error) ?? 0)) {
        remember(null)
      }
    },
  })
  const order = useQuery({
    queryKey: ['exchange', 'order', props.userId, draft?.id],
    queryFn: ({ signal }) =>
      getExchange<ExchangeOrder>(`/api/exchange/orders/${draft?.id}`, {
        signal,
      }),
    enabled: Boolean(draft?.id) && !creation.isPending,
    gcTime: 0,
    retry: false,
  })
  const details = order.data ?? creation.data

  function remember(value: PurchaseDraft | null) {
    setDraft(value)
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value))
      else sessionStorage.removeItem(storageKey)
    } catch {
      // The current order is still usable when browser storage is disabled.
    }
  }

  function startOrder() {
    if (!catalog.data?.ordering_open || !product || creation.isPending) return
    const request = { id: crypto.randomUUID(), type: kind, name: product.name }
    remember(request)
    creation.mutate(request)
  }

  function lookupOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!orderID.test(lookup.trim())) return
    creation.reset()
    remember({ id: lookup.trim(), type: 'sms', name: '' })
  }

  if (draft || details) {
    return (
      <Card className='max-w-2xl'>
        <CardHeader>
          <CardTitle>
            {details?.type === 'sms'
              ? t('SMS key')
              : details?.name || t('Order details')}
          </CardTitle>
          <CardDescription>
            {t('Keep the order number to check payment and delivery.')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <code className='text-sm break-all'>{draft?.id}</code>
            {draft && (
              <CopyButton
                value={draft.id}
                aria-label={t('Copy order number')}
              />
            )}
            {details && (
              <Badge variant='outline'>
                {
                  {
                    pending: t('Awaiting payment confirmation'),
                    approving: t('Processing'),
                    fulfilled: t('Key delivered'),
                    cancelled: t('Cancelled'),
                  }[details.status]
                }
              </Badge>
            )}
          </div>
          {details?.status === 'pending' && (
            <div className='bg-muted/50 space-y-2 rounded-lg border p-4 text-sm'>
              <p className='font-semibold'>{t('Payment instructions')}</p>
              <p className='break-words whitespace-pre-wrap'>
                {details.payment_instructions}
              </p>
              {details.payment_deadline && (
                <p className='text-muted-foreground'>
                  {t('Reserved until {{time}}', {
                    time: new Date(details.payment_deadline).toLocaleString(
                      locale
                    ),
                  })}
                </p>
              )}
            </div>
          )}
          {details?.delivery?.key && (
            <div className='flex flex-wrap items-center gap-2'>
              <Input
                readOnly
                value={details.delivery.key}
                aria-label={t('Exchange key')}
                className='min-w-48 flex-1 font-mono'
              />
              <CopyButton
                value={details.delivery.key}
                aria-label={t('Copy key')}
                variant='outline'
              />
              <Button
                onClick={() => props.onRedeem(details.delivery?.key ?? '')}
              >
                <KeyRound /> {t('Redeem a key')}
              </Button>
            </div>
          )}
          {creation.error && (
            <p role='alert' className='text-destructive text-sm'>
              {getServerErrorMessage(creation.error)}
            </p>
          )}
          {!creation.isPending && !details && order.error && (
            <p role='alert' className='text-destructive text-sm'>
              {getServerErrorMessage(order.error)}
            </p>
          )}
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              disabled={order.isFetching || creation.isPending}
              onClick={() => void order.refetch()}
            >
              <RefreshCw /> {t('Refresh')}
            </Button>
            {draft?.name && !details && creation.error && (
              <Button
                disabled={creation.isPending}
                onClick={() => creation.mutate(draft)}
              >
                {t('Retry')}
              </Button>
            )}
            <Button
              variant='ghost'
              disabled={creation.isPending}
              onClick={() => {
                creation.reset()
                remember(null)
              }}
            >
              {t('Back')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Buy keys')}</CardTitle>
          <CardDescription>
            {t(
              'Create an order, follow the payment instructions, then return to collect your key.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid grid-cols-2 gap-2'>
            <Button
              variant={kind === 'sms' ? 'default' : 'outline'}
              aria-pressed={kind === 'sms'}
              onClick={() => setKind('sms')}
            >
              <MessageSquare /> {t('SMS key')}
            </Button>
            <Button
              variant={kind === 'membership' ? 'default' : 'outline'}
              aria-pressed={kind === 'membership'}
              onClick={() => setKind('membership')}
            >
              <Ticket /> {t('Membership key')}
            </Button>
          </div>
          {catalog.isPending && (
            <p role='status' className='text-muted-foreground text-sm'>
              {t('Loading...')}
            </p>
          )}
          {catalog.error && (
            <div className='flex flex-wrap items-center gap-2'>
              <p role='alert' className='text-destructive text-sm'>
                {getServerErrorMessage(catalog.error)}
              </p>
              <Button variant='outline' onClick={() => void catalog.refetch()}>
                {t('Retry')}
              </Button>
            </div>
          )}
          {catalog.data && !catalog.data.configured && (
            <Alert>
              <AlertDescription>
                {t('The exchange service is unavailable.')}
              </AlertDescription>
            </Alert>
          )}
          {catalog.data?.configured && !catalog.data.ordering_open && (
            <Alert>
              <AlertDescription>
                {t('Key purchases are temporarily closed.')}
              </AlertDescription>
            </Alert>
          )}
          {kind === 'membership' &&
            catalog.data?.configured &&
            (products.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                {t('No membership keys in stock.')}
              </p>
            ) : (
              <Field>
                <FieldLabel htmlFor='purchase-product'>
                  {t('Membership plan')}
                </FieldLabel>
                <Select
                  value={product?.name}
                  onValueChange={(value) => setProductName(value ?? '')}
                  items={products.map((item) => ({
                    value: item.name,
                    label: item.name,
                  }))}
                >
                  <SelectTrigger id='purchase-product' className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((item) => (
                      <SelectItem key={item.name} value={item.name}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {product?.available != null && (
                  <p className='text-muted-foreground text-sm'>
                    {t('Available stock')}{' '}
                    {formatNumber(product.available, locale)}
                  </p>
                )}
              </Field>
            ))}
          {creation.error && (
            <p role='alert' className='text-destructive text-sm'>
              {getServerErrorMessage(creation.error)}
            </p>
          )}
          <Button
            disabled={
              !catalog.data?.ordering_open || !product || creation.isPending
            }
            onClick={startOrder}
          >
            {t('Create order')}
          </Button>
        </CardContent>
      </Card>
      <Card className='self-start'>
        <CardHeader>
          <CardTitle>{t('Find my order')}</CardTitle>
          <CardDescription>
            {t('Use the order number from this account.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className='space-y-3' onSubmit={lookupOrder}>
            <Field>
              <FieldLabel htmlFor='exchange-order-number'>
                {t('Order number')}
              </FieldLabel>
              <Input
                id='exchange-order-number'
                value={lookup}
                onChange={(event) => setLookup(event.target.value)}
                spellCheck={false}
                maxLength={36}
              />
            </Field>
            <Button
              type='submit'
              variant='outline'
              disabled={!orderID.test(lookup.trim())}
            >
              {t('Find order')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
