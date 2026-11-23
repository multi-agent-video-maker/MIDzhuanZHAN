/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Database, Settings2, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { LanguageSwitcher } from '@/components/language-switcher'
import { LoadingState } from '@/components/loading-state'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Form } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfig } from '@/hooks/use-system-config'
import { handleServerError } from '@/lib/handle-server-error'
import { accountPasswordSchema } from '@/lib/password-policy'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { buildSetupPayload, getSetupStatus, submitSetup } from './api'
import { AdminStep } from './components/admin-step'
import { CompleteStep } from './components/complete-step'
import { DatabaseStep } from './components/database-step'
import { StepNavigation } from './components/step-navigation'
import { UsageModeStep } from './components/usage-mode-step'
import type { SetupFormValues, SetupStatus } from './types'

const STEPS = [
  {
    titleKey: 'Database check',
    descriptionKey: 'Verify your database connection',
    icon: Database,
  },
  {
    titleKey: 'Administrator account',
    descriptionKey: 'Create credentials for the root user',
    icon: ShieldCheck,
  },
  {
    titleKey: 'Usage mode',
    descriptionKey: 'Choose how the platform will operate',
    icon: Settings2,
  },
  {
    titleKey: 'Review & initialize',
    descriptionKey: 'Confirm settings and finish setup',
    icon: Sparkles,
  },
]

const DEFAULT_FORM_VALUES: SetupFormValues = {
  username: '',
  password: '',
  confirmPassword: '',
  usageMode: 'external',
}

