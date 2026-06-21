'use client'

/**
 * Stream creation form: validates every field before signing, previews the
 * live rate / total / duration, and requires an explicit full-funding
 * confirmation step before submitting. Renders the tx state machine.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { useWallet } from './WalletProvider'
import Modal from './Modal'
import TxStatus from './TxStatus'
import { usePayrollStream } from '@/hooks/usePayrollStream'
import { getDefaultTokenContractId } from '@/lib/network'
import {
  validateCreateStream,
  computeRatePerSecond,
  type FieldError,
} from '@/lib/validation'
import {
  STELLAR_DECIMALS,
  datetimeLocalToUnix,
  formatAmount,
  formatDuration,
  formatRatePerSecond,
  truncateAddress,
} from '@/lib/format'

const DECIMALS = STELLAR_DECIMALS

function defaultStart(): string {
  const d = new Date(Date.now() + 60_000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

function defaultEnd(): string {
  const d = new Date(Date.now() + 30 * 86400_000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

export default function CreateStreamForm({ onCreated }: { onCreated?: () => void }) {
  const { address } = useWallet()
  const { createStream, txState, resetTx } = usePayrollStream()

  const [recipient, setRecipient] = useState('')
  const [token, setToken] = useState(getDefaultTokenContractId())
  const [amount, setAmount] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const startUnix = datetimeLocalToUnix(start)
  const endUnix = datetimeLocalToUnix(end)
  const nowUnix = Math.floor(Date.now() / 1000)

  const validation = useMemo(
    () =>
      validateCreateStream({
        sender: address ?? '',
        recipient,
        token,
        amount,
        startUnix,
        endUnix,
        decimals: DECIMALS,
        nowUnix,
      }),
    [address, recipient, token, amount, startUnix, endUnix, nowUnix],
  )

  const durationSeconds =
    Number.isFinite(startUnix) && Number.isFinite(endUnix) && endUnix > startUnix
      ? endUnix - startUnix
      : 0

  const ratePerSecond =
    validation.amountStroops !== null && durationSeconds > 0
      ? computeRatePerSecond(validation.amountStroops, durationSeconds)
      : 0n

  const fieldError = (field: string): string | undefined =>
    submitted ? validation.errors.find((e: FieldError) => e.field === field)?.message : undefined

  const canSubmit = address !== null && validation.errors.length === 0

  function handleReview() {
    setSubmitted(true)
    if (validation.errors.length > 0 || !address) return
    resetTx()
    setConfirmOpen(true)
  }

  async function handleConfirm() {
    if (!canSubmit || validation.amountStroops === null) return
    const result = await createStream({
      recipient: recipient.trim(),
      token: token.trim(),
      totalAmount: validation.amountStroops,
      startTime: startUnix,
      endTime: endUnix,
    })
    if (result.ok) {
      setConfirmOpen(false)
      setRecipient('')
      setAmount('')
      onCreated?.()
    }
  }

  const inFlight =
    txState.context === 'create' &&
    ['simulating', 'awaiting-signature', 'submitting', 'confirming'].includes(txState.phase)

  return (
    <div className="rounded-2xl border border-stellar-border bg-stellar-surface p-6">
      <h2 className="mb-4 text-xl font-semibold text-white">Create a payment stream</h2>

      <div className="grid gap-4">
        <Field label="Recipient address" htmlFor="recipient" error={fieldError('recipient')}>
          <input
            id="recipient"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="G… (56-character Stellar address)"
            spellCheck={false}
            aria-invalid={Boolean(fieldError('recipient'))}
            className={inputClass(Boolean(fieldError('recipient')))}
          />
        </Field>

        <Field label="Token contract id" htmlFor="token" error={fieldError('token')}>
          <input
            id="token"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="C… (token contract id, e.g. a testnet SAC)"
            spellCheck={false}
            aria-invalid={Boolean(fieldError('token'))}
            className={inputClass(Boolean(fieldError('token')))}
          />
        </Field>

        <Field label="Total amount" htmlFor="amount" error={fieldError('amount')}>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`0.0 (up to ${DECIMALS} decimals)`}
            aria-invalid={Boolean(fieldError('amount'))}
            className={inputClass(Boolean(fieldError('amount')))}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start" htmlFor="start" error={fieldError('startTime')}>
            <input
              id="start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              aria-invalid={Boolean(fieldError('startTime'))}
              className={inputClass(Boolean(fieldError('startTime')))}
            />
          </Field>
          <Field label="End" htmlFor="end" error={fieldError('endTime')}>
            <input
              id="end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              aria-invalid={Boolean(fieldError('endTime'))}
              className={inputClass(Boolean(fieldError('endTime')))}
            />
          </Field>
        </div>

        {submitted &&
          validation.warnings.map((w) => (
            <p
              key={w.field}
              className="flex items-center gap-2 text-sm text-stellar-warning"
              role="alert"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {w.message}
            </p>
          ))}

        {validation.amountStroops !== null && durationSeconds > 0 && (
          <div className="rounded-lg border border-stellar-border bg-stellar-dark/40 p-4 text-sm">
            <p className="mb-2 flex items-center gap-2 font-medium text-white">
              <Info className="h-4 w-4 text-stellar-secondary" aria-hidden="true" />
              Stream preview
            </p>
            <dl className="grid grid-cols-2 gap-y-1 text-gray-300">
              <dt className="text-gray-400">Total</dt>
              <dd className="text-right font-mono text-white">
                {formatAmount(validation.amountStroops, DECIMALS)}
              </dd>
              <dt className="text-gray-400">Duration</dt>
              <dd className="text-right font-mono text-white">{formatDuration(durationSeconds)}</dd>
              <dt className="text-gray-400">Rate</dt>
              <dd className="text-right font-mono text-white">
                {formatRatePerSecond(ratePerSecond, DECIMALS)}
              </dd>
            </dl>
          </div>
        )}

        {!address && (
          <p className="text-sm text-stellar-warning" role="alert">
            Connect your wallet to create a stream.
          </p>
        )}

        <button
          type="button"
          onClick={handleReview}
          disabled={!address}
          className="inline-flex items-center justify-center rounded-lg bg-stellar-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-stellar-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Review &amp; create
        </button>

        <TxStatus state={txState} context="create" />
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !inFlight && setConfirmOpen(false)}
        title="Confirm full funding"
        dismissible={!inFlight}
      >
        <div className="space-y-4 text-sm text-gray-300">
          <p className="flex items-start gap-2 rounded-lg border border-stellar-warning/40 bg-stellar-warning/10 p-3 text-stellar-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Creating this stream transfers the full amount from your wallet to the contract up
            front. The recipient claims it gradually; you can cancel to reclaim the unstreamed
            remainder.
          </p>
          <dl className="grid grid-cols-2 gap-y-1.5">
            <dt className="text-gray-400">Recipient</dt>
            <dd className="text-right font-mono text-white">{truncateAddress(recipient.trim())}</dd>
            <dt className="text-gray-400">Total to fund</dt>
            <dd className="text-right font-mono text-white">
              {validation.amountStroops !== null
                ? formatAmount(validation.amountStroops, DECIMALS)
                : '—'}
            </dd>
            <dt className="text-gray-400">Duration</dt>
            <dd className="text-right font-mono text-white">{formatDuration(durationSeconds)}</dd>
            <dt className="text-gray-400">Rate</dt>
            <dd className="text-right font-mono text-white">
              {formatRatePerSecond(ratePerSecond, DECIMALS)}
            </dd>
          </dl>

          <TxStatus state={txState} context="create" />

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={inFlight}
              className="rounded-lg border border-stellar-border px-4 py-2 text-white transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={inFlight}
              className="rounded-lg bg-stellar-primary px-4 py-2 font-medium text-white transition-colors hover:bg-stellar-primary/90 disabled:opacity-50"
            >
              {inFlight ? 'Processing…' : 'Confirm & fund'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-lg border bg-stellar-dark px-3 py-2 text-white placeholder:text-gray-500',
    'focus:outline-none focus:ring-2 focus:ring-stellar-primary',
    hasError ? 'border-stellar-accent' : 'border-stellar-border',
  ].join(' ')
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-gray-300">
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-xs text-stellar-accent" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
