'use client'

/**
 * Hook wiring the UI to the payroll_stream contract layer.
 *
 * Exposes the connected account's streams (sent + received, deduped, full
 * data), loading/error state, a refresh action, and the create/claim/cancel
 * mutations. Mutations drive an explicit transaction-state machine so the UI
 * can render each phase distinctly and never show success for a failed tx.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '@/components/WalletProvider'
import {
  createStream as createStreamCall,
  claim as claimCall,
  cancelStream as cancelStreamCall,
  getStream,
  getClaimable as getClaimableCall,
  getStreamsBySender,
  getStreamsByRecipient,
  type PayrollStreamData,
} from '@/lib/payrollContract'
import { isPayrollContractConfigured } from '@/lib/network'
import { toFriendlyError } from '@/lib/errors'
import type { InvokeHandlers } from '@/lib/payrollContract'

export type TxPhase =
  | 'idle'
  | 'simulating'
  | 'awaiting-signature'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'failed'

export interface TxState {
  phase: TxPhase
  message: string
  hash: string | null
  /** Identifies which operation/stream the state belongs to (for per-row UI). */
  context: string | null
}

export interface StreamWithRole extends PayrollStreamData {
  /** Whether the connected account is the sender, recipient, or both. */
  role: 'sent' | 'received' | 'both'
}

const IDLE: TxState = { phase: 'idle', message: '', hash: null, context: null }

const PHASE_MESSAGES: Record<Exclude<TxPhase, 'idle' | 'success' | 'failed'>, string> = {
  simulating: 'Simulating transaction…',
  'awaiting-signature': 'Waiting for you to sign in Freighter…',
  submitting: 'Submitting transaction to the network…',
  confirming: 'Confirming on-chain…',
}

export function usePayrollStream() {
  const { address, isConnected } = useWallet()
  const [streams, setStreams] = useState<StreamWithRole[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txState, setTxState] = useState<TxState>(IDLE)

  const configured = isPayrollContractConfigured()

  const refresh = useCallback(async () => {
    if (!address || !configured) {
      setStreams([])
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const [sentIds, receivedIds] = await Promise.all([
        getStreamsBySender(address, address),
        getStreamsByRecipient(address, address),
      ])
      const sentSet = new Set(sentIds)
      const recvSet = new Set(receivedIds)
      const allIds = Array.from(new Set([...sentIds, ...receivedIds]))
      const fetched = await Promise.all(allIds.map((id) => getStream(address, id)))
      const withRole: StreamWithRole[] = fetched.map((s) => {
        const isSent = sentSet.has(s.id)
        const isRecv = recvSet.has(s.id)
        const role: StreamWithRole['role'] = isSent && isRecv ? 'both' : isSent ? 'sent' : 'received'
        return { ...s, role }
      })
      withRole.sort((a, b) => b.id - a.id)
      setStreams(withRole)
    } catch (e) {
      setError(toFriendlyError(e))
    } finally {
      setIsLoading(false)
    }
  }, [address, configured])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const makeHandlers = useCallback(
    (context: string): InvokeHandlers => ({
      onSimulating: () =>
        setTxState({ phase: 'simulating', message: PHASE_MESSAGES.simulating, hash: null, context }),
      onAwaitingSignature: () =>
        setTxState({
          phase: 'awaiting-signature',
          message: PHASE_MESSAGES['awaiting-signature'],
          hash: null,
          context,
        }),
      onSubmitting: () =>
        setTxState({ phase: 'submitting', message: PHASE_MESSAGES.submitting, hash: null, context }),
      onConfirming: (hash: string) =>
        setTxState({ phase: 'confirming', message: PHASE_MESSAGES.confirming, hash, context }),
    }),
    [],
  )

  const resetTx = useCallback(() => setTxState(IDLE), [])

  const createStream = useCallback(
    async (params: {
      recipient: string
      token: string
      totalAmount: bigint
      startTime: number
      endTime: number
    }): Promise<{ ok: boolean; streamId?: number; hash?: string }> => {
      if (!address) {
        setTxState({ phase: 'failed', message: 'Connect your wallet first.', hash: null, context: 'create' })
        return { ok: false }
      }
      try {
        const result = await createStreamCall(address, params, makeHandlers('create'))
        setTxState({
          phase: 'success',
          message: `Stream #${result.returnValue} created successfully.`,
          hash: result.hash,
          context: 'create',
        })
        await refresh()
        return { ok: true, streamId: result.returnValue, hash: result.hash }
      } catch (e) {
        setTxState({ phase: 'failed', message: toFriendlyError(e), hash: null, context: 'create' })
        return { ok: false }
      }
    },
    [address, makeHandlers, refresh],
  )

  const claim = useCallback(
    async (streamId: number): Promise<{ ok: boolean; amount?: bigint; hash?: string }> => {
      if (!address) {
        setTxState({ phase: 'failed', message: 'Connect your wallet first.', hash: null, context: `claim:${streamId}` })
        return { ok: false }
      }
      const context = `claim:${streamId}`
      try {
        const result = await claimCall(address, streamId, makeHandlers(context))
        setTxState({
          phase: 'success',
          message: 'Claim confirmed. Funds have been transferred to your wallet.',
          hash: result.hash,
          context,
        })
        await refresh()
        return { ok: true, amount: result.returnValue, hash: result.hash }
      } catch (e) {
        setTxState({ phase: 'failed', message: toFriendlyError(e), hash: null, context })
        return { ok: false }
      }
    },
    [address, makeHandlers, refresh],
  )

  const cancel = useCallback(
    async (streamId: number): Promise<{ ok: boolean; hash?: string }> => {
      if (!address) {
        setTxState({ phase: 'failed', message: 'Connect your wallet first.', hash: null, context: `cancel:${streamId}` })
        return { ok: false }
      }
      const context = `cancel:${streamId}`
      try {
        const result = await cancelStreamCall(address, streamId, makeHandlers(context))
        setTxState({
          phase: 'success',
          message: 'Stream cancelled. Settlement and refund have been transferred on-chain.',
          hash: result.hash,
          context,
        })
        await refresh()
        return { ok: true, hash: result.hash }
      } catch (e) {
        setTxState({ phase: 'failed', message: toFriendlyError(e), hash: null, context })
        return { ok: false }
      }
    },
    [address, makeHandlers, refresh],
  )

  const getClaimable = useCallback(
    async (streamId: number): Promise<bigint> => {
      if (!address) return 0n
      return getClaimableCall(address, streamId)
    },
    [address],
  )

  return useMemo(
    () => ({
      streams,
      isLoading,
      error,
      isConnected,
      configured,
      txState,
      resetTx,
      refresh,
      createStream,
      claim,
      cancel,
      getClaimable,
    }),
    [
      streams,
      isLoading,
      error,
      isConnected,
      configured,
      txState,
      resetTx,
      refresh,
      createStream,
      claim,
      cancel,
      getClaimable,
    ],
  )
}