export function SetupWizard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { systemName, logo, loading: systemConfigLoading } = useSystemConfig()

  const [currentStep, setCurrentStep] = useState(0)
  const [setupStatus, setSetupStatus] = useState<SetupStatus | undefined>()

  const form = useForm<SetupFormValues>({
    defaultValues: DEFAULT_FORM_VALUES,
    mode: 'onBlur',
  })

  const watchedValues = form.watch()

  const {
    data: statusResponse,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => requireServerSuccess(await getSetupStatus()),
    retry: false,
  })

  const mutation = useMutation({
    mutationKey: ['setup-submit'],
    mutationFn: submitSetup,
    onSuccess: async (response) => {
      if (response.success) {
        toast.success(t('System initialized successfully! Redirecting…'))
        await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
        setTimeout(() => {
          navigate({ to: '/' })
        }, 1200)
      } else {
        handleServerError(
          response,
          t('Initialization failed, please try again.')
        )
      }
    },
    onError: (error) => {
      handleServerError(error, t('Failed to initialize system'))
    },
  })

  useEffect(() => {
    if (!statusResponse) return

    if (!statusResponse.success) {
      handleServerError(statusResponse, t('Failed to load setup status'))
      return
    }

    const status = statusResponse.data
    if (!status) return

    if (status.status) {
      navigate({ to: '/' })
      return
    }

    setSetupStatus(status)
    setCurrentStep(0)

    // Pre-fill usage mode if backend echoes it
    if (status.SelfUseModeEnabled) {
      form.setValue('usageMode', 'self', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
    } else if (status.DemoSiteEnabled) {
      form.setValue('usageMode', 'demo', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
    } else {
      form.setValue('usageMode', 'external', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusResponse, navigate, form])

  useEffect(() => {
    if (!setupStatus) return

    // Reset admin fields when backend reports they are already initialized
    if (setupStatus.root_init) {
      form.setValue('username', '', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
      form.setValue('password', '', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
      form.setValue('confirmPassword', '', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
    }
  }, [setupStatus, form])

  const currentStepComponent = useMemo(() => {
    if (currentStep === 0) {
      return <DatabaseStep status={setupStatus} />
    }
    if (currentStep === 1) {
      return (
        <AdminStep
          form={form}
          rootInitialized={Boolean(setupStatus?.root_init)}
        />
      )
    }
    if (currentStep === 2) {
      return <UsageModeStep form={form} />
    }
    return <CompleteStep status={setupStatus} values={watchedValues} />
  }, [currentStep, setupStatus, form, watchedValues])

  const validateAdminStep = () => {
    if (setupStatus?.root_init) return true

    const username = form.getValues('username')?.trim()
    const password = form.getValues('password')
    const confirmPassword = form.getValues('confirmPassword')

    if (!username) {
      form.setError('username', {
        type: 'manual',
        message: t('Please enter an administrator username'),
      })
      toast.error(t('Please enter an administrator username'))
      return false
    }

    if (!accountPasswordSchema.safeParse(password).success) {
      form.setError('password', {
        type: 'manual',
        message: t('Password must contain between 8 and 128 characters.'),
      })
      toast.error(t('Password must contain between 8 and 128 characters.'))
      return false
    }

    if (password !== confirmPassword) {
      form.setError('confirmPassword', {
        type: 'manual',
        message: t('Passwords do not match'),
      })
      toast.error(t('Passwords do not match'))
      return false
    }

    return true
  }

  const validateUsageModeStep = () => {
    const usageMode = form.getValues('usageMode')
    if (!usageMode) {
      form.setError('usageMode', {
        type: 'manual',
        message: t('Select a usage mode to continue'),
      })
      toast.error(t('Select a usage mode to continue'))
      return false
    }
    return true
  }

  const handleNextStep = () => {
    if (currentStep === 1 && !validateAdminStep()) return
    if (currentStep === 2 && !validateUsageModeStep()) return

    setCurrentStep((step) => Math.min(step + 1, STEPS.length - 1))
  }

  const handlePreviousStep = () => {
    setCurrentStep((step) => Math.max(step - 1, 0))
  }

  const handleSubmit = async () => {
    const adminValid = validateAdminStep()
    const usageValid = validateUsageModeStep()
    if (!adminValid || !usageValid) return

    const payload = buildSetupPayload(
      form.getValues(),
      Boolean(setupStatus?.root_init)
    )

    mutation.mutate(payload)
  }

  const currentStepMeta = STEPS[currentStep]
  const progress = ((currentStep + 1) / STEPS.length) * 100

  return (
    <div className='relative min-h-svh overflow-hidden bg-background text-foreground'>
      <div className='setup-wizard-glow setup-wizard-glow-one' aria-hidden='true' />
      <div className='setup-wizard-glow setup-wizard-glow-two' aria-hidden='true' />
      <header className='relative z-10 flex items-center justify-between px-5 py-5 sm:px-8 lg:px-12'>
        <div className='flex items-center gap-3'>
          <div className='flex size-10 items-center justify-center overflow-hidden rounded-xl border border-border bg-card shadow-sm'>
            {systemConfigLoading ? (
              <Skeleton className='size-full rounded-xl' />
            ) : (
              <img
                src={logo}
                alt={t('System logo')}
                className='size-full object-cover'
              />
            )}
          </div>
          <div className='leading-tight'>
            {systemConfigLoading ? (
              <Skeleton className='h-4 w-24' />
            ) : (
              <p className='text-sm font-semibold tracking-tight'>{systemName}</p>
            )}
            <p className='text-muted-foreground mt-1 text-xs'>
              {t('System setup wizard')}
            </p>
          </div>
        </div>
        <LanguageSwitcher />
      </header>

      <main className='relative z-10 mx-auto grid max-w-6xl gap-6 px-5 pb-8 sm:px-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10 lg:px-12 lg:pb-12'>
        <aside className='flex flex-col justify-between gap-8 py-2 lg:min-h-[640px] lg:py-8'>
          <div>
            <p className='text-primary text-sm font-semibold'>{t('Initialize')}</p>
            {systemConfigLoading ? (
              <Skeleton className='mt-4 h-12 w-56' />
            ) : (
              <h1 className='mt-4 max-w-xs text-4xl font-semibold tracking-[-0.04em] sm:text-5xl'>
                {systemName}
              </h1>
            )}
            <p className='text-muted-foreground mt-5 max-w-sm text-sm leading-6'>
              {t(
                'Follow the guided steps to prepare your workspace before the first login.'
              )}
            </p>
          </div>

          <ol className='grid gap-2 sm:grid-cols-4 lg:grid-cols-1'>
            {STEPS.map((step, index) => {
              const isActive = currentStep === index
              const isCompleted = currentStep > index
              const StepIcon = step.icon
              return (
                <li key={step.titleKey}>
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors',
                      isActive && 'border-primary/60 bg-primary/10',
                      isCompleted && !isActive && 'border-success/30 bg-success/5',
                      !isActive && !isCompleted && 'border-border/70 bg-card/40'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-xl border',
                        isActive && 'border-primary bg-primary text-primary-foreground',
                        isCompleted && !isActive && 'border-success/50 text-success',
                        !isActive && !isCompleted && 'border-border text-muted-foreground'
                      )}
                    >
                      {isCompleted ? (
                        <ShieldCheck className='size-4' aria-hidden='true' />
                      ) : (
                        <StepIcon className='size-4' aria-hidden='true' />
                      )}
                    </span>
                    <span className='min-w-0'>
                      <span className='block truncate text-sm font-semibold'>
                        {t(step.titleKey)}
                      </span>
                      <span className='text-muted-foreground mt-0.5 block truncate text-xs'>
                        {t(step.descriptionKey)}
                      </span>
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        </aside>

        <Card className='setup-wizard-card self-start border-border/80 bg-card/95 shadow-2xl shadow-black/10 dark:shadow-black/30'>
          <CardHeader className='gap-5 border-b border-border/70 px-5 py-5 sm:px-8 sm:py-7'>
            <div className='flex items-start justify-between gap-5'>
              <div>
                <CardTitle className='text-2xl font-semibold tracking-tight sm:text-3xl'>
                  {t(currentStepMeta.titleKey)}
                </CardTitle>
                <CardDescription className='mt-2 max-w-xl text-sm leading-6'>
                  {t(currentStepMeta.descriptionKey)}
                </CardDescription>
              </div>
              <span className='bg-primary/10 text-primary shrink-0 rounded-full px-3 py-1 text-xs font-semibold tabular-nums'>
                {currentStep + 1}/{STEPS.length}
              </span>
            </div>
            <div
              className='bg-muted h-1.5 overflow-hidden rounded-full'
              role='progressbar'
              aria-label={t('System setup wizard')}
              aria-valuemin={1}
              aria-valuemax={STEPS.length}
              aria-valuenow={currentStep + 1}
            >
              <div
                className='bg-primary h-full rounded-full transition-[width] duration-300 ease-out'
                style={{ width: `${progress}%` }}
              />
            </div>
          </CardHeader>

          <CardContent className='px-5 py-6 sm:px-8 sm:py-8'>
            {isLoading && <LoadingState message={t('Loading setup status…')} />}
            {!isLoading && isError && (
              <ErrorState
                title={t('We could not load the setup status.')}
                onRetry={() => refetch()}
              />
            )}
            {!isLoading && !isError && (
              <Form {...form}>
                <form
                  className='min-h-56 space-y-6'
                  onSubmit={(event) => event.preventDefault()}
                >
                  {currentStepComponent}
                </form>
              </Form>
            )}
          </CardContent>

          {!isLoading && !isError && (
            <CardFooter className='w-full border-t border-border/70 bg-muted/30 px-5 py-4 sm:px-8'>
              <StepNavigation
                currentStep={currentStep}
                totalSteps={STEPS.length}
                onBack={handlePreviousStep}
                onNext={handleNextStep}
                onSubmit={handleSubmit}
                isSubmitting={mutation.isPending}
              />
            </CardFooter>
          )}
        </Card>
      </main>
    </div>
  )
}
