/**
 * Wallet Connect Button Component (scaffold).
 * Contributors: see FE-3 for full implementation.
 *
 * States to implement:
 * - Disconnected: Show "Connect Wallet" button
 * - Connecting: Show spinner/loading state
 * - Connected: Show truncated wallet address
 * - Error: Show error state with retry
 */

'use client'

import { useWallet } from './WalletProvider'

export default function WalletButton() {
  const { address, isConnecting, error, connect, disconnect } = useWallet()

  if (address) {
    const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-300" title={address}>{truncated}</span>
        <button 
          onClick={disconnect}
          className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors"
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-sm text-red-500 max-w-xs truncate" title={error}>{error}</span>}
      <button 
        onClick={connect}
        disabled={isConnecting}
        className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors disabled:opacity-50"
      >
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </button>
    </div>
  )
}
