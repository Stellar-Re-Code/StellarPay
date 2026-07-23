'use client'

/**
 * A single vesting schedule row/card (FE-17). Shows immutable terms, status
 * badge, cliff countdown, a vested/total progress bar, claimed/claimable/
 * remaining stats, explorer links, and the appropriate action (claim for
 * beneficiaries, revoke for grantors when revocable). Polls get_progress
 * every ~3s while the schedule is active.
 */

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import type { ScheduleWithRole, TxState } from '@/hooks/useVesting'
import type { VestingProgressData } from '@/lib/vestingContract'
import {
  STELLAR_DECIMALS,
  explorerAccountUrl,
  explorerContractUrl,
  formatAmount,
  formatDuration,
  formatTimestamp,
  truncateAddress,
} from '@/lib/format'
import ClaimScheduleModal from './ClaimScheduleModal'
import RevokeScheduleModal from './RevokeScheduleModal'

const DECIMALS = STELLAR_DECIMALS
const POLL_MS = 3000

const STATUS_STYLES: Record<ScheduleWithRole['status'], string> = {
  Active: 'bg-stellar-success/15 text-stellar-success border-stellar-success/40',
  Revoked: 'bg-stellar-accent/15 text-stellar-accent border-stellar-accent/40',
  FullyClaimed: 'bg-stellar-secondary/15 text-stellar-secondary border-stellar-secondary/40',
}

interface ScheduleCardProps {
  schedule: ScheduleWithRole
  account: string
  txState: TxState
  resetTx: () => void
  getProgress: (scheduleId: number) => Promise<VestingProgressData | null>
  onClaim: (scheduleId: number) => Promise<{ ok: boolean }>
  onRevoke: (scheduleId: number) => Promise<{ ok: boolean }>
}

