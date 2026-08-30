'use client'

/**
 * Hook wiring the UI to the vesting contract layer.
 *
 * Exposes the connected account's schedules (as grantor + as beneficiary,
 * deduped, full data), loading/error state, a refresh action, and the
 * create/claim/revoke mutations. Mutations drive the same explicit
 * transaction-state machine as usePayrollStream, so each phase renders
 * distinctly and a failed tx never shows success.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from '@/components/WalletProvider'
import {
  createSchedule as createScheduleCall,
  claim as claimCall,
  revoke as revokeCall,
  getSchedule,
  getProgress as getProgressCall,
  getSchedulesByGrantorPage,
  getSchedulesByBeneficiaryPage,
  type VestingScheduleData,
  type VestingProgressData,
} from '@/lib/vestingContract'
import { isVestingContractConfigured } from '@/lib/network'
import { toFriendlyVestingError } from '@/lib/errors'
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
  /** Identifies which operation/schedule the state belongs to (for per-row UI). */
  context: string | null
}

export interface ScheduleWithRole extends VestingScheduleData {
  /** Whether the connected account is the grantor, beneficiary, or both. */
  role: 'grantor' | 'beneficiary' | 'both'
}

const IDLE: TxState = { phase: 'idle', message: '', hash: null, context: null }
const PAGE_SIZE = 20

const PHASE_MESSAGES: Record<Exclude<TxPhase, 'idle' | 'success' | 'failed'>, string> = {
  simulating: 'Simulating transaction…',
  'awaiting-signature': 'Waiting for you to sign in Freighter…',
  submitting: 'Submitting transaction to the network…',
  confirming: 'Confirming on-chain…',
}

