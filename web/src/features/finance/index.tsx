import { useQuery } from '@tanstack/react-query'
import {
  Calculator,
  Database,
  Plus,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatCompactNumber, formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  calculateFinanceEntry,
  EMPTY_FINANCE_ENTRY,
  financeMonth,
  financeUserLabel,
  isFinanceMonth,
  isFinanceUserId,
  summarizeFinance,
  type FinanceEntry,
  type FinanceGroupBy,
} from './types'

const STORAGE_KEY = 'allfun.finance.entries.v1'

type FinanceDraft = Omit<FinanceEntry, 'id'>

type SeedanceLedger = {
  configured: boolean
  limited: boolean
  pending: number
  records: Array<
    Pick<
      FinanceEntry,
      'id' | 'model' | 'port' | 'outputTokens' | 'fixedCost' | 'revenue'
    > & {
      userId?: number
      username?: string
      settledAt?: number
    }
  >
}

function readEntries(): FinanceEntry[] {
  if (typeof window === 'undefined') return []

  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '[]'
    )
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isFinanceEntry)
  } catch {
    return []
  }
}

function isFinanceEntry(value: unknown): value is FinanceEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<FinanceEntry>
  return (
    typeof entry.id === 'string' &&
    typeof entry.model === 'string' &&
    typeof entry.port === 'string' &&
    [
      entry.requests,
      entry.inputTokens,
      entry.outputTokens,
      entry.inputPricePerMillion,
      entry.outputPricePerMillion,
      entry.fixedCost,
      entry.revenue,
    ].every((item) => typeof item === 'number' && Number.isFinite(item))
  )
}

function toNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function money(value: number, locale: Intl.LocalesArgument): string {
  return formatBillingCurrencyFromUSD(value, {
    locale,
    digitsLarge: 4,
    digitsSmall: 6,
  })
}

function InputField(props: {
  label: string
  value: string | number
  onChange: (value: string) => void
  type?: 'text' | 'number' | 'month'
  step?: string
  min?: string
  placeholder?: string
}) {
  const id = useId()
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id}>{props.label}</Label>
      <Input
        id={id}
        type={props.type ?? 'number'}
        min={props.min}
        step={props.step}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  )
}

