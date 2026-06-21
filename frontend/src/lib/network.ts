/**
 * Stellar/Soroban network configuration.
 * Contributors: see FE-4 for full implementation.
 */

import * as StellarSdk from '@stellar/stellar-sdk'
import { env, validateEnv } from './env'

// Validate env when setting up network config
try {
  if (typeof window !== 'undefined') {
    validateEnv()
  }
} catch (e) {
  console.error(e)
}

export const NETWORK = {
  name: 'Network',
  networkPassphrase: env.networkPassphrase || 'Test SDF Network ; September 2015',
  rpcUrl: env.rpcUrl || 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
} as const

export const CONTRACTS = {
  treasury: '',
  payrollStream: env.payrollContractId || '',
  vesting: '',
  governance: '',
} as const

export function getSorobanServer() {
  return new StellarSdk.rpc.Server(NETWORK.rpcUrl, { allowHttp: NETWORK.rpcUrl.startsWith('http://') })
}
