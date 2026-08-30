'use client'

import { AlertTriangle } from 'lucide-react'
import { useWallet } from '@/components/WalletProvider'
import { usePayrollStream } from '@/hooks/usePayrollStream'
import CreateStreamForm from '@/components/CreateStreamForm'
import StreamList from '@/components/StreamList'
import WalletButton from '@/components/WalletButton'

export default function PayrollPage() {
  const { address, isConnected } = useWallet()
  const {
    streams,
    isLoading,
    error,
    configured,
    txState,
    resetTx,
    refresh,
    loadMore,
    hasMore,
    claim,
    cancel,
    getClaimable,
  } = usePayrollStream()

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      <header className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-white">💸 Payroll Streams</h1>
        <p className="text-gray-400">
          Create and manage continuous payment streams to your team. Recipients claim accrued
          tokens in real time; senders can cancel and reclaim the unstreamed remainder.
        </p>
      </header>

      {!configured && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-stellar-warning/40 bg-stellar-warning/10 p-4 text-sm text-stellar-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            The payroll contract id is not configured. Set
            <code className="mx-1 rounded bg-stellar-dark px-1 py-0.5 font-mono">
              NEXT_PUBLIC_PAYROLL_STREAM_CONTRACT_ID
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
            <CreateStreamForm onCreated={refresh} />
          </div>
          <div>
            <h2 className="mb-4 text-xl font-semibold text-white">Your streams</h2>
            <StreamList
              streams={streams}
              account={address ?? ''}
              isLoading={isLoading}
              error={error}
              txState={txState}
              resetTx={resetTx}
              refresh={refresh}
              loadMore={loadMore}
              hasMore={hasMore}
              getClaimable={getClaimable}
              onClaim={claim}
              onCancel={cancel}
            />
          </div>
        </div>
      )}
    </div>
  )
}