export function Finance() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [entries, setEntries] = useState<FinanceEntry[]>(readEntries)
  const [draft, setDraft] = useState<FinanceDraft>(EMPTY_FINANCE_ENTRY)
  const [groupBy, setGroupBy] = useState<FinanceGroupBy>('total')
  const [modelFilter, setModelFilter] = useState('')
  const [portFilter, setPortFilter] = useState('')
  const seedanceLedger = useQuery({
    queryKey: ['finance', 'seedance'],
    queryFn: async () => {
      const { data } = await api.get<{
        success: boolean
        data: SeedanceLedger
      }>('/api/finance/seedance')
      return requireServerSuccess(data).data
    },
    staleTime: 60_000,
    retry: false,
  })

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  }, [entries])

  const filteredEntries = useMemo(() => {
    const model = modelFilter.trim().toLowerCase()
    const port = portFilter.trim().toLowerCase()
    const synced =
      seedanceLedger.data?.records.map((record) => ({
        ...EMPTY_FINANCE_ENTRY,
        ...record,
        month: record.settledAt
          ? financeMonth(record.settledAt * 1000)
          : undefined,
      })) ?? []
    return [...synced, ...entries].filter(
      (entry) =>
        (!model || entry.model.toLowerCase().includes(model)) &&
        (!port || entry.port.toLowerCase().includes(port))
    )
  }, [entries, modelFilter, portFilter, seedanceLedger.data])

  const results = useMemo(
    () => filteredEntries.map(calculateFinanceEntry),
    [filteredEntries]
  )
  const groups = useMemo(
    () => summarizeFinance(filteredEntries, groupBy),
    [filteredEntries, groupBy]
  )
  const totals = useMemo(
    () =>
      results.reduce(
        (summary, result) => ({
          requests: summary.requests + result.requests,
          inputTokens: summary.inputTokens + result.inputTokens,
          outputTokens: summary.outputTokens + result.outputTokens,
          revenue: summary.revenue + result.revenue,
          cost: summary.cost + result.cost,
          profit: summary.profit + result.profit,
        }),
        {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        }
      ),
    [results]
  )
  const margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0

  function updateDraft<K extends keyof FinanceDraft>(
    key: K,
    value: FinanceDraft[K]
  ) {
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  function addEntry() {
    const model = draft.model.trim() || t('Unspecified model')
    const port = draft.port.trim() || t('Unspecified port')
    setEntries((previous) => [
      ...previous,
      {
        ...draft,
        id: crypto.randomUUID(),
        model,
        port,
      },
    ])
    setDraft(EMPTY_FINANCE_ENTRY)
  }

  function removeEntry(id: string) {
    setEntries((previous) => previous.filter((entry) => entry.id !== id))
  }

  function clearEntries() {
    setEntries([])
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Finance Accounting')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        {seedanceLedger.data?.configured && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => void seedanceLedger.refetch()}
            disabled={seedanceLedger.isFetching}
          >
            <RefreshCw />
            {t('Sync')}
          </Button>
        )}
        <Badge variant='outline' className='border-primary/50 text-primary'>
          <Database className='size-3' />
          {t('Saved in this browser')}
        </Badge>
        <Button
          variant='outline'
          size='sm'
          onClick={clearEntries}
          disabled={entries.length === 0}
        >
          <Trash2 />
          {t('Clear ledger')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          {seedanceLedger.isError && (
            <p role='status' className='text-destructive text-sm'>
              {t('Refresh failed')}
            </p>
          )}
          {seedanceLedger.data?.configured && (
            <div className='flex flex-wrap gap-2'>
              <Badge variant='outline'>
                {t('Synced')}{' '}
                {formatNumber(seedanceLedger.data.records.length, locale)}
              </Badge>
              {seedanceLedger.data.pending > 0 && (
                <Badge variant='outline'>
                  {t('Pending')}{' '}
                  {formatNumber(seedanceLedger.data.pending, locale)}
                </Badge>
              )}
              {seedanceLedger.data.limited && (
                <Badge variant='outline'>
                  {t('Limited')} {formatNumber(200, locale)}
                </Badge>
              )}
            </div>
          )}
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            <MetricCard
              label={t('Revenue')}
              value={money(totals.revenue, locale)}
              tone='gold'
              icon={<TrendingUp />}
            />
            <MetricCard
              label={t('Cost')}
              value={money(totals.cost, locale)}
              tone='neutral'
              icon={<TrendingDown />}
            />
            <MetricCard
              label={t('Profit')}
              value={money(totals.profit, locale)}
              tone={totals.profit >= 0 ? 'positive' : 'negative'}
              icon={<Calculator />}
            />
            <MetricCard
              label={t('Profit margin')}
              value={`${formatNumber(margin, locale)}%`}
              tone={margin >= 0 ? 'positive' : 'negative'}
              icon={<span className='text-sm font-bold'>%</span>}
            />
          </div>

          <div className='grid gap-4 xl:grid-cols-[minmax(19rem,25rem)_minmax(0,1fr)]'>
            <Card className='border-primary/25'>
              <CardHeader>
                <CardTitle>{t('Add a finance record')}</CardTitle>
                <CardDescription>
                  {t(
                    'Enter upstream cost and downstream revenue to calculate resale profit.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className='grid gap-3 sm:grid-cols-2 xl:grid-cols-1'>
                <InputField
                  label={t('Model')}
                  type='text'
                  value={draft.model}
                  placeholder='gpt-6.2-sol'
                  onChange={(value) => updateDraft('model', value)}
                />
                <InputField
                  label={t('Port')}
                  type='text'
                  value={draft.port}
                  placeholder='openai-prod'
                  onChange={(value) => updateDraft('port', value)}
                />
                <InputField
                  label={t('Month')}
                  type='month'
                  value={draft.month ?? ''}
                  onChange={(value) => updateDraft('month', value)}
                />
                <InputField
                  label={t('User ID')}
                  value={draft.userId ?? ''}
                  min='1'
                  onChange={(value) => {
                    const userId = Number(value)
                    updateDraft(
                      'userId',
                      isFinanceUserId(userId) ? userId : undefined
                    )
                  }}
                />
                <InputField
                  label={t('Username')}
                  type='text'
                  value={draft.username ?? ''}
                  onChange={(value) => updateDraft('username', value)}
                />
                <InputField
                  label={t('Requests')}
                  value={draft.requests}
                  min='0'
                  onChange={(value) => updateDraft('requests', toNumber(value))}
                />
                <InputField
                  label={t('Input tokens')}
                  value={draft.inputTokens}
                  min='0'
                  onChange={(value) =>
                    updateDraft('inputTokens', toNumber(value))
                  }
                />
                <InputField
                  label={t('Output tokens')}
                  value={draft.outputTokens}
                  min='0'
                  onChange={(value) =>
                    updateDraft('outputTokens', toNumber(value))
                  }
                />
                <InputField
                  label={t('Input price per million tokens (USD)')}
                  value={draft.inputPricePerMillion}
                  min='0'
                  step='0.0001'
                  onChange={(value) =>
                    updateDraft('inputPricePerMillion', toNumber(value))
                  }
                />
                <InputField
                  label={t('Output price per million tokens (USD)')}
                  value={draft.outputPricePerMillion}
                  min='0'
                  step='0.0001'
                  onChange={(value) =>
                    updateDraft('outputPricePerMillion', toNumber(value))
                  }
                />
                <InputField
                  label={t('Fixed cost (USD)')}
                  value={draft.fixedCost}
                  min='0'
                  step='0.01'
                  onChange={(value) =>
                    updateDraft('fixedCost', toNumber(value))
                  }
                />
                <InputField
                  label={t('Revenue (USD)')}
                  value={draft.revenue}
                  min='0'
                  step='0.01'
                  onChange={(value) => updateDraft('revenue', toNumber(value))}
                />
                <Button
                  className='sm:col-span-2 xl:col-span-1'
                  onClick={addEntry}
                >
                  <Plus />
                  {t('Add record')}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='gap-3 border-b'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <CardTitle>{t('Finance ledger')}</CardTitle>
                  <Select
                    value={groupBy}
                    onValueChange={(value) =>
                      setGroupBy((value as FinanceGroupBy) || 'total')
                    }
                  >
                    <SelectTrigger className='w-40'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='total'>{t('Total volume')}</SelectItem>
                      <SelectItem value='model'>{t('By model')}</SelectItem>
                      <SelectItem value='port'>{t('By port')}</SelectItem>
                      <SelectItem value='month'>{t('By month')}</SelectItem>
                      <SelectItem value='user'>{t('By user')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='grid gap-2 sm:grid-cols-2'>
                  <Input
                    type='search'
                    value={modelFilter}
                    placeholder={t('Filter by model')}
                    aria-label={t('Filter by model')}
                    onChange={(event) => setModelFilter(event.target.value)}
                  />
                  <Input
                    type='search'
                    value={portFilter}
                    placeholder={t('Filter by port')}
                    aria-label={t('Filter by port')}
                    onChange={(event) => setPortFilter(event.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className='p-0'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Scope')}</TableHead>
                      <TableHead className='text-right'>
                        {t('Requests')}
                      </TableHead>
                      <TableHead className='text-right'>
                        {t('Tokens')}
                      </TableHead>
                      <TableHead className='text-right'>
                        {t('Revenue')}
                      </TableHead>
                      <TableHead className='text-right'>{t('Cost')}</TableHead>
                      <TableHead className='text-right'>
                        {t('Profit')}
                      </TableHead>
                      <TableHead className='text-right'>
                        {t('Margin')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) => (
                      <TableRow key={group.key}>
                        <TableCell className='font-semibold'>
                          {group.label || group.key || '—'}
                        </TableCell>
                        <TableCell className='text-right'>
                          {formatNumber(group.requests, locale)}
                        </TableCell>
                        <TableCell className='text-right'>
                          {formatCompactNumber(
                            group.inputTokens + group.outputTokens,
                            locale
                          )}
                        </TableCell>
                        <TableCell className='text-right'>
                          {money(group.revenue, locale)}
                        </TableCell>
                        <TableCell className='text-right'>
                          {money(group.cost, locale)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-semibold',
                            group.profit >= 0
                              ? 'text-success'
                              : 'text-destructive'
                          )}
                        >
                          {money(group.profit, locale)}
                        </TableCell>
                        <TableCell className='text-right'>
                          {formatNumber(group.margin, locale)}%
                        </TableCell>
                      </TableRow>
                    ))}
                    {groups.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className='text-muted-foreground h-24 text-center'
                        >
                          {t('Add a record to begin calculating.')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('Records')}</CardTitle>
            </CardHeader>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Month')}</TableHead>
                    <TableHead>{t('User')}</TableHead>
                    <TableHead>{t('Model')}</TableHead>
                    <TableHead>{t('Port')}</TableHead>
                    <TableHead className='text-right'>{t('Revenue')}</TableHead>
                    <TableHead className='text-right'>{t('Cost')}</TableHead>
                    <TableHead className='text-right'>{t('Profit')}</TableHead>
                    <TableHead className='w-12' />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((result) => (
                    <TableRow key={result.id}>
                      <TableCell>
                        {isFinanceMonth(result.month) ? result.month : '—'}
                      </TableCell>
                      <TableCell>{financeUserLabel(result)}</TableCell>
                      <TableCell>{result.model}</TableCell>
                      <TableCell>{result.port}</TableCell>
                      <TableCell className='text-right'>
                        {money(result.revenue, locale)}
                      </TableCell>
                      <TableCell className='text-right'>
                        {money(result.cost, locale)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold',
                          result.profit >= 0
                            ? 'text-success'
                            : 'text-destructive'
                        )}
                      >
                        {money(result.profit, locale)}
                      </TableCell>
                      <TableCell>
                        {result.id.startsWith('seedance:') ? (
                          <span className='text-muted-foreground text-xs'>
                            {t('Synced')}
                          </span>
                        ) : (
                          <Button
                            variant='ghost'
                            size='icon-sm'
                            aria-label={t('Remove record')}
                            onClick={() => removeEntry(result.id)}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function MetricCard(props: {
  label: string
  value: string
  tone: 'gold' | 'neutral' | 'positive' | 'negative'
  icon: ReactNode
}) {
  const toneClass = {
    gold: 'border-primary/40 bg-primary/10 text-primary',
    neutral: 'border-border bg-muted/30 text-foreground',
    positive: 'border-success/40 bg-success/10 text-success',
    negative: 'border-destructive/40 bg-destructive/10 text-destructive',
  }[props.tone]

  return (
    <Card className={cn('gap-3 border', toneClass)}>
      <CardContent className='flex items-center justify-between gap-3'>
        <div>
          <div className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
            {props.label}
          </div>
          <div className='mt-1 text-2xl font-bold tabular-nums'>
            {props.value}
          </div>
        </div>
        <div className='flex size-9 items-center justify-center rounded-lg border border-current/20'>
          {props.icon}
        </div>
      </CardContent>
    </Card>
  )
}
