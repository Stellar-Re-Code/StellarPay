'use client'

/**
 * Confirm-cancel dialog for senders. Clearly separates the recipient
 * settlement (current claimable, paid out) from the sender refund (the
 * unstreamed remainder, returned). Runs the tx state machine.
 */

import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'
import TxStatus from './TxStatus'
import { formatAmount, truncateAddress } from '@/lib/format'
import type { TxState } from '@/hooks/usePayrollStream'

interface CancelModalProps {
  open: boolean
  onClose: () => void
  streamId: number
  recipient: string
  settlement: bigint
  refund: bigint
  decimals: number
  txState: TxState
  onConfirm: (streamId: number) => Promise<{ ok: boolean }>
}

export default function CancelModal({
  open,
  onClose,
  streamId,
  recipient,
  settlement,
  refund,
  decimals,
  txState,
  onConfirm,
}: CancelModalProps) {
  const context = `cancel:${streamId}`
  const inFlight =
    txState.context === context &&
    ['simulating', 'awaiting-signature', 'submitting', 'confirming'].includes(txState.phase)

  async function handleConfirm() {
    const result = await onConfirm(streamId)
    if (result.ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={() => !inFlight && onClose()}
      title={`Cancel stream #${streamId}`}
      dismissible={!inFlight}
    >
      <div className="space-y-4 text-sm text-gray-300">
        <p className="flex items-start gap-2 rounded-lg border border-stellar-accent/40 bg-stellar-accent/10 p-3 text-stellar-accent">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Cancelling is permanent. On confirmation the contract settles the recipient and refunds
          you in a single on-chain transaction.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-stellar-border bg-stellar-dark/40 p-4">
            <p className="text-xs text-gray-400">
              Recipient settlement → {truncateAddress(recipient)}
            </p>
            <p className="mt-1 font-mono text-lg text-stellar-secondary">
              {formatAmount(settlement, decimals)}
            </p>
            <p className="mt-1 text-xs text-gray-500">Current claimable, paid to the recipient.</p>
          </div>
          <div className="rounded-lg border border-stellar-border bg-stellar-dark/40 p-4">
            <p className="text-xs text-gray-400">Refund → you</p>
            <p className="mt-1 font-mono text-lg text-stellar-success">
              {formatAmount(refund, decimals)}
            </p>
            <p className="mt-1 text-xs text-gray-500">Unstreamed remainder, returned to sender.</p>
          </div>
        </div>

        <TxStatus state={txState} context={context} />

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={inFlight}
            className="rounded-lg border border-stellar-border px-4 py-2 text-white transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            Keep stream
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={inFlight}
            className="rounded-lg bg-stellar-accent px-4 py-2 font-medium text-white transition-colors hover:bg-stellar-accent/90 disabled:opacity-50"
          >
            {inFlight ? 'Processing…' : 'Confirm cancellation'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
