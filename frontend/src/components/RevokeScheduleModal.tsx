'use client'

/**
 * Confirm-revoke dialog for grantors (FE-19). Only ever shown for schedules
 * where `revocable` is true — the contract returns the same Unauthorized
 * code for "not revocable" as it does for "not your schedule", so gating
 * happens client-side on the schedule's own `revocable` flag, not by
 * attempting the call and reading the error.
 *
 * Clearly separates what stays with the beneficiary (already-vested amount,
 * still claimable) from what returns to the grantor (the unvested
 * remainder) — the impact summary the issue's acceptance criteria calls for.
 */

import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'
import TxStatus from './TxStatus'
import { formatAmount, truncateAddress } from '@/lib/format'
import type { TxState } from '@/hooks/useVesting'

interface RevokeScheduleModalProps {
  open: boolean
  onClose: () => void
  scheduleId: number
  beneficiary: string
  vestedAmount: bigint
  unvestedAmount: bigint
  decimals: number
  txState: TxState
  onConfirm: (scheduleId: number) => Promise<{ ok: boolean }>
}

export default function RevokeScheduleModal({
  open,
  onClose,
  scheduleId,
  beneficiary,
  vestedAmount,
  unvestedAmount,
  decimals,
  txState,
  onConfirm,
}: RevokeScheduleModalProps) {
  const context = `revoke:${scheduleId}`
  const inFlight =
    txState.context === context &&
    ['simulating', 'awaiting-signature', 'submitting', 'confirming'].includes(txState.phase)

  async function handleConfirm() {
    const result = await onConfirm(scheduleId)
    if (result.ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={() => !inFlight && onClose()}
      title={`Revoke schedule #${scheduleId}`}
      dismissible={!inFlight}
    >
      <div className="space-y-4 text-sm text-gray-300">
        <p className="flex items-start gap-2 rounded-lg border border-stellar-accent/40 bg-stellar-accent/10 p-3 text-stellar-accent">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Revoking is permanent. The unvested remainder is returned to you immediately; tokens
          already vested remain claimable by the beneficiary.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-stellar-border bg-stellar-dark/40 p-4">
            <p className="text-xs text-gray-400">
              Stays vested → {truncateAddress(beneficiary)}
            </p>
            <p className="mt-1 font-mono text-lg text-stellar-secondary">
              {formatAmount(vestedAmount, decimals)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Already vested as of now, remains claimable by the beneficiary.
            </p>
          </div>
          <div className="rounded-lg border border-stellar-border bg-stellar-dark/40 p-4">
            <p className="text-xs text-gray-400">Returned to you</p>
            <p className="mt-1 font-mono text-lg text-stellar-success">
              {formatAmount(unvestedAmount, decimals)}
            </p>
            <p className="mt-1 text-xs text-gray-500">Unvested remainder, refunded on revoke.</p>
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
            Keep schedule
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={inFlight}
            className="rounded-lg bg-stellar-accent px-4 py-2 font-medium text-white transition-colors hover:bg-stellar-accent/90 disabled:opacity-50"
          >
            {inFlight ? 'Processing…' : 'Confirm revocation'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
