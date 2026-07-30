'use client'

/**
 * Vesting schedule list with "As Beneficiary" / "As Grantor" tabs. Renders
 * ScheduleCards and handles empty/loading states. Keyboard-accessible tab
 * controls.
 */

import { useMemo, useState } from 'react'
import { Inbox, RefreshCw, Send } from 'lucide-react'
import type { ScheduleWithRole, TxState } from '@/hooks/useVesting'
import type { VestingProgressData } from '@/lib/vestingContract'
import ScheduleCard from './ScheduleCard'

type Tab = 'beneficiary' | 'grantor'

interface ScheduleListProps {
  schedules: ScheduleWithRole[]
  account: string
  isLoading: boolean
  error: string | null
  txState: TxState
  resetTx: () => void
  refresh: () => void
  getProgress: (scheduleId: number) => Promise<VestingProgressData | null>
  onClaim: (scheduleId: number) => Promise<{ ok: boolean }>
  onRevoke: (scheduleId: number) => Promise<{ ok: boolean }>
}

export default function ScheduleList({
  schedules,
  account,
  isLoading,
  error,
  txState,
  resetTx,
  refresh,
  getProgress,
  onClaim,
  onRevoke,
}: ScheduleListProps) {
  const [tab, setTab] = useState<Tab>('beneficiary')

  const asBeneficiary = useMemo(
    () => schedules.filter((s) => s.role === 'beneficiary' || s.role === 'both'),
    [schedules],
  )
  const asGrantor = useMemo(
    () => schedules.filter((s) => s.role === 'grantor' || s.role === 'both'),
    [schedules],
  )

  const list = tab === 'grantor' ? asGrantor : asBeneficiary

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div role="tablist" aria-label="Schedule role" className="flex gap-2">
          <TabButton
            active={tab === 'beneficiary'}
            onClick={() => setTab('beneficiary')}
            id="tab-beneficiary"
            controls="panel-beneficiary"
          >
            <Inbox className="h-4 w-4" aria-hidden="true" />
            As Beneficiary ({asBeneficiary.length})
          </TabButton>
          <TabButton
            active={tab === 'grantor'}
            onClick={() => setTab('grantor')}
            id="tab-grantor"
            controls="panel-grantor"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            As Grantor ({asGrantor.length})
          </TabButton>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading}
          aria-label="Refresh schedules"
          className="inline-flex items-center gap-2 rounded-lg border border-stellar-border px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-stellar-primary disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-stellar-accent/40 bg-stellar-accent/10 p-3 text-sm text-stellar-accent">
          {error}
        </p>
      )}

      <div
        role="tabpanel"
        id={tab === 'grantor' ? 'panel-grantor' : 'panel-beneficiary'}
        aria-labelledby={tab === 'grantor' ? 'tab-grantor' : 'tab-beneficiary'}
      >
        {isLoading && schedules.length === 0 ? (
          <EmptyState message="Loading schedules…" />
        ) : list.length === 0 ? (
          <EmptyState
            message={
              tab === 'grantor'
                ? 'You have not created any vesting schedules yet.'
                : 'No vesting schedules have been created for you yet.'
            }
          />
        ) : (
          <div className="grid gap-4">
            {list.map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                account={account}
                txState={txState}
                resetTx={resetTx}
                getProgress={getProgress}
                onClaim={onClaim}
                onRevoke={onRevoke}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  id,
  controls,
  children,
}: {
  active: boolean
  onClick: () => void
  id: string
  controls: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={[
        'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-stellar-primary text-white'
          : 'border border-stellar-border text-gray-300 hover:border-stellar-primary',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stellar-border p-12 text-center text-gray-500">
      {message}
    </div>
  )
}
