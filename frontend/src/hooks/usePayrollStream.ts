'use client'

import { useState, useMemo } from 'react'
import { PayrollClient, TransactionState, CreateStreamParams } from '@/lib/payrollClient'
import { useWallet } from '@/components/WalletProvider'

export function usePayrollStream() {
  const { address } = useWallet()
  const [txState, setTxState] = useState<TransactionState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const client = useMemo(() => new PayrollClient(), [])

  return {
    streams: [],
    isLoading: false,
    txState,
    errorMessage,
    createStream: async (params: CreateStreamParams) => {
      if (!address) throw new Error('Wallet not connected')
      setErrorMessage(null)
      try {
        await client.createStream(address, params, (state, message) => {
          setTxState(state)
          if (message) setErrorMessage(message)
        })
      } catch (err: any) {
        setTxState('error')
        setErrorMessage(err.message || 'Unknown error')
        throw err
      }
    },
    // Placeholders for other methods
    claimFromStream: async (_streamId: string) => {},
    cancelStream: async (_streamId: string) => {},
    getClaimable: async (_streamId: string) => '0',
  }
}

