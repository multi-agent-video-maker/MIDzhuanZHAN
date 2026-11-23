import { Link } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CodeBlockFrame } from '@/components/ai-elements/code-block'
import { CopyButton } from '@/components/copy-button'
import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import { useStatus } from '@/hooks/use-status'

const videoTasksPath = '/api/v3/contents/generations/tasks'
const seedanceModels = [
  { group: 'seedance-2.0', id: 'doubao-seedance-2-0-260128' },
  { group: 'seedance-2.5', id: 'doubao-seedance-2-5-260628' },
]

const listModelsCommand = `curl -sS "$ALLFUN_BASE_URL/v1/models" \\
  -H "Authorization: Bearer $ALLFUN_API_KEY"`

const createTaskCommand = `curl -sS -X POST "$ALLFUN_BASE_URL${videoTasksPath}" \\
  -H "Authorization: Bearer $ALLFUN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${seedanceModels[0].id}",
    "content": [{"type": "text", "text": "A paper lantern floats over a quiet lake."}],
    "duration": 4,
    "resolution": "480p",
    "ratio": "16:9",
    "generate_audio": false
  }'`

const queryTaskCommand = `TASK_ID='task_your_id'
curl -sS "$ALLFUN_BASE_URL${videoTasksPath}/$TASK_ID" \\
  -H "Authorization: Bearer $ALLFUN_API_KEY"`

function ApiCommand(props: { title: string; command: string }) {
  const { t } = useTranslation()
  return (
    <CodeBlockFrame
      className='bg-card border-border my-0 shadow-none'
      title={<span className='normal-case'>{props.title}</span>}
      showToolbar
      endActions={
        <CopyButton value={props.command} size='sm' tooltip={t('Copy code')} />
      }
    >
      <pre className='px-4 py-3 font-mono text-xs leading-6 sm:text-sm'>
        <code>{props.command}</code>
      </pre>
    </CodeBlockFrame>
  )
}

