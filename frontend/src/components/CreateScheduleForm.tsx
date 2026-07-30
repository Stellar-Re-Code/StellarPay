'use client'

/**
 * Vesting schedule creation form (FE-16): validates every field before
 * signing, previews the cliff/linear timeline, and requires an explicit
 * full-funding confirmation step before submitting. Renders the tx state
 * machine.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { useWallet } from './WalletProvider'
import Modal from './Modal'
import TxStatus from './TxStatus'
import { useVesting } from '@/hooks/useVesting'
import { getDefaultTokenContractId } from '@/lib/network'
import { validateCreateSchedule, VESTING_LABELS, type FieldError } from '@/lib/validation'
import {
  STELLAR_DECIMALS,
  datetimeLocalToUnix,
  formatAmount,
  formatDuration,
  truncateAddress,
} from '@/lib/format'

const DECIMALS = STELLAR_DECIMALS
const SECONDS_PER_DAY = 86400

function defaultStart(): string {
  const d = new Date(Date.now() + 60_000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

export default function CreateScheduleForm({ onCreated }: { onCreated?: () => void }) {
  const { address } = useWallet()
  const { createSchedule, txState, resetTx } = useVesting()

  const [beneficiary, setBeneficiary] = useState('')
  const [token, setToken] = useState(getDefaultTokenContractId())
  const [amount, setAmount] = useState('')
  const [cliffAmount, setCliffAmount] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [cliffDays, setCliffDays] = useState('365')
  const [totalDays, setTotalDays] = useState('1460')
  const [label, setLabel] = useState<string>(VESTING_LABELS[0])
  const [customLabel, setCustomLabel] = useState('')
  const [revocable, setRevocable] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const startUnix = datetimeLocalToUnix(start)
  const nowUnix = Math.floor(Date.now() / 1000)
  const cliffDurationSeconds = Number(cliffDays) * SECONDS_PER_DAY
  const totalDurationSeconds = Number(totalDays) * SECONDS_PER_DAY
  const effectiveLabel = label === 'custom' ? customLabel.trim() : label

  const validation = useMemo(
    () =>
      validateCreateSchedule({
        grantor: address ?? '',
        beneficiary,
        token,
        amount,
        startUnix,
        cliffDurationSeconds,
        cliffAmount,
        totalDurationSeconds,
        label: effectiveLabel,
        decimals: DECIMALS,
        nowUnix,
      }),
    [
      address,
      beneficiary,
      token,
      amount,
      startUnix,
      cliffDurationSeconds,
      cliffAmount,
      totalDurationSeconds,
      effectiveLabel,
      nowUnix,
    ],
  )

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
    if (!canSubmit || validation.amountStroops === null || validation.cliffAmountStroops === null) return
    const result = await createSchedule({
      beneficiary: beneficiary.trim(),
      token: token.trim(),
      totalAmount: validation.amountStroops,
      startTime: startUnix,
      cliffDuration: cliffDurationSeconds,
      cliffAmount: validation.cliffAmountStroops,
      totalDuration: totalDurationSeconds,
      label: effectiveLabel,
      revocable,
    })
    if (result.ok) {
      setConfirmOpen(false)
      setBeneficiary('')
      setAmount('')
      setCliffAmount('')
      onCreated?.()
    }
  }

  const inFlight =
    txState.context === 'create' &&
    ['simulating', 'awaiting-signature', 'submitting', 'confirming'].includes(txState.phase)

  return (
    <div className="rounded-2xl border border-stellar-border bg-stellar-surface p-6">
      <h2 className="mb-4 text-xl font-semibold text-white">Create a vesting schedule</h2>

      <div className="grid gap-4">
        <Field label="Beneficiary address" htmlFor="beneficiary" error={fieldError('beneficiary')}>
          <input
            id="beneficiary"
            type="text"
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            placeholder="G… (56-character Stellar address)"
            spellCheck={false}
            aria-invalid={Boolean(fieldError('beneficiary'))}
            className={inputClass(Boolean(fieldError('beneficiary')))}
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

        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field
            label="Cliff unlock amount"
            htmlFor="cliffAmount"
            error={fieldError('cliffAmount')}
          >
            <input
              id="cliffAmount"
              type="text"
              inputMode="decimal"
              value={cliffAmount}
              onChange={(e) => setCliffAmount(e.target.value)}
              placeholder="0.0 (optional, defaults to 0)"
              aria-invalid={Boolean(fieldError('cliffAmount'))}
              className={inputClass(Boolean(fieldError('cliffAmount')))}
            />
          </Field>
        </div>

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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cliff duration (days)" htmlFor="cliffDays" error={fieldError('cliffDuration')}>
            <input
              id="cliffDays"
              type="number"
              min={0}
              value={cliffDays}
              onChange={(e) => setCliffDays(e.target.value)}
              aria-invalid={Boolean(fieldError('cliffDuration'))}
              className={inputClass(Boolean(fieldError('cliffDuration')))}
            />
          </Field>
          <Field label="Total duration (days)" htmlFor="totalDays" error={fieldError('totalDuration')}>
            <input
              id="totalDays"
              type="number"
              min={1}
              value={totalDays}
              onChange={(e) => setTotalDays(e.target.value)}
              aria-invalid={Boolean(fieldError('totalDuration'))}
              className={inputClass(Boolean(fieldError('totalDuration')))}
            />
          </Field>
        </div>

        <Field label="Label" htmlFor="label" error={fieldError('label')}>
          <div className="flex flex-wrap gap-2">
            {VESTING_LABELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLabel(l)}
                aria-pressed={label === l}
                className={[
                  'rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors',
                  label === l
                    ? 'border-stellar-primary bg-stellar-primary/10 text-white'
                    : 'border-stellar-border text-gray-300 hover:border-stellar-primary',
                ].join(' ')}
              >
                {l}
              </button>
            ))}
          </div>
          {label === 'custom' && (
            <input
              id="label"
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="e.g. advisor-2026"
              maxLength={9}
              className={`mt-2 ${inputClass(Boolean(fieldError('label')))}`}
            />
          )}
        </Field>

        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={revocable}
            onChange={(e) => setRevocable(e.target.checked)}
            className="h-4 w-4 rounded border-stellar-border bg-stellar-dark text-stellar-primary focus:ring-stellar-primary"
          />
          Revocable — you can revoke this schedule later and reclaim unvested tokens
        </label>

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

        {validation.amountStroops !== null && totalDurationSeconds > 0 && (
          <div className="rounded-lg border border-stellar-border bg-stellar-dark/40 p-4 text-sm">
            <p className="mb-2 flex items-center gap-2 font-medium text-white">
              <Info className="h-4 w-4 text-stellar-secondary" aria-hidden="true" />
              Schedule preview
            </p>
            <dl className="grid grid-cols-2 gap-y-1 text-gray-300">
              <dt className="text-gray-400">Total</dt>
              <dd className="text-right font-mono text-white">
                {formatAmount(validation.amountStroops, DECIMALS)}
              </dd>
              <dt className="text-gray-400">Unlocks at cliff</dt>
              <dd className="text-right font-mono text-white">
                {formatAmount(validation.cliffAmountStroops ?? 0n, DECIMALS)}
              </dd>
              <dt className="text-gray-400">Cliff</dt>
              <dd className="text-right font-mono text-white">{formatDuration(cliffDurationSeconds)}</dd>
              <dt className="text-gray-400">Full vest</dt>
              <dd className="text-right font-mono text-white">{formatDuration(totalDurationSeconds)}</dd>
            </dl>
          </div>
        )}

        {!address && (
          <p className="text-sm text-stellar-warning" role="alert">
            Connect your wallet to create a schedule.
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
            Creating this schedule transfers the full amount from your wallet to the contract up
            front. The beneficiary claims vested tokens over time; if revocable, you can revoke to
            reclaim the unvested remainder.
          </p>
          <dl className="grid grid-cols-2 gap-y-1.5">
            <dt className="text-gray-400">Beneficiary</dt>
            <dd className="text-right font-mono text-white">{truncateAddress(beneficiary.trim())}</dd>
            <dt className="text-gray-400">Total to fund</dt>
            <dd className="text-right font-mono text-white">
              {validation.amountStroops !== null
                ? formatAmount(validation.amountStroops, DECIMALS)
                : '—'}
            </dd>
            <dt className="text-gray-400">Cliff / full vest</dt>
            <dd className="text-right font-mono text-white">
              {formatDuration(cliffDurationSeconds)} / {formatDuration(totalDurationSeconds)}
            </dd>
            <dt className="text-gray-400">Revocable</dt>
            <dd className="text-right font-mono text-white">{revocable ? 'Yes' : 'No'}</dd>
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
