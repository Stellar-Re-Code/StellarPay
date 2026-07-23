/**
 * Stellar/Soroban network configuration.
 */

import * as StellarSdk from '@stellar/stellar-sdk'
import { rpc } from '@stellar/stellar-sdk'
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
 * Contract IDs — populated after deployment. Prefer the env var
 * `NEXT_PUBLIC_PAYROLL_STREAM_CONTRACT_ID` (read lazily via
 * `getPayrollStreamContractId`) so an unset id never breaks the build.
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

/**
 * A sensible default testnet token contract id can be supplied via
 * `NEXT_PUBLIC_DEFAULT_TOKEN_CONTRACT_ID`. Falls back to the empty string,
 * in which case the UI shows a free-input field with a placeholder.
 */
export function getDefaultTokenContractId(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_TOKEN_CONTRACT_ID ?? ''
}

/**
 * Resolve the payroll-stream contract id at call time (not module load) so the
 * Next.js build does not fail when the env var is unset. Falls back to the
 * hard-coded `CONTRACTS.payrollStream`.
 */
export function getPayrollStreamContractId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_PAYROLL_STREAM_CONTRACT_ID
  return (fromEnv && fromEnv.trim()) || CONTRACTS.payrollStream
}

/** True when a payroll-stream contract id is configured. */
export function isPayrollContractConfigured(): boolean {
  return getPayrollStreamContractId().trim().length > 0
}

/**
 * Resolve the vesting contract id at call time (not module load) so the
 * Next.js build does not fail when the env var is unset. Falls back to the
 * hard-coded `CONTRACTS.vesting`.
 */
export function getVestingContractId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_VESTING_CONTRACT_ID
  return (fromEnv && fromEnv.trim()) || CONTRACTS.vesting
}

/** True when a vesting contract id is configured. */
export function isVestingContractConfigured(): boolean {
  return getVestingContractId().trim().length > 0
}

let serverInstance: rpc.Server | null = null

/**
 * Create (and memoize) a Soroban RPC `Server` instance.
 * Uses the `rpc.Server` export of @stellar/stellar-sdk v12.
 */
export function getSorobanServer(): rpc.Server {
  if (!serverInstance) {
    serverInstance = new rpc.Server(NETWORK.rpcUrl, { allowHttp: false })
  }
  return serverInstance
}
