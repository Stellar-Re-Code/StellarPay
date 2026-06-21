'use client'

/**
 * Stream list with "Sent" / "Received" tabs. Renders StreamCards and handles
 * empty/loading states. Keyboard-accessible tab controls.
 */

import { useMemo, useState } from 'react'
import { Inbox, RefreshCw, Send } from 'lucide-react'
import type { StreamWithRole, TxState } from '@/hooks/usePayrollStream'
import StreamCard from './StreamCard'

type Tab = 'sent' | 'received'

interface StreamListProps {
  streams: StreamWithRole[]
  account: string
  isLoading: boolean
  error: string | null
  txState: TxState
  resetTx: () => void
  refresh: () => void
  getClaimable: (streamId: number) => Promise<bigint>
  onClaim: (streamId: number) => Promise<{ ok: boolean }>
  onCancel: (streamId: number) => Promise<{ ok: boolean }>
}

export default function StreamList({
  streams,
  account,
  isLoading,
  error,
  txState,
  resetTx,
  refresh,
  getClaimable,
  onClaim,
  onCancel,
}: StreamListProps) {
  const [tab, setTab] = useState<Tab>('received')

  const sent = useMemo(
    () => streams.filter((s) => s.role === 'sent' || s.role === 'both'),
    [streams],
  )
  const received = useMemo(
    () => streams.filter((s) => s.role === 'received' || s.role === 'both'),
    [streams],
  )

  const list = tab === 'sent' ? sent : received

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div role="tablist" aria-label="Stream direction" className="flex gap-2">
          <TabButton
            active={tab === 'received'}
            onClick={() => setTab('received')}
            id="tab-received"
            controls="panel-received"
          >
            <Inbox className="h-4 w-4" aria-hidden="true" />
            Received ({received.length})
          </TabButton>
          <TabButton
            active={tab === 'sent'}
            onClick={() => setTab('sent')}
            id="tab-sent"
            controls="panel-sent"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Sent ({sent.length})
          </TabButton>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading}
          aria-label="Refresh streams"
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
        id={tab === 'sent' ? 'panel-sent' : 'panel-received'}
        aria-labelledby={tab === 'sent' ? 'tab-sent' : 'tab-received'}
      >
        {isLoading && streams.length === 0 ? (
          <EmptyState message="Loading streams…" />
        ) : list.length === 0 ? (
          <EmptyState
            message={
              tab === 'sent'
                ? 'You have not created any streams yet.'
                : 'No streams have been sent to you yet.'
            }
          />
        ) : (
          <div className="grid gap-4">
            {list.map((stream) => (
              <StreamCard
                key={stream.id}
                stream={stream}
                account={account}
                txState={txState}
                resetTx={resetTx}
                getClaimable={getClaimable}
                onClaim={onClaim}
                onCancel={onCancel}
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
