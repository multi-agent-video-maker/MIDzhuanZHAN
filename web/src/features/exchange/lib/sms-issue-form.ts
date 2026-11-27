import { z } from 'zod'

export const smsIssueSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(50, 'Invalid request'),
})

export type SMSIssueForm = z.infer<typeof smsIssueSchema>
