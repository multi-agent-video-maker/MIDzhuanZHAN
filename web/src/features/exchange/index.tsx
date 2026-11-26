import { KeyRound, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuthStore } from '@/stores/auth-store'

import { ExchangePurchase } from './purchase'
import { ExchangeRedeem } from './redeem'

export function Exchange() {
  const { t } = useTranslation()
  const userId = useAuthStore((store) => store.auth.user?.id)
  const [tab, setTab] = useState('buy')
  const [delivered, setDelivered] = useState({ key: '', revision: 0 })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Purchase & redeem')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className='mx-auto max-w-5xl gap-4'
        >
          <TabsList variant='line' className='h-10 border-b'>
            <TabsTrigger value='buy' className='px-3'>
              <ShoppingBag /> {t('Buy keys')}
            </TabsTrigger>
            <TabsTrigger value='redeem' className='px-3'>
              <KeyRound /> {t('Redeem')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value='buy' keepMounted>
            <ExchangePurchase
              key={userId}
              userId={userId}
              onRedeem={(key) => {
                setDelivered((previous) => ({
                  key,
                  revision: previous.revision + 1,
                }))
                setTab('redeem')
              }}
            />
          </TabsContent>
          <TabsContent value='redeem' keepMounted>
            <ExchangeRedeem
              key={delivered.revision}
              initialKey={delivered.key}
              active={tab === 'redeem'}
            />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