export function ApiDocs() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { items: apiAddresses } = useApiInfo()
  const configuredAddress =
    typeof status?.server_address === 'string'
      ? status.server_address.trim()
      : ''
  const baseURL = (
    apiAddresses[0]?.url?.trim() ||
    configuredAddress ||
    window.location.origin
  ).replace(/\/+$/, '')
  const quotedBaseURL = baseURL.replaceAll("'", "'\\''")
  const setupCommand = `export ALLFUN_BASE_URL='${quotedBaseURL}'
export ALLFUN_API_KEY='YOUR_API_KEY'`
  const sections = [
    { id: 'quick-start', title: t('footer.columns.docs.links.quickStart') },
    { id: 'models', title: t('Seedance models and groups') },
    { id: 'create-task', title: t('Create a video task') },
    { id: 'query-task', title: t('Query a video task') },
    { id: 'status', title: t('Task states and errors') },
  ]

  return (
    <PublicLayout showMainContainer={false}>
      <main className='mx-auto max-w-7xl px-5 pt-24 pb-16 sm:px-8 lg:px-12 lg:pt-28'>
        <header className='border-border grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:items-end'>
          <div>
            <h1 className='text-foreground text-3xl font-semibold tracking-tight sm:text-5xl'>
              {t('footer.columns.docs.links.apiDocs')}
            </h1>
            <p className='text-muted-foreground mt-3 max-w-2xl leading-7'>
              {t('Create videos with Seedance through the Allfun.api gateway.')}
            </p>
            <div className='mt-5 flex flex-wrap gap-2'>
              <Button render={<Link to='/keys' />}>
                <KeyRound aria-hidden='true' />
                {t('API Keys')}
              </Button>
              <Button variant='outline' render={<Link to='/pricing' />}>
                {t('View Pricing')}
              </Button>
            </div>
          </div>
          <div className='bg-card border-border flex min-w-0 items-end gap-2 rounded-lg border p-4'>
            <div className='min-w-0 flex-1 space-y-1'>
              <p className='text-muted-foreground text-sm font-medium'>
                {t('API Base URL')}
              </p>
              <code className='text-foreground block text-sm break-all'>
                {baseURL}
              </code>
            </div>
            <CopyButton value={baseURL} size='sm' tooltip={t('Copy API URL')} />
          </div>
        </header>

        <div className='grid gap-8 pt-8 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12'>
          <aside className='lg:sticky lg:top-24 lg:self-start'>
            <nav
              aria-label={t('footer.columns.docs.links.apiDocs')}
              className='border-border flex flex-wrap gap-2 lg:flex-col lg:gap-1 lg:border-l lg:pl-4'
            >
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className='text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm px-1 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none'
                >
                  {section.title}
                </a>
              ))}
            </nav>
          </aside>

          <div className='min-w-0 space-y-10'>
            <section id='quick-start' className='scroll-mt-24 space-y-3'>
              <h2 className='text-2xl font-semibold tracking-tight'>
                {sections[0].title}
              </h2>
              <p className='text-muted-foreground leading-7'>
                {t(
                  'Create an API key and use it as a Bearer token in every request.'
                )}
              </p>
              <ApiCommand title='Bash' command={setupCommand} />
            </section>

            <section id='models' className='scroll-mt-24 space-y-3'>
              <h2 className='text-2xl font-semibold tracking-tight'>
                {sections[1].title}
              </h2>
              <p className='text-muted-foreground leading-7'>
                {t(
                  'Choose the group for the model you want to use. The default group supports both models.'
                )}
              </p>
              <div className='border-border rounded-lg border'>
                <Table className='table-fixed'>
                  <TableHeader>
                    <TableRow className='bg-muted/40'>
                      <TableHead className='w-[36%] sm:w-[30%]'>
                        {t('Group')}
                      </TableHead>
                      <TableHead>{t('Model')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seedanceModels.map(({ group, id }) => (
                      <TableRow key={id}>
                        <TableCell className='whitespace-normal'>
                          <code className='text-sm break-all'>{group}</code>
                        </TableCell>
                        <TableCell className='whitespace-normal'>
                          <div className='flex items-center justify-between gap-1'>
                            <code className='text-sm break-all'>{id}</code>
                            <CopyButton
                              value={id}
                              size='sm'
                              aria-label={`${t('Copy to clipboard')} ${id}`}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <h3 className='pt-2 text-base font-semibold'>
                {t('List available models')}
              </h3>
              <ApiCommand title='GET /v1/models' command={listModelsCommand} />
            </section>

            <section id='create-task' className='scroll-mt-24 space-y-3'>
              <h2 className='text-2xl font-semibold tracking-tight'>
                {sections[2].title}
              </h2>
              <p className='text-muted-foreground leading-7'>
                {t(
                  'The create endpoint returns a task ID. Use it to query progress and get the video URL.'
                )}
              </p>
              <ApiCommand
                title={`POST ${videoTasksPath}`}
                command={createTaskCommand}
              />
              <p className='text-muted-foreground text-sm'>
                {t('Response')}{' '}
                <code className='text-foreground'>
                  {'{"id":"task_your_id"}'}
                </code>
              </p>
            </section>

            <section id='query-task' className='scroll-mt-24 space-y-3'>
              <h2 className='text-2xl font-semibold tracking-tight'>
                {sections[3].title}
              </h2>
              <p className='text-muted-foreground leading-7'>
                {t(
                  'Replace the example task ID with the ID returned when you created the task.'
                )}
              </p>
              <ApiCommand
                title={`GET ${videoTasksPath}/{id}`}
                command={queryTaskCommand}
              />
              <p className='text-muted-foreground leading-7'>
                {t(
                  'When the task succeeds, download the video from content.video_url. If the URL expires, query the task again.'
                )}
              </p>
            </section>

            <section
              id='status'
              className='border-border scroll-mt-24 space-y-3 border-t pt-6'
            >
              <h2 className='text-2xl font-semibold tracking-tight'>
                {sections[4].title}
              </h2>
              <dl className='divide-border divide-y text-sm'>
                <div className='grid gap-1 py-2.5 sm:grid-cols-[11rem_1fr]'>
                  <dt>
                    <code>queued / running</code>
                  </dt>
                  <dd className='text-muted-foreground'>
                    {t('The video is still being generated.')}
                  </dd>
                </div>
                <div className='grid gap-1 py-2.5 sm:grid-cols-[11rem_1fr]'>
                  <dt>
                    <code>succeeded / failed</code>
                  </dt>
                  <dd className='text-muted-foreground'>
                    {t(
                      'The task has finished. Check the video URL or error in the response.'
                    )}
                  </dd>
                </div>
                <div className='grid gap-1 py-2.5 sm:grid-cols-[11rem_1fr]'>
                  <dt>
                    <code>401</code>
                  </dt>
                  <dd className='text-muted-foreground'>
                    {t('Check that your API key is present and enabled.')}
                  </dd>
                </div>
                <div className='grid gap-1 py-2.5 sm:grid-cols-[11rem_1fr]'>
                  <dt>
                    <code>404</code>
                  </dt>
                  <dd className='text-muted-foreground'>
                    {t(
                      'Check the task ID. Use the same account that created the task.'
                    )}
                  </dd>
                </div>
                <div className='grid gap-1 py-2.5 sm:grid-cols-[11rem_1fr]'>
                  <dt>
                    <code>429</code>
                  </dt>
                  <dd className='text-muted-foreground'>
                    {t('Reduce the request rate and try again shortly.')}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      </main>
    </PublicLayout>
  )
}
