export const env = {
  rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
  networkPassphrase: process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  explorerUrl: process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL,
  payrollContractId: process.env.NEXT_PUBLIC_PAYROLL_CONTRACT_ID,
};

export function validateEnv() {
  const missing: string[] = [];
  if (!env.rpcUrl) missing.push('NEXT_PUBLIC_STELLAR_RPC_URL');
  if (!env.networkPassphrase) missing.push('NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE');
  if (!env.explorerUrl) missing.push('NEXT_PUBLIC_STELLAR_EXPLORER_URL');
  if (!env.payrollContractId) missing.push('NEXT_PUBLIC_PAYROLL_CONTRACT_ID');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
