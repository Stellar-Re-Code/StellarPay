'use client'

/**
 * A single payroll stream row/card. Shows immutable terms, status badge,
 * claimed/accrued/claimable, a progress bar, explorer links, and the
 * appropriate action (claim for recipients, cancel for senders). Polls
 * get_claimable every ~3s while the stream is active.
 */

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import type { StreamWithRole, TxState } from '@/hooks/usePayrollStream'
import { computeCancelSettlement } from '@/lib/validation'
import {
  STELLAR_DECIMALS,
  explorerAccountUrl,
  explorerContractUrl,
  formatAmount,
  formatRatePerSecond,
  formatTimestamp,
  truncateAddress,
} from '@/lib/format'
import ClaimModal from './ClaimModal'
import CancelModal from './CancelModal'

const DECIMALS = STELLAR_DECIMALS
const POLL_MS = 3000

const STATUS_STYLES: Record<StreamWithRole['status'], string> = {
  Active: 'bg-stellar-success/15 text-stellar-success border-stellar-success/40',
  Paused: 'bg-stellar-warning/15 text-stellar-warning border-stellar-warning/40',
  Cancelled: 'bg-stellar-accent/15 text-stellar-accent border-stellar-accent/40',
  Completed: 'bg-stellar-secondary/15 text-stellar-secondary border-stellar-secondary/40',
}

interface StreamCardProps {
  stream: StreamWithRole
  account: string
  txState: TxState
  resetTx: () => void
  getClaimable: (streamId: number) => Promise<bigint>
  onClaim: (streamId: number) => Promise<{ ok: boolean }>
  onCancel: (streamId: number) => Promise<{ ok: boolean }>
}

export default function StreamCard({
  stream,
  account,
  txState,
  resetTx,
  getClaimable,
  onClaim,
  onCancel,
}: StreamCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [claimable, setClaimable] = useState<bigint | null>(null)
  const [claimOpen, setClaimOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const isSender = account === stream.sender
  const isRecipient = account === stream.recipient
  const isActive = stream.status === 'Active'

  const poll = useCallback(async () => {
    try {
      const c = await getClaimable(stream.id)
      setClaimable(c)
    } catch {
      // Leave previous value; transient RPC errors shouldn't blank the UI.
    }
  }, [getClaimable, stream.id])

  useEffect(() => {
    void poll()
    if (!isActive) return
    const interval = setInterval(() => void poll(), POLL_MS)
    return () => clearInterval(interval)
  }, [poll, isActive])

  // Progress is based on the immutable terms (accrued / total) via local math,
  // matching the contract; falls back to claimed when claimable is unknown.
  const accrued = claimable !== null ? stream.claimedAmount + claimable : stream.claimedAmount
  const progressPct =
    stream.totalAmount > 0n
      ? Number((accrued * 10000n) / stream.totalAmount) / 100
      : 0
  const remaining = stream.totalAmount - accrued

  const settlement = computeCancelSettlement({
    totalAmount: stream.totalAmount,
    claimedAmount: stream.claimedAmount,
    startTime: stream.startTime,
    endTime: stream.endTime,
    nowUnix: Math.floor(Date.now() / 1000),
  })

  return (
    <div className="rounded-2xl border border-stellar-border bg-stellar-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-gray-400">Stream #{stream.id}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[stream.status]}`}
            >
              {stream.status}
            </span>
            <span className="rounded-full border border-stellar-border px-2 py-0.5 text-xs text-gray-400">
              {stream.role === 'both' ? 'Sent & Received' : stream.role === 'sent' ? 'Sent' : 'Received'}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {isSender ? 'To' : 'From'}{' '}
            <a
              href={explorerAccountUrl(isSender ? stream.recipient : stream.sender)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-stellar-secondary hover:underline"
            >
              {truncateAddress(isSender ? stream.recipient : stream.sender)}
            </a>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse stream details' : 'Expand stream details'}
          className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ChevronDown
            className={`h-5 w-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Progress */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-gray-400">
          <span>{progressPct.toFixed(1)}% streamed</span>
          <span className="font-mono">
            {formatAmount(accrued, DECIMALS)} / {formatAmount(stream.totalAmount, DECIMALS)}
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
        <Stat label="Claimed" value={formatAmount(stream.claimedAmount, DECIMALS)} />
        <Stat
          label="Claimable"
          value={claimable === null ? '…' : formatAmount(claimable, DECIMALS)}
          highlight
        />
        <Stat label="Remaining" value={formatAmount(remaining < 0n ? 0n : remaining, DECIMALS)} />
      </div>

      {expanded && (
        <dl className="mt-4 grid grid-cols-1 gap-y-1.5 border-t border-stellar-border pt-4 text-sm sm:grid-cols-2 sm:gap-x-6">
          <Detail label="Sender">
            <ExplorerAddr addr={stream.sender} />
          </Detail>
          <Detail label="Recipient">
            <ExplorerAddr addr={stream.recipient} />
          </Detail>
          <Detail label="Token">
            <a
              href={explorerContractUrl(stream.token)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-mono text-stellar-secondary hover:underline"
            >
              {truncateAddress(stream.token)}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </Detail>
          <Detail label="Rate">{formatRatePerSecond(stream.ratePerSecond, DECIMALS)}</Detail>
          <Detail label="Start">{formatTimestamp(stream.startTime)}</Detail>
          <Detail label="End">{formatTimestamp(stream.endTime)}</Detail>
        </dl>
      )}

      {/* Actions */}
      {(isRecipient || isSender) && isActive && (
        <div className="mt-4 flex flex-wrap gap-3">
          {isRecipient && (
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
          {isSender && (
            <button
              type="button"
              onClick={() => {
                resetTx()
                setCancelOpen(true)
              }}
              className="rounded-lg border border-stellar-accent px-4 py-2 text-sm font-medium text-stellar-accent transition-colors hover:bg-stellar-accent/10"
            >
              Cancel stream
            </button>
          )}
        </div>
      )}

      <ClaimModal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        streamId={stream.id}
        claimable={claimable}
        decimals={DECIMALS}
        txState={txState}
        onConfirm={onClaim}
      />
      <CancelModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        streamId={stream.id}
        recipient={stream.recipient}
        settlement={settlement.claimable}
        refund={settlement.refund}
        decimals={DECIMALS}
        txState={txState}
        onConfirm={onCancel}
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
