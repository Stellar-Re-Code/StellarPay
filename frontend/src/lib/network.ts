/**
 * Stellar/Soroban network configuration.
 * Contributors: see FE-4 for full implementation.
 */

export const NETWORK = {
  name: "Testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
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
  payrollStream: "",
  vesting: "",
  /** @deprecated Migrating to StellarSentinel — see docs/MODULE_BOUNDARY.md */
  governance: "",
} as const;

/**
 * Creates a Soroban Server instance for RPC calls.
 * TODO: Implement full provider setup (contributor task FE-4)
 */
export function getSorobanServer() {
  // Return placeholder — contributor should implement with @stellar/stellar-sdk
  return null;
}