export function useVesting() {
  const { address, isConnected } = useWallet()
  const [schedules, setSchedules] = useState<ScheduleWithRole[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txState, setTxState] = useState<TxState>(IDLE)
  const [grantorCursor, setGrantorCursor] = useState(0)
  const [beneficiaryCursor, setBeneficiaryCursor] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const requestId = useRef(0)

  const configured = isVestingContractConfigured()

  const loadPage = useCallback(async (grantorPageCursor: number, beneficiaryPageCursor: number, replace: boolean) => {
    if (!address || !configured) {
      setSchedules([])
      setHasMore(false)
      return
    }
    const currentRequest = ++requestId.current
    setIsLoading(true)
    setError(null)
    try {
      const [grantorPage, beneficiaryPage] = await Promise.all([
        getSchedulesByGrantorPage(address, address, grantorPageCursor, PAGE_SIZE),
        getSchedulesByBeneficiaryPage(address, address, beneficiaryPageCursor, PAGE_SIZE),
      ])
      const grantorSet = new Set(grantorPage.scheduleIds)
      const beneficiarySet = new Set(beneficiaryPage.scheduleIds)
      const allIds = Array.from(new Set([...grantorPage.scheduleIds, ...beneficiaryPage.scheduleIds]))
      const fetched = await Promise.all(allIds.map((id) => getSchedule(address, id)))
      const withRole: ScheduleWithRole[] = fetched.map((s) => {
        const isGrantor = grantorSet.has(s.id)
        const isBeneficiary = beneficiarySet.has(s.id)
        const role: ScheduleWithRole['role'] =
          isGrantor && isBeneficiary ? 'both' : isGrantor ? 'grantor' : 'beneficiary'
        return { ...s, role }
      })
      if (currentRequest !== requestId.current) return
      setGrantorCursor(grantorPage.nextCursor)
      setBeneficiaryCursor(beneficiaryPage.nextCursor)
      setHasMore(grantorPage.nextCursor !== 0 || beneficiaryPage.nextCursor !== 0)
      setSchedules((previous) => {
        const merged = new Map<number, ScheduleWithRole>(replace ? [] : previous.map((schedule) => [schedule.id, schedule]))
        for (const schedule of withRole) {
          const existing = merged.get(schedule.id)
          const role = existing && existing.role !== schedule.role ? 'both' : schedule.role
          merged.set(schedule.id, { ...schedule, role })
        }
        return Array.from(merged.values()).sort((a, b) => b.id - a.id)
      })
    } catch (e) {
      if (currentRequest === requestId.current) setError(toFriendlyVestingError(e))
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false)
    }
  }, [address, configured])

  const refresh = useCallback(async () => {
    setGrantorCursor(0)
    setBeneficiaryCursor(0)
    await loadPage(0, 0, true)
  }, [loadPage])

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return
    await loadPage(grantorCursor, beneficiaryCursor, false)
  }, [beneficiaryCursor, grantorCursor, hasMore, isLoading, loadPage])

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

  const createSchedule = useCallback(
    async (params: {
      beneficiary: string
      token: string
      totalAmount: bigint
      startTime: number
      cliffDuration: number
      cliffAmount: bigint
      totalDuration: number
      label: string
      revocable: boolean
    }): Promise<{ ok: boolean; scheduleId?: number; hash?: string }> => {
      if (!address) {
        setTxState({ phase: 'failed', message: 'Connect your wallet first.', hash: null, context: 'create' })
        return { ok: false }
      }
      try {
        const result = await createScheduleCall(address, params, makeHandlers('create'))
        setTxState({
          phase: 'success',
          message: `Schedule #${result.returnValue} created successfully.`,
          hash: result.hash,
          context: 'create',
        })
        await refresh()
        return { ok: true, scheduleId: result.returnValue, hash: result.hash }
      } catch (e) {
        setTxState({ phase: 'failed', message: toFriendlyVestingError(e), hash: null, context: 'create' })
        return { ok: false }
      }
    },
    [address, makeHandlers, refresh],
  )

  const claim = useCallback(
    async (scheduleId: number): Promise<{ ok: boolean; amount?: bigint; hash?: string }> => {
      if (!address) {
        setTxState({
          phase: 'failed',
          message: 'Connect your wallet first.',
          hash: null,
          context: `claim:${scheduleId}`,
        })
        return { ok: false }
      }
      const context = `claim:${scheduleId}`
      try {
        const result = await claimCall(address, scheduleId, makeHandlers(context))
        setTxState({
          phase: 'success',
          message: 'Claim confirmed. Vested tokens have been transferred to your wallet.',
          hash: result.hash,
          context,
        })
        await refresh()
        return { ok: true, amount: result.returnValue, hash: result.hash }
      } catch (e) {
        setTxState({ phase: 'failed', message: toFriendlyVestingError(e), hash: null, context })
        return { ok: false }
      }
    },
    [address, makeHandlers, refresh],
  )

  const revoke = useCallback(
    async (scheduleId: number): Promise<{ ok: boolean; unvested?: bigint; hash?: string }> => {
      if (!address) {
        setTxState({
          phase: 'failed',
          message: 'Connect your wallet first.',
          hash: null,
          context: `revoke:${scheduleId}`,
        })
        return { ok: false }
      }
      const context = `revoke:${scheduleId}`
      try {
        const result = await revokeCall(address, scheduleId, makeHandlers(context))
        setTxState({
          phase: 'success',
          message: 'Schedule revoked. The unvested remainder has been returned to you.',
          hash: result.hash,
          context,
        })
        await refresh()
        return { ok: true, unvested: result.returnValue, hash: result.hash }
      } catch (e) {
        setTxState({ phase: 'failed', message: toFriendlyVestingError(e), hash: null, context })
        return { ok: false }
      }
    },
    [address, makeHandlers, refresh],
  )

  const getProgress = useCallback(
    async (scheduleId: number): Promise<VestingProgressData | null> => {
      if (!address) return null
      return getProgressCall(address, scheduleId)
    },
    [address],
  )

  return useMemo(
    () => ({
      schedules,
      isLoading,
      error,
      isConnected,
      configured,
      txState,
      resetTx,
      refresh,
      loadMore,
      hasMore,
      createSchedule,
      claim,
      revoke,
      getProgress,
    }),
    [
      schedules,
      isLoading,
      error,
      isConnected,
      configured,
      txState,
      resetTx,
      refresh,
      loadMore,
      hasMore,
      createSchedule,
      claim,
      revoke,
      getProgress,
    ],
  )
}