export default function ScheduleCard({
  schedule,
  account,
  txState,
  resetTx,
  getProgress,
  onClaim,
  onRevoke,
}: ScheduleCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [progress, setProgress] = useState<VestingProgressData | null>(null)
  const [claimOpen, setClaimOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1000))

  const isGrantor = account === schedule.grantor
  const isBeneficiary = account === schedule.beneficiary
  const isActive = schedule.status === 'Active'

  const poll = useCallback(async () => {
    try {
      const p = await getProgress(schedule.id)
      setProgress(p)
    } catch {
      // Leave previous value; transient RPC errors shouldn't blank the UI.
    }
  }, [getProgress, schedule.id])

  useEffect(() => {
    void poll()
    if (!isActive) return
    const interval = setInterval(() => void poll(), POLL_MS)
    return () => clearInterval(interval)
  }, [poll, isActive])

  // Local clock tick so the cliff countdown counts down without waiting on
  // the next progress poll.
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => setNowUnix(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(interval)
  }, [isActive])

  const cliffAt = schedule.startTime + schedule.cliffDuration
  const beforeCliff = nowUnix < cliffAt
  const cliffRemainingSeconds = Math.max(0, cliffAt - nowUnix)

  const vested = progress?.vestedAmount ?? 0n
  const claimable = progress?.claimableAmount ?? null
  const claimed = progress?.claimedAmount ?? schedule.claimedAmount
  const total = progress?.totalAmount ?? schedule.totalAmount
  const remaining = total - vested
  const unvested = total - vested

  const progressPct = total > 0n ? Number((vested * 10000n) / total) / 100 : 0

  return (
    <div className="rounded-2xl border border-stellar-border bg-stellar-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-gray-400">Schedule #{schedule.id}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[schedule.status]}`}
            >
              {schedule.status}
            </span>
            <span className="rounded-full border border-stellar-border px-2 py-0.5 text-xs capitalize text-gray-400">
              {schedule.label}
            </span>
            <span className="rounded-full border border-stellar-border px-2 py-0.5 text-xs text-gray-400">
              {schedule.role === 'both' ? 'Grantor & Beneficiary' : schedule.role === 'grantor' ? 'Grantor' : 'Beneficiary'}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {isGrantor ? 'To' : 'From'}{' '}
            <a
              href={explorerAccountUrl(isGrantor ? schedule.beneficiary : schedule.grantor)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-stellar-secondary hover:underline"
            >
              {truncateAddress(isGrantor ? schedule.beneficiary : schedule.grantor)}
            </a>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse schedule details' : 'Expand schedule details'}
          className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ChevronDown
            className={`h-5 w-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {isActive && beforeCliff && (
        <p className="mt-3 text-xs text-stellar-warning">
          Cliff in {formatDuration(cliffRemainingSeconds)} — nothing vests until then.
        </p>
      )}

      {/* Progress */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-gray-400">
          <span>{progressPct.toFixed(1)}% vested</span>
          <span className="font-mono">
            {formatAmount(vested, DECIMALS)} / {formatAmount(total, DECIMALS)}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-stellar-dark"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPct)}
        >
          <div
            className="h-full rounded-full bg-stellar-primary transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Stat label="Claimed" value={formatAmount(claimed, DECIMALS)} />
        <Stat
          label="Claimable"
          value={claimable === null ? '…' : formatAmount(claimable, DECIMALS)}
          highlight
        />
        <Stat label="Not yet vested" value={formatAmount(remaining < 0n ? 0n : remaining, DECIMALS)} />
      </div>

      {expanded && (
        <dl className="mt-4 grid grid-cols-1 gap-y-1.5 border-t border-stellar-border pt-4 text-sm sm:grid-cols-2 sm:gap-x-6">
          <Detail label="Grantor">
            <ExplorerAddr addr={schedule.grantor} />
          </Detail>
          <Detail label="Beneficiary">
            <ExplorerAddr addr={schedule.beneficiary} />
          </Detail>
          <Detail label="Token">
            <a
              href={explorerContractUrl(schedule.token)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-mono text-stellar-secondary hover:underline"
            >
              {truncateAddress(schedule.token)}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </Detail>
          <Detail label="Cliff unlock">{formatAmount(schedule.cliffAmount, DECIMALS)}</Detail>
          <Detail label="Start">{formatTimestamp(schedule.startTime)}</Detail>
          <Detail label="Cliff ends">{formatTimestamp(cliffAt)}</Detail>
          <Detail label="Fully vests">
            {formatTimestamp(schedule.startTime + schedule.totalDuration)}
          </Detail>
          <Detail label="Revocable">{schedule.revocable ? 'Yes' : 'No'}</Detail>
        </dl>
      )}

      {/* Actions */}
      {isActive && (isBeneficiary || (isGrantor && schedule.revocable)) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {isBeneficiary && (
            <button
              type="button"
              onClick={() => {
                resetTx()
                setClaimOpen(true)
              }}
              className="rounded-lg bg-stellar-success px-4 py-2 text-sm font-medium text-stellar-dark transition-colors hover:bg-stellar-success/90"
            >
              Claim
            </button>
          )}
          {isGrantor && schedule.revocable && (
            <button
              type="button"
              onClick={() => {
                resetTx()
                setRevokeOpen(true)
              }}
              className="rounded-lg border border-stellar-accent px-4 py-2 text-sm font-medium text-stellar-accent transition-colors hover:bg-stellar-accent/10"
            >
              Revoke schedule
            </button>
          )}
        </div>
      )}

      <ClaimScheduleModal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        scheduleId={schedule.id}
        claimable={claimable}
        beforeCliff={beforeCliff}
        cliffRemainingSeconds={cliffRemainingSeconds}
        decimals={DECIMALS}
        txState={txState}
        onConfirm={onClaim}
      />
      <RevokeScheduleModal
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        scheduleId={schedule.id}
        beneficiary={schedule.beneficiary}
        vestedAmount={vested}
        unvestedAmount={unvested < 0n ? 0n : unvested}
        decimals={DECIMALS}
        txState={txState}
        onConfirm={onRevoke}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="rounded-lg bg-stellar-dark/40 p-2.5">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`font-mono ${highlight ? 'text-stellar-success' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 sm:block">
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-white">{children}</dd>
    </div>
  )
}

function ExplorerAddr({ addr }: { addr: string }) {
  return (
    <a
      href={explorerAccountUrl(addr)}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-mono text-stellar-secondary hover:underline"
    >
      {truncateAddress(addr)}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  )
}
