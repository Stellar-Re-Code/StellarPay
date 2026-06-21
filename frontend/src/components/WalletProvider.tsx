'use client'

/**
 * Wallet context + provider. Tracks the connected Freighter account and exposes
 * connect/disconnect actions to the whole app. Wrapped around the tree in the
 * root layout.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  connectWallet,
  getAddress,
  isAllowed,
  isFreighterInstalled,
} from '@/lib/wallet'

export interface WalletContextValue {
  address: string | null
  isConnected: boolean
  isConnecting: boolean
  isInstalled: boolean | null
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

const STORAGE_KEY = 'stellarpay.wallet.connected'

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  // On mount: detect Freighter and silently restore a prior session.
  useEffect(() => {
    let active = true
    ;(async () => {
      const installed = await isFreighterInstalled()
      if (!active) return
      setIsInstalled(installed)
      if (!installed) return
      try {
        const previouslyConnected =
          typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1'
        if (previouslyConnected && (await isAllowed())) {
          const pk = await getAddress()
          if (active) setAddress(pk)
        }
      } catch {
        // Silent — user can connect manually.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    setIsConnecting(true)
    try {
      const pk = await connectWallet()
      setAddress(pk)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, '1')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect wallet.')
      setAddress(null)
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setAddress(null)
    setError(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      isConnected: address !== null,
      isConnecting,
      isInstalled,
      error,
      connect,
      disconnect,
    }),
    [address, isConnecting, isInstalled, error, connect, disconnect],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return ctx
}
