import { createFileRoute, redirect } from '@tanstack/react-router'

import { SMSKeyIssuer } from '@/features/exchange/sms-key-issuer'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/sms-key-issuer')({
  beforeLoad: () => {
    const user = useAuthStore.getState().auth.user
    if (!user || user.role < ROLE.ADMIN) throw redirect({ to: '/403' })
  },
  component: SMSKeyIssuer,
})
