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
  getNetworkDetails
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
