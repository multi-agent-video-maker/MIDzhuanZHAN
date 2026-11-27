import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { postExchange } from './api'
import { smsIssueSchema, type SMSIssueForm } from './lib/sms-issue-form'

export function SMSKeyIssuer() {
  const { t } = useTranslation()
  const form = useForm<SMSIssueForm>({
    defaultValues: { name: '' },
    resolver: zodResolver(smsIssueSchema),
  })
  const attempt = useRef<{ name: string; request_id: string } | null>(null)
  const issue = useMutation({
    gcTime: 0,
    meta: { errorToast: false },
    mutationFn: (values: SMSIssueForm) => {
      if (attempt.current?.name !== values.name) {
        attempt.current = { name: values.name, request_id: crypto.randomUUID() }
      }
      return postExchange<{ key: string }>(
        '/api/exchange/admin/sms/keys',
        attempt.current
      )
    },
    onSuccess: () => {
      attempt.current = null
      form.reset()
    },
  })
  const nameError = form.formState.errors.name?.message

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('SMS key issuance')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Card className='max-w-xl'>
          <CardHeader>
            <CardTitle>{t('Issue SMS key')}</CardTitle>
            <CardDescription>
              {t('Users can redeem each key once in Purchase & redeem.')}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <form
              className='space-y-4'
              onSubmit={form.handleSubmit((values) => {
                if (!issue.isPending) issue.mutate(values)
              })}
            >
              <FieldGroup>
                <Field data-invalid={!!nameError}>
                  <FieldLabel htmlFor='sms-issue-name'>
                    {t('Key name')}
                  </FieldLabel>
                  <Input
                    id='sms-issue-name'
                    maxLength={50}
                    autoComplete='off'
                    disabled={issue.isPending}
                    aria-invalid={!!nameError}
                    aria-describedby={
                      nameError ? 'sms-issue-name-error' : undefined
                    }
                    {...form.register('name')}
                  />
                  {nameError && (
                    <FieldError id='sms-issue-name-error'>
                      {t(nameError)}
                    </FieldError>
                  )}
                </Field>
              </FieldGroup>
              <Button type='submit' disabled={issue.isPending}>
                <KeyRound aria-hidden='true' /> {t('Issue SMS key')}
              </Button>
            </form>
            {issue.isError && (
              <Alert variant='destructive'>
                <AlertDescription>
                  {getServerErrorMessage(
                    issue.error,
                    t('The exchange service is unavailable.')
                  )}
                </AlertDescription>
              </Alert>
            )}
            {issue.data && (
              <div
                className='bg-muted space-y-1 rounded-md border px-3 py-2'
                role='status'
              >
                <p className='text-sm font-medium'>{t('SMS key')}</p>
                <div className='flex items-start justify-between gap-2'>
                  <code className='min-w-0 font-mono text-sm break-all select-all'>
                    {issue.data.key}
                  </code>
                  <CopyButton value={issue.data.key} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
