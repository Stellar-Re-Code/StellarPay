'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { isFreighterInstalled, connectWallet } from '@/lib/wallet'
import { NETWORK } from '@/lib/network'
import { getNetworkDetails } from '@stellar/freighter-api'

interface WalletContextType {
  address: string | null
  isConnecting: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Optionally check if already connected and update address on load
    const init = async () => {
      try {
        const installed = await isFreighterInstalled()
        if (installed) {
          // You could try an automatic reconnection here if Freighter supports it without prompts
        }
      } catch (err) {
        console.error(err)
      }
    }
    init()
  }, [])

  const connect = async () => {
    setIsConnecting(true)
    setError(null)
    try {
      const address = await connectWallet()
      if (address) {
        const networkDetails = await getNetworkDetails()
        if (networkDetails.network !== NETWORK.name) {
          throw new Error(`Please switch Freighter to ${NETWORK.name} network`)
        }
        setAddress(address)
      } else {
        throw new Error('User rejected connection')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect wallet')
    } finally {
      setIsConnecting(false)
    }
  }

  const disconnect = () => {
    setAddress(null)
    setError(null)
  }

  return (
    <WalletContext.Provider value={{ address, isConnecting, error, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}
