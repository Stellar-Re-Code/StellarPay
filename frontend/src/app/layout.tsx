import type { Metadata } from 'next'
import '@/styles/globals.css'
import { WalletProvider } from '@/components/WalletProvider'
import SiteHeader from '@/components/SiteHeader'

export const metadata: Metadata = {
  title: 'StellarPay — Decentralized Payroll & Treasury on Stellar',
  description:
    'Manage payroll streaming, token vesting, and multi-sig treasury operations on-chain with Stellar Soroban smart contracts.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <WalletProvider>
          <SiteHeader />
          <main className="min-h-screen">{children}</main>
        </WalletProvider>
      </body>
    </html>
  )
}
