'use client'

/**
 * Wallet connect button. Renders distinct states:
 *  - not installed: link to install Freighter
 *  - disconnected: "Connect Wallet"
 *  - connecting:   spinner + "Connecting…"
 *  - connected:    truncated address + disconnect
 *  - error:        message + retry
 */

import { useState } from 'react'
import { Loader2, LogOut, Wallet, AlertCircle, ChevronDown } from 'lucide-react'
import { useWallet } from './WalletProvider'
import { truncateAddress } from '@/lib/format'

export default function WalletButton() {
  const { address, isConnecting, isInstalled, error, connect, disconnect } = useWallet()
  const [menuOpen, setMenuOpen] = useState(false)

  if (isInstalled === false) {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-2 rounded-lg border border-stellar-border bg-stellar-surface px-4 py-2 text-sm font-medium text-stellar-warning transition-colors hover:border-stellar-warning"
      >
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        Install Freighter
      </a>
    )
  }

  if (isConnecting) {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        className="inline-flex items-center gap-2 rounded-lg bg-stellar-primary/70 px-4 py-2 text-sm font-medium text-white"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Connecting…
      </button>
    )
  }

  if (address) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="inline-flex items-center gap-2 rounded-lg border border-stellar-border bg-stellar-surface px-4 py-2 text-sm font-medium text-white transition-colors hover:border-stellar-primary"
        >
          <span className="h-2 w-2 rounded-full bg-stellar-success" aria-hidden="true" />
          <span className="font-mono">{truncateAddress(address)}</span>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-44 rounded-lg border border-stellar-border bg-stellar-surface p-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                disconnect()
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-stellar-accent transition-colors hover:bg-stellar-accent/10"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Disconnect
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={connect}
        className="inline-flex items-center gap-2 rounded-lg bg-stellar-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stellar-primary/90"
      >
        <Wallet className="h-4 w-4" aria-hidden="true" />
        {error ? 'Retry Connect' : 'Connect Wallet'}
      </button>
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs text-stellar-accent">
          {error}
        </p>
      )}
    </div>
  )
}
