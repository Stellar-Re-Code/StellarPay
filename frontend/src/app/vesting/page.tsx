'use client'

import { AlertTriangle } from 'lucide-react'
import { useWallet } from '@/components/WalletProvider'
import { useVesting } from '@/hooks/useVesting'
import CreateScheduleForm from '@/components/CreateScheduleForm'
import ScheduleList from '@/components/ScheduleList'
import WalletButton from '@/components/WalletButton'

export default function VestingPage() {
  const { address, isConnected } = useWallet()
  const {
    schedules,
    isLoading,
    error,
    configured,
    txState,
    resetTx,
    refresh,
    loadMore,
    hasMore,
    claim,
    revoke,
    getProgress,
  } = useVesting()

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      <header className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-white">⏳ Token Vesting</h1>
        <p className="text-gray-400">
          Create and manage cliff + linear vesting schedules for team members, advisors, and
          investors. Beneficiaries claim vested tokens as they accrue; revocable schedules let the
          grantor reclaim the unvested remainder.
        </p>
      </header>

      {!configured && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-stellar-warning/40 bg-stellar-warning/10 p-4 text-sm text-stellar-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            The vesting contract id is not configured. Set
            <code className="mx-1 rounded bg-stellar-dark px-1 py-0.5 font-mono">
              NEXT_PUBLIC_VESTING_CONTRACT_ID
            </code>
            to enable on-chain actions.
          </span>
        </div>
      )}

      {!isConnected ? (
        <div className="rounded-2xl border border-stellar-border bg-stellar-surface p-12 text-center">
          <p className="mb-4 text-gray-400">Connect your Freighter wallet to get started.</p>
          <div className="flex justify-center">
            <WalletButton />
          </div>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            <CreateScheduleForm onCreated={refresh} />
          </div>
          <div>
            <h2 className="mb-4 text-xl font-semibold text-white">Your vesting schedules</h2>
            <ScheduleList
              schedules={schedules}
              account={address ?? ''}
              isLoading={isLoading}
              error={error}
              txState={txState}
              resetTx={resetTx}
              refresh={refresh}
              loadMore={loadMore}
              hasMore={hasMore}
              getProgress={getProgress}
              onClaim={claim}
              onRevoke={revoke}
            />
          </div>
        </div>
      )}
    </div>
  )
}
