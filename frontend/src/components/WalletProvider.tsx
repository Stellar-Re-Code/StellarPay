'use client'

/**
 * Wallet context + provider. Tracks the connected Freighter account and exposes
 * connect/disconnect actions to the whole app. Wrapped around the tree in the
 * root layout.
 *
 * Automatically tracks wallet account & network changes via watchWalletChanges,
 * invalidating stale session state and flagging network mismatches.
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
  getNetworkDetails,
  isAllowed,
  isFreighterInstalled,
  validateWalletSession,
  watchWalletChanges,
  type ValidatedSession,
} from '@/lib/wallet'
import { NETWORK } from '@/lib/network'

export interface WalletContextValue {
  address: string | null
  network: string | null
  networkPassphrase: string | null
  isConnected: boolean
  isConnecting: boolean
  isInstalled: boolean | null
  error: string | null
  networkError: string | null
  sessionVersion: number
  connect: () => Promise<void>
  disconnect: () => void
  validateSession: (expectedAddress?: string, expectedPassphrase?: string) => Promise<ValidatedSession>
}

const WalletContext = createContext<WalletContextValue | null>(null)

const STORAGE_KEY = 'stellarpay.wallet.connected'

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [network, setNetwork] = useState<string | null>(null)
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null)
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [sessionVersion, setSessionVersion] = useState(0)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Verify network matches configured dApp network
  const checkNetworkMatch = useCallback((net: string | null, pass: string | null): string | null => {
    if (!net && !pass) return null
    const targetPass = NETWORK.networkPassphrase.trim().toLowerCase()
    const currentPass = (pass || '').trim().toLowerCase()
    const currentNet = (net || '').trim().toLowerCase()

    const matches =
      (currentPass && currentPass === targetPass) ||
      (currentNet && (currentNet === targetPass || targetPass.includes(currentNet) || currentNet.includes(targetPass)))

    if (!matches) {
      return `Wallet is connected to ${net || 'unknown'} network. Expected ${NETWORK.name}. Please switch network in Freighter.`
    }
    return null
  }, [])

  // On mount: detect Freighter, restore prior session, and subscribe to account/network switches
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
          const details = await getNetworkDetails().catch(() => ({ network: '', networkPassphrase: '' }))
          if (active) {
            setAddress(pk)
            setNetwork(details.network)
            setNetworkPassphrase(details.networkPassphrase)
            setNetworkError(checkNetworkMatch(details.network, details.networkPassphrase))
          }
        }
      } catch {
        // Silent restore failure
      }
    })()

    // Subscribe to live wallet changes (account switch, network change, disconnect)
    const unwatch = watchWalletChanges((state) => {
      if (!active) return
      setAddress((prev) => {
        if (prev !== state.address) {
          if (typeof window !== 'undefined') {
            if (state.address) {
              window.localStorage.setItem(STORAGE_KEY, '1')
            } else {
              window.localStorage.removeItem(STORAGE_KEY)
            }
          }
          setSessionVersion((v) => v + 1)
          return state.address
        }
        return prev
      })

      setNetwork(state.network)
      setNetworkPassphrase(state.networkPassphrase)
      setNetworkError(checkNetworkMatch(state.network, state.networkPassphrase))
    })

    return () => {
      active = false
      unwatch()
    }
  }, [checkNetworkMatch])

  const connect = useCallback(async () => {
    setError(null)
    setIsConnecting(true)
    try {
      const pk = await connectWallet()
      const details = await getNetworkDetails().catch(() => ({ network: '', networkPassphrase: '' }))
      setAddress(pk)
      setNetwork(details.network)
      setNetworkPassphrase(details.networkPassphrase)
      setNetworkError(checkNetworkMatch(details.network, details.networkPassphrase))
      setSessionVersion((v) => v + 1)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, '1')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect wallet.')
      setAddress(null)
      setNetwork(null)
      setNetworkPassphrase(null)
    } finally {
      setIsConnecting(false)
    }
  }, [checkNetworkMatch])

  const disconnect = useCallback(() => {
    setAddress(null)
    setNetwork(null)
    setNetworkPassphrase(null)
    setError(null)
    setNetworkError(null)
    setSessionVersion((v) => v + 1)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const validateSession = useCallback(
    async (expectedAddress?: string, expectedPassphrase?: string) => {
      return await validateWalletSession({
        expectedAddress: expectedAddress || address || undefined,
        expectedPassphrase: expectedPassphrase || NETWORK.networkPassphrase,
      })
    },
    [address],
  )

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      network,
      networkPassphrase,
      isConnected: address !== null,
      isConnecting,
      isInstalled,
      error,
      networkError,
      sessionVersion,
      connect,
      disconnect,
      validateSession,
    }),
    [
      address,
      network,
      networkPassphrase,
      isConnecting,
      isInstalled,
      error,
      networkError,
      sessionVersion,
      connect,
      disconnect,
      validateSession,
    ],
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
