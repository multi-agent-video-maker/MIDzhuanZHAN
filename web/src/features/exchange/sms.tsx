import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  exchangeSMSOptions,
  getExchange,
  postExchange,
  type SMSOrder,
} from './api'

type SMSChoice = { code: string; name: string }
type SMSService = { service_code: string; service_name: string }

export function ExchangeSMS(props: {
  session: string
  active: boolean
  onReset: () => void
}) {
  const { t } = useTranslation()
  const viewId = useId()
  const [country, setCountry] = useState('')
  const [service, setService] = useState('')
  const [current, setCurrent] = useState<SMSOrder | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const queryClient = useQueryClient()
  const apiOptions = exchangeSMSOptions(props.session)
  const prefix = '/api/exchange/sms'
  const countries = useQuery({
    queryKey: ['exchange', viewId, 'countries'],
    queryFn: ({ signal }) =>
      getExchange<SMSChoice[]>(`${prefix}/countries`, {
        ...apiOptions,
        signal,
      }),
    enabled: props.active && !current,
    retry: false,
  })
  const services = useQuery({
    queryKey: ['exchange', viewId, 'services', country],
    queryFn: ({ signal }) =>
      getExchange<SMSService[]>(`${prefix}/services`, {
        ...apiOptions,
        signal,
        params: { country },
      }),
    enabled: Boolean(country) && props.active && !current,
    retry: false,
  })
  const orderPath = `${prefix}/orders/${current?.id}`
  const orderQuery = useQuery({
    queryKey: ['exchange', viewId, 'sms-order', current?.id],
    queryFn: ({ signal }) =>
      getExchange<SMSOrder>(orderPath, { ...apiOptions, signal }),
    enabled:
      Boolean(
        current &&
        !current.sms_code &&
        ['pending', 'active', 'creating'].includes(current.status)
      ) && props.active,
    gcTime: 0,
    retry: false,
    refetchInterval: (query) => {
      const last = query.state.data ?? current
      if (query.state.error || !last || last.sms_code) return false
      return ['pending', 'active', 'creating'].includes(last.status)
        ? 8000
        : false
    },
  })
  const latest = orderQuery.data ?? current
  const action = useMutation({
    mutationFn: (operation: 'start' | 'retry' | 'cancel') => {
      if (operation === 'start') {
        return postExchange<SMSOrder>(
          `${prefix}/orders`,
          { country_code: country, service_code: service },
          apiOptions
        )
      }
      return postExchange<SMSOrder>(`${orderPath}/${operation}`, {}, apiOptions)
    },
    onMutate: () =>
      queryClient.cancelQueries({
        queryKey: ['exchange', viewId, 'sms-order'],
      }),
    onSuccess: (order) => {
      setCurrent(order)
      queryClient.setQueryData(
        ['exchange', viewId, 'sms-order', order.id],
        order
      )
      setCancelOpen(false)
    },
  })
  const countryItems = (countries.data ?? []).map((item) => ({
    value: item.code,
    label: item.name,
  }))
  const serviceItems = (services.data ?? []).map((item) => ({
    value: item.service_code,
    label: item.service_name,
  }))
  const error =
    action.error ?? orderQuery.error ?? countries.error ?? services.error
  const hasActiveOrder =
    latest?.status === 'active' || latest?.status === 'pending'
  const terminalLabels: Record<string, string> = {
    completed: t('Completed'),
    cancelled: t('Cancelled'),
    expired: t('Expired'),
    failed: t('Failed'),
  }
  let status = t('Waiting for SMS')
  if (latest?.can_retry) status = t('Order status unconfirmed')
  if (latest) status = terminalLabels[latest.status] ?? status
  if (latest?.sms_code) status = terminalLabels.completed

  return (
    <Card className='max-w-2xl'>
      <CardHeader>
        <CardTitle>{t('SMS redemption')}</CardTitle>
        <CardDescription>
          {t('For SMS, keep this page open until the code arrives.')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {!latest && (
          <>
            <div className='grid gap-3 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='exchange-sms-country'>
                  {t('Country or region')}
                </FieldLabel>
                <Select
                  value={country || null}
                  items={countryItems}
                  onValueChange={(value) => {
                    setCountry(value ?? '')
                    setService('')
                  }}
                >
                  <SelectTrigger
                    id='exchange-sms-country'
                    className='w-full'
                    disabled={action.isPending}
                  >
                    <SelectValue placeholder={t('Select country')} />
                  </SelectTrigger>
                  <SelectContent>
                    {countryItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor='exchange-sms-service'>
                  {t('SMS service')}
                </FieldLabel>
                <Select
                  value={service || null}
                  items={serviceItems}
                  onValueChange={(value) => setService(value ?? '')}
                >
                  <SelectTrigger
                    id='exchange-sms-service'
                    className='w-full'
                    disabled={!country || action.isPending}
                  >
                    <SelectValue placeholder={t('Select service')} />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {country && services.isSuccess && !serviceItems.length && (
              <p className='text-muted-foreground text-sm'>
                {t('Out of stock')}
              </p>
            )}
            <Button
              disabled={!country || !service || action.isPending}
              onClick={() => action.mutate('start')}
            >
              <MessageSquare /> {t('Get number')}
            </Button>
          </>
        )}
        {latest && (
          <div className='space-y-3'>
            <Badge variant='outline' role='status'>
              {status}
            </Badge>
            {latest.phone_number && (
              <div className='flex items-center gap-2'>
                <span className='text-muted-foreground text-sm'>
                  {t('Phone number')}
                </span>
                <code className='text-sm tabular-nums'>
                  {latest.phone_number}
                </code>
                <CopyButton value={latest.phone_number} />
              </div>
            )}
            {latest.sms_code && (
              <div className='flex items-center gap-2'>
                <span className='text-muted-foreground text-sm'>
                  {t('Verification code')}
                </span>
                <code className='text-base font-semibold tracking-wider'>
                  {latest.sms_code}
                </code>
                <CopyButton value={latest.sms_code} />
              </div>
            )}
            {latest.can_retry && (
              <Button
                disabled={action.isPending}
                onClick={() => action.mutate('retry')}
              >
                {t('Retry')}
              </Button>
            )}
            {hasActiveOrder && (
              <Button
                variant='outline'
                disabled={action.isPending}
                onClick={() => setCancelOpen(true)}
              >
                {t('Cancel order')}
              </Button>
            )}
            {hasActiveOrder && orderQuery.error && (
              <Button
                variant='outline'
                onClick={() => void orderQuery.refetch()}
              >
                {t('Refresh')}
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role='alert' className='text-destructive text-sm'>
            {getServerErrorMessage(error)}
          </p>
        )}
        {countries.error && (
          <Button variant='outline' onClick={() => void countries.refetch()}>
            {t('Retry')}
          </Button>
        )}
        {services.error && (
          <Button variant='outline' onClick={() => void services.refetch()}>
            {t('Retry')}
          </Button>
        )}
        {latest && !hasActiveOrder && !latest.can_retry && (
          <Button variant='ghost' onClick={props.onReset}>
            {t('Redeem another key')}
          </Button>
        )}
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title={t('Cancel order')}
          desc={t(
            'An SMS key may only be used once. Cancelling does not restore it.'
          )}
          handleConfirm={() => action.mutate('cancel')}
          isLoading={action.isPending}
          confirmText={t('Cancel order')}
          cancelBtnText={t('Back')}
        />
      </CardContent>
    </Card>
  )
}
