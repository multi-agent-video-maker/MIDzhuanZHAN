import { createFileRoute } from '@tanstack/react-router'

import { Exchange } from '@/features/exchange'

export const Route = createFileRoute('/_authenticated/exchange')({
  component: Exchange,
})
