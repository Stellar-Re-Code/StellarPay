'use client'

/**
 * Renders the transaction state machine for a given context. Each phase is
 * surfaced distinctly; a failed/rejected tx never shows a success affordance.
 */

import { CheckCircle2, Loader2, XCircle, ExternalLink } from 'lucide-react'
import { explorerTxUrl } from '@/lib/format'

const SPINNER_PHASES = new Set(['simulating', 'awaiting-signature', 'submitting', 'confirming'])

/**
 * Structural shape shared by usePayrollStream's and useVesting's TxState —
 * kept generic here (rather than importing one hook's type) since both
 * hooks produce an identical shape and this component has no other
 * per-contract dependency.
 */
export interface TxStatusState {
  phase: string
  message: string
  hash: string | null
  context: string | null
}

export default function TxStatus({ state, context }: { state: TxStatusState; context: string }) {
  // Only render for the matching operation context.
  if (state.phase === 'idle' || state.context !== context) return null

  const isError = state.phase === 'failed'
  const isSuccess = state.phase === 'success'
  const isBusy = SPINNER_PHASES.has(state.phase)

  const tone = isError
    ? 'border-stellar-accent/50 bg-stellar-accent/10 text-stellar-accent'
    : isSuccess
      ? 'border-stellar-success/50 bg-stellar-success/10 text-stellar-success'
      : 'border-stellar-secondary/50 bg-stellar-secondary/10 text-stellar-secondary'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm ${tone}`}
    >
      {isBusy && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
      {isSuccess && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      {isError && <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0">
        <p>{state.message}</p>
        {state.hash && (isSuccess || state.phase === 'confirming') && (
          <a
            href={explorerTxUrl(state.hash)}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:opacity-80"
          >
            View transaction
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  )
}
