/**
 * Freighter wallet utilities.
 *
 * Implemented against `@stellar/freighter-api` v2.0.0, whose public surface is
 * the legacy promise API: `isConnected()`, `isAllowed()`, `setAllowed()`,
 * `requestAccess()`, `getPublicKey()`, `getNetworkDetails()` and
 * `signTransaction()`. These resolve to plain values and reject (throw) on
 * failure. We additionally tolerate the newer object-shaped responses
 * (`{ address }` / `{ isConnected }` / `{ error }`) so the same code keeps
 * working if the extension/library is upgraded.
 */

import freighterApi from '@stellar/freighter-api'
import { NETWORK } from './network'

const FREIGHTER_NOT_INSTALLED =
  'Freighter wallet was not detected. Install the Freighter browser extension and reload to continue.'

/** Normalize a possibly-object response into a plain string (address). */
function asAddress(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.error) {
      throw new Error(String(obj.error))
    }
    if (typeof obj.address === 'string') return obj.address
    if (typeof obj.publicKey === 'string') return obj.publicKey
  }
  throw new Error('Could not read wallet address from Freighter.')
}

/** Normalize a possibly-object boolean response. */
function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.isConnected === 'boolean') return obj.isConnected
    if (typeof obj.isAllowed === 'boolean') return obj.isAllowed
  }
  return Boolean(value)
}

/**
 * Check whether the Freighter extension is installed / reachable.
 * `isConnected()` resolves true only when the extension is present.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    return asBool(await freighterApi.isConnected())
  } catch {
    return false
  }
}

/** Whether this dApp is already authorized to read the user's account. */
export async function isAllowed(): Promise<boolean> {
  try {
    return asBool(await freighterApi.isAllowed())
  } catch {
    return false
  }
}

/** Request that the user authorize this dApp (shows the Freighter prompt). */
export async function setAllowed(): Promise<boolean> {
  return asBool(await freighterApi.setAllowed())
}

/**
 * Connect to Freighter and return the user's public key.
 * Throws a clear error if Freighter is not installed.
 */
export async function connectWallet(): Promise<string> {
  if (!(await isFreighterInstalled())) {
    throw new Error(FREIGHTER_NOT_INSTALLED)
  }
  const result = await freighterApi.requestAccess()
  return asAddress(result)
}

/** Read the currently-connected public key without prompting. */
export async function getAddress(): Promise<string> {
  if (!(await isFreighterInstalled())) {
    throw new Error(FREIGHTER_NOT_INSTALLED)
  }
  return asAddress(await freighterApi.getPublicKey())
}

/** Read the network Freighter is currently pointed at. */
export async function getNetworkDetails(): Promise<{
  network: string
  networkPassphrase: string
}> {
  const details = await freighterApi.getNetworkDetails()
  return {
    network: details.network,
    networkPassphrase: details.networkPassphrase,
  }
}

/**
 * Sign a transaction XDR with Freighter and return the signed XDR.
 * Defaults to the configured testnet passphrase.
 */
export async function signTransaction(
  xdr: string,
  networkPassphrase: string = NETWORK.networkPassphrase,
): Promise<string> {
  if (!(await isFreighterInstalled())) {
    throw new Error(FREIGHTER_NOT_INSTALLED)
  }
  const signed = await freighterApi.signTransaction(xdr, { networkPassphrase })
  if (typeof signed === 'string') return signed
  if (signed && typeof signed === 'object') {
    const obj = signed as Record<string, unknown>
    if (obj.error) throw new Error(String(obj.error))
    if (typeof obj.signedTxXdr === 'string') return obj.signedTxXdr
    if (typeof obj.signedXDR === 'string') return obj.signedXDR
  }
  throw new Error('Freighter did not return a signed transaction.')
}
