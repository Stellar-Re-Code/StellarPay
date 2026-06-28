'use client'

/**
 * Top navigation bar with the wallet button. Kept minimal — the focus of
 * issue #33 is the payroll flow.
 */

import Link from 'next/link'
import WalletButton from './WalletButton'

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-stellar-border bg-stellar-dark/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-bold text-white">
          Stellar<span className="text-stellar-primary">Pay</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-gray-300 sm:flex">
          <Link href="/payroll" className="transition-colors hover:text-white">
            Payroll
          </Link>
          <Link href="/treasury" className="transition-colors hover:text-white">
            Treasury
          </Link>
          <Link href="/vesting" className="transition-colors hover:text-white">
            Vesting
          </Link>
          <Link href="/governance" className="transition-colors hover:text-white">
            Governance
          </Link>
        </nav>
        <WalletButton />
      </div>
    </header>
  )
}
