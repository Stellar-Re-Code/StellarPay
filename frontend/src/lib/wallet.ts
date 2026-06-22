/**
 * Freighter wallet utilities.
 * Contributors: see FE-2 for full implementation.
 */

import {
  isConnected,
  isAllowed,
  setAllowed,
  getAddress,
  signTransaction as freighterSignTransaction,
  getNetworkDetails,
  getPublicKey
} from '@stellar/freighter-api'

export async function isFreighterInstalled(): Promise<boolean> {
  return await isConnected()
}

export async function connectWallet(): Promise<string | null> {
  if (!(await isConnected())) {
    throw new Error('Freighter is not installed')
  }

  let allowed = await isAllowed()
  if (!allowed) {
    await setAllowed()
    allowed = await isAllowed()
  }

  if (allowed) {
    const address = await getAddress()
    return address
  }

  return null
}

export function disconnectWallet(): void {
  // Freighter doesn't have an explicit disconnect API.
  // This function is a placeholder for local reset.
}

export type WalletStateChangeHandler = (address: string | null, network: string | null) => void;

export function watchWalletChanges(callback: WalletStateChangeHandler): () => void {
  let intervalId: any;
  let lastAddress: string | null = null;
  let lastNetwork: string | null = null;

  if (typeof window !== 'undefined') {
    intervalId = setInterval(async () => {
      try {
        if (await isConnected() && await isAllowed()) {
          const address = await getPublicKey();
          const networkDetails = await getNetworkDetails();
          const network = networkDetails.network;

          if (address !== lastAddress || network !== lastNetwork) {
            lastAddress = address;
            lastNetwork = network;
            callback(address, network);
          }
        } else {
          if (lastAddress !== null || lastNetwork !== null) {
            lastAddress = null;
            lastNetwork = null;
            callback(null, null);
          }
        }
      } catch (e) {
        // Ignore errors during polling
      }
    }, 2000);
  }

  return () => {
    if (intervalId) clearInterval(intervalId);
  };
}

export async function signTransaction(xdr: string, network: string): Promise<string> {
  if (!(await isConnected())) {
    throw new Error('Freighter is not installed')
  }

  const networkDetails = await getNetworkDetails()
  if (networkDetails.network !== network) {
    throw new Error(`Freighter is set to ${networkDetails.network}, but ${network} is expected.`)
  }

  const result = await freighterSignTransaction(xdr, { network })
  if (result.error) {
    throw new Error(result.error)
  }
  return result
}
