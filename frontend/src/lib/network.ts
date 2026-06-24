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
  name: 'Testnet',
  networkPassphrase: env.networkPassphrase || 'Test SDF Network ; September 2015',
  rpcUrl: env.rpcUrl || 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
} as const;

/**
 * Contract IDs — these will be populated after deployment.
 * TODO: Add deployed contract IDs (contributor task FE-4)
 *
 * ⚠️ treasury and governance are deprecated in StellarPay.
 * These contracts are migrating to StellarSentinel.
 * See docs/MODULE_BOUNDARY.md for the migration plan.
 */
export const CONTRACTS = {
  /** @deprecated Migrating to StellarSentinel — see docs/MODULE_BOUNDARY.md */
  treasury: "",
  payrollStream: env.payrollContractId || "",
  vesting: "",
  /** @deprecated Migrating to StellarSentinel — see docs/MODULE_BOUNDARY.md */
  governance: "",
} as const;

export function getSorobanServer() {
  return new StellarSdk.rpc.Server(NETWORK.rpcUrl, { allowHttp: NETWORK.rpcUrl.startsWith('http://') });
}
