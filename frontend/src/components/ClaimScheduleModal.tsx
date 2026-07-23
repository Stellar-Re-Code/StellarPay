'use client'

/**
 * Confirm-claim dialog for a vesting schedule (FE-18). Shows the exact
 * claimable preview, distinguishes "before cliff" from "nothing new to
 * claim" (the contract itself only ever returns NothingToClaim for both —
 * see errors.ts), then runs the tx state machine.
 */

import Modal from './Modal'
import TxStatus from './TxStatus'
import { formatAmount, formatDuration } from '@/lib/format'
import type { TxState } from '@/hooks/useVesting'

interface ClaimScheduleModalProps {
  open: boolean
  onClose: () => void
  scheduleId: number
  claimable: bigint | null
  beforeCliff: boolean
  cliffRemainingSeconds: number
  decimals: number
  txState: TxState
  onConfirm: (scheduleId: number) => Promise<{ ok: boolean }>
}

export default function ClaimScheduleModal({
  open,
  onClose,
  scheduleId,
  claimable,
  beforeCliff,
  cliffRemainingSeconds,
  decimals,
  txState,
  onConfirm,
}: ClaimScheduleModalProps) {
  const context = `claim:${scheduleId}`
  const inFlight =
    txState.context === context &&
    ['simulating', 'awaiting-signature', 'submitting', 'confirming'].includes(txState.phase)
  const nothingToClaim = !beforeCliff && claimable !== null && claimable <= 0n

  async function handleConfirm() {
    const result = await onConfirm(scheduleId)
    if (result.ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={() => !inFlight && onClose()}
      title={`Claim from schedule #${scheduleId}`}
      dismissible={!inFlight}
    >
      <div className="space-y-4 text-sm text-gray-300">
        <div className="rounded-lg border border-stellar-border bg-stellar-dark/40 p-4 text-center">
          <p className="text-xs text-gray-400">Available to claim now</p>
          <p className="mt-1 font-mono text-2xl text-stellar-success">
            {claimable === null ? '…' : formatAmount(claimable, decimals)}
          </p>
        </div>

        {beforeCliff && (
          <p className="rounded-lg border border-stellar-warning/40 bg-stellar-warning/10 p-3 text-stellar-warning">
            The cliff hasn&apos;t been reached yet — nothing vests for another{' '}
            {formatDuration(cliffRemainingSeconds)}.
          </p>
        )}

        {!beforeCliff && nothingToClaim && (
          <p className="rounded-lg border border-stellar-warning/40 bg-stellar-warning/10 p-3 text-stellar-warning">
            There is nothing to claim right now. More tokens will vest as time elapses.
          </p>
        )}

        <p className="text-xs text-gray-400">
          Claiming transfers the vested-but-unclaimed amount to your wallet. The claimable figure
          may increase slightly by the time the transaction confirms.
        </p>

        <TxStatus state={txState} context={context} />

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={inFlight}
            className="rounded-lg border border-stellar-border px-4 py-2 text-white transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={inFlight || nothingToClaim || beforeCliff}
            className="rounded-lg bg-stellar-success px-4 py-2 font-medium text-stellar-dark transition-colors hover:bg-stellar-success/90 disabled:opacity-50"
          >
            {inFlight ? 'Processing…' : 'Confirm claim'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
