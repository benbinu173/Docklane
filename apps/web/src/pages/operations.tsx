import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowClockwise } from '@phosphor-icons/react/dist/csr/ArrowClockwise'
import { toast } from 'sonner'
import { useIdentity, useProfile } from '@/lib/identity-context'
import { timestamp } from '@/lib/inventory-client'
import { Button } from '@/components/ui/button'
import { ResourceState } from './phase3-shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

type Job = {
  id: string
  type: string
  status: string
  attempts: number
  lastErrorCode: string | null
  availableAt: string
  createdAt: string
  processedAt: string | null
}
type Result = {
  data: Job[]
  counts: Record<string, number>
  pagination: { page: number; pages: number; total: number }
}
const names: Record<string, string> = {
  ORDER_RESERVATION_EXPIRY: 'Release an expired stock hold',
  STRIPE_WEBHOOK: 'Update a payment result',
  STRIPE_RECONCILE: 'Check a provider payment',
  STRIPE_SESSION_CLOSE: 'Close an unpaid checkout',
  STRIPE_COMPENSATION: 'Return a late test payment',
}
const notes: Record<string, string> = {
  PAYMENT_ASSOCIATION_INVALID:
    'The provider amount or order association needs review before retrying.',
  REFUND_ASSOCIATION_INVALID: 'The refund association needs review before retrying.',
  REFUND_RECONCILIATION_REQUIRED:
    'An old refund response is ambiguous. Reconcile it in Stripe before retrying.',
  REFUND_FAILED: 'Stripe reported a failed refund. Review the provider result.',
  STRIPE_NOT_CONFIGURED: 'Configure Stripe test credentials before retrying.',
}
export default function Operations() {
  const { api } = useIdentity(),
    profile = useProfile().data!.data,
    cache = useQueryClient()
  const [params, setParams] = useSearchParams(),
    [selected, setSelected] = useState<Job | null>(null),
    [reason, setReason] = useState(''),
    [openedAt] = useState(() => Date.now())
  const page = Math.max(1, Number(params.get('page')) || 1),
    status = params.get('status') ?? ''
  const query = useQuery({
    queryKey: ['connected', 'jobs', page, status],
    queryFn: () => api<Result>(`/operations/jobs?page=${page}${status ? `&status=${status}` : ''}`),
    refetchInterval: () => (Date.now() - openedAt < 120_000 ? 10_000 : false),
  })
  const retry = useMutation({
    mutationFn: () =>
      api(`/operations/jobs/${selected!.id}/retries`, { method: 'POST', body: { reason } }),
    onSuccess: async () => {
      setSelected(null)
      setReason('')
      toast.success('Retry saved. The worker will recover this task.')
      await cache.invalidateQueries({ queryKey: ['connected', 'jobs'] })
    },
  })
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }
  return (
    <>
      <div className="connected-page-title">
        <div>
          <h1>The work behind every next step.</h1>
          <p>Follow stock expiry, payment updates, and recovery tasks.</p>
        </div>
        <Button
          className="btn-secondary"
          onClick={() => {
            void query.refetch()
          }}
        >
          <ArrowClockwise size={18} />
          Refresh tasks
        </Button>
      </div>
      <div className="connected-metrics">
        {[
          ['PENDING', 'Scheduled'],
          ['PROCESSING', 'In progress'],
          ['COMPLETED', 'Completed'],
          ['FAILED', 'Needs attention'],
        ].map(([key, label]) => (
          <div key={key} className={key === 'FAILED' ? 'highlight' : ''}>
            <span>{label}</span>
            <strong>{query.data?.counts[key] ?? 0}</strong>
            <small>
              {key === 'FAILED' ? 'Review before requesting a retry' : 'Saved background work'}
            </small>
          </div>
        ))}
      </div>
      <section className="panel connected-orders-panel">
        <div className="p5-jobs-toolbar">
          <div>
            <h2>Background tasks</h2>
            <p className="muted">Payment retries reuse the original provider operation.</p>
          </div>
          <select
            aria-label="Filter background task status"
            value={status}
            onChange={(e) => change('status', e.target.value)}
          >
            <option value="">All statuses</option>
            {['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'].map((s) => (
              <option key={s} value={s}>
                {
                  {
                    PENDING: 'Scheduled',
                    PROCESSING: 'In progress',
                    COMPLETED: 'Completed',
                    FAILED: 'Needs attention',
                  }[s]
                }
              </option>
            ))}
          </select>
        </div>
        {query.isPending ? (
          <p className="p3-state" role="status">
            Loading background tasks…
          </p>
        ) : query.isError ? (
          <ResourceState
            error={query.error}
            retry={() => {
              void query.refetch()
            }}
          />
        ) : !query.data.data.length ? (
          <p className="p3-state">No tasks match this view.</p>
        ) : (
          <>
            <div className="table-scroll" role="region" aria-label="Background tasks" tabIndex={0}>
              <table className="data-table p5-job-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Scheduled</th>
                    <th>Recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <strong>{names[job.type] ?? 'Background task'}</strong>
                        <small>Created {timestamp(job.createdAt)}</small>
                      </td>
                      <td>
                        <span
                          className={`connected-badge ${job.status === 'COMPLETED' ? 'good' : job.status === 'FAILED' ? 'attention' : ''}`}
                        >
                          {
                            {
                              PENDING: 'Scheduled',
                              PROCESSING: 'In progress',
                              COMPLETED: 'Completed',
                              FAILED: 'Needs attention',
                            }[job.status]
                          }
                        </span>
                      </td>
                      <td>{job.attempts}</td>
                      <td>{timestamp(job.availableAt)}</td>
                      <td>
                        {job.status === 'FAILED' ? (
                          <>
                            <small>
                              {notes[job.lastErrorCode ?? ''] ??
                                'A temporary failure stopped this task. Check service availability before retrying.'}
                            </small>
                            {profile.role === 'ADMIN' && (
                              <Button
                                className="btn-secondary"
                                onClick={() => {
                                  setSelected(job)
                                  setReason('')
                                  retry.reset()
                                }}
                              >
                                Review retry
                              </Button>
                            )}
                          </>
                        ) : (
                          <span className="muted">
                            {job.status === 'COMPLETED' ? 'Finished' : 'Worker handles recovery'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p5-jobs-toolbar">
              <span className="muted">
                {query.data.pagination.total} {query.data.pagination.total === 1 ? 'task' : 'tasks'}
                {' · '}Page {page}
              </span>
              <div>
                <Button
                  className="btn-secondary"
                  disabled={page <= 1}
                  onClick={() => change('page', String(page - 1))}
                >
                  Previous
                </Button>{' '}
                <Button
                  className="btn-secondary"
                  disabled={page >= query.data.pagination.pages}
                  onClick={() => change('page', String(page + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !retry.isPending) setSelected(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retry this background task?</DialogTitle>
            <DialogDescription>
              Review the cause first. A retry recovers the saved operation and preserves its
              provider key.
            </DialogDescription>
          </DialogHeader>
          <label className="p4-cancel-label" htmlFor="job-retry-reason">
            Reason for retry
            <textarea
              id="job-retry-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {retry.isError && (
            <p className="p4-error" role="alert">
              {retry.error.message}
            </p>
          )}
          <Button
            className="btn-primary"
            disabled={retry.isPending || reason.trim().length < 3}
            onClick={() => retry.mutate()}
          >
            {retry.isPending ? 'Saving retry…' : 'Confirm retry'}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
