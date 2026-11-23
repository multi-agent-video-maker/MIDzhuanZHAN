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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { LanguageSwitcher } from '@/components/language-switcher'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfig } from '@/hooks/use-system-config'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()

  return (
    <div className='relative min-h-svh overflow-hidden bg-background text-foreground'>
      <div className='setup-wizard-glow setup-wizard-glow-one' aria-hidden='true' />
      <div className='setup-wizard-glow setup-wizard-glow-two' aria-hidden='true' />
      <Link
        to='/'
        className='absolute top-5 left-5 z-20 flex items-center gap-3 transition-opacity hover:opacity-80 sm:top-8 sm:left-8'
      >
        <div className='relative flex size-10 items-center justify-center overflow-hidden rounded-xl border border-border bg-card shadow-sm'>
          {loading ? (
            <Skeleton className='absolute inset-0 rounded-xl' />
          ) : (
            <img
              src={logo}
              alt={t('Logo')}
              className='size-full object-cover'
            />
          )}
        </div>
        {loading ? (
          <Skeleton className='h-5 w-24' />
        ) : (
          <h1 className='text-base font-semibold tracking-tight'>{systemName}</h1>
        )}
      </Link>
      <div className='absolute top-5 right-5 z-20 sm:top-8 sm:right-8'>
        <LanguageSwitcher />
      </div>
      <div className='relative z-10 grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]'>
        <aside className='hidden flex-col justify-between border-r border-border/70 bg-sidebar/45 p-12 lg:flex'>
          <div className='pt-20'>
            <p className='text-primary text-sm font-semibold'>{systemName}</p>
            <h2 className='mt-5 max-w-xl text-6xl font-semibold tracking-[-0.05em] text-balance'>
              {t('Sign in')}
            </h2>
            <p className='text-muted-foreground mt-6 max-w-md text-base leading-7'>
              {t(
                'Follow the guided steps to prepare your workspace before the first login.'
              )}
            </p>
          </div>
          <div className='grid max-w-md grid-cols-2 gap-3 text-xs'>
            <div className='rounded-2xl border border-border/70 bg-card/60 p-4'>
              <div className='bg-primary mb-5 h-1.5 w-10 rounded-full' />
              <p className='text-muted-foreground'>{t('System setup wizard')}</p>
            </div>
            <div className='rounded-2xl border border-border/70 bg-card/60 p-4'>
              <div className='bg-destructive mb-5 h-1.5 w-10 rounded-full' />
              <p className='text-muted-foreground'>{t('Administrator account')}</p>
            </div>
          </div>
        </aside>
        <main className='flex items-center justify-center px-5 pb-10 pt-24 sm:px-8 sm:pt-28 lg:px-12 lg:pt-12'>
          <div className='w-full max-w-md rounded-3xl border border-border/80 bg-card/95 p-6 shadow-2xl shadow-black/10 dark:shadow-black/30 sm:p-8'>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
