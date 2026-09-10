/**
 * Freighter wallet utilities.
 *
 * Implemented against `@stellar/freighter-api` v2.0.0, whose public surface is
 * the promise API: `isConnected()`, `isAllowed()`, `setAllowed()`,
 * `requestAccess()`, `getPublicKey()`, `getAddress()`, `getNetworkDetails()` and
 * `signTransaction()`. These resolve to plain values or object shapes.
 *
 * Includes preflight guards preventing submission on wrong network or mismatched account.
 */

import * as freighterModule from '@stellar/freighter-api'
import { NETWORK } from './network'

// Normalize freighterApi across ESM and CJS/mock environments
const freighterApi: any = (freighterModule as any).default || freighterModule

export const FREIGHTER_NOT_INSTALLED =
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
    const fn = freighterApi.isConnected || (freighterModule as any).isConnected
    return asBool(await fn())
  } catch {
    return false
  }
}

/** Whether this dApp is already authorized to read the user's account. */
export async function isAllowed(): Promise<boolean> {
  try {
    const fn = freighterApi.isAllowed || (freighterModule as any).isAllowed
    return asBool(await fn())
  } catch {
    return false
  }
}

/** Request that the user authorize this dApp (shows the Freighter prompt). */
export async function setAllowed(): Promise<boolean> {
  const fn = freighterApi.setAllowed || (freighterModule as any).setAllowed
  return asBool(await fn())
}

/**
 * Connect to Freighter and return the user's public key.
 * Throws a clear error if Freighter is not installed.
 */
export async function connectWallet(): Promise<string> {
  if (!(await isFreighterInstalled())) {
    throw new Error(FREIGHTER_NOT_INSTALLED)
  }

  // If requestAccess is available, use it (handles permission + address)
  let allowed = await isAllowed()
  if (!allowed) {
    await setAllowed()
    allowed = await isAllowed()
  }

  const reqFn = freighterApi.requestAccess || (freighterModule as any).requestAccess
  if (typeof reqFn === 'function') {
    try {
      const result = await reqFn()
      if (result) return asAddress(result)
    } catch {
      // Fallback to getAddress
    }
  }

  return await getAddress()
}

/** Read the currently-connected public key without prompting. */
export async function getAddress(): Promise<string> {
  if (!(await isFreighterInstalled())) {
    throw new Error(FREIGHTER_NOT_INSTALLED)
  }
  const getPkFn = freighterApi.getPublicKey || (freighterModule as any).getPublicKey
  if (typeof getPkFn === 'function') {
    try {
      const res = await getPkFn()
      return asAddress(res)
    } catch {
      // Fallback to getAddress if getPublicKey failed
    }
  }

  const getAddrFn = freighterApi.getAddress || (freighterModule as any).getAddress
  if (typeof getAddrFn === 'function') {
    const res = await getAddrFn()
    return asAddress(res)
  }

  throw new Error('Could not read wallet address from Freighter.')
}

/** Read the network Freighter is currently pointed at. */
export async function getNetworkDetails(): Promise<{
  network: string
  networkPassphrase: string
}> {
  const fn = freighterApi.getNetworkDetails || (freighterModule as any).getNetworkDetails
  const details = await fn()
  return {
    network: details?.network || '',
    networkPassphrase: details?.networkPassphrase || '',
  }
}

export interface SessionValidationOptions {
  expectedAddress?: string | null
  expectedPassphrase?: string | null
}

export interface ValidatedSession {
  address: string
  network: string
  networkPassphrase: string
}

/**
 * Preflight guard: verifies that the Freighter wallet is connected,
 * and that the active account and network match transaction expectations.
 * Rejects and throws an actionable message if any mismatch is detected.
 */
export async function validateWalletSession(
  optionsOrExpectedAddress?: SessionValidationOptions | string,
  expectedPassphraseParam?: string,
): Promise<ValidatedSession> {
  if (!(await isFreighterInstalled())) {
    throw new Error(FREIGHTER_NOT_INSTALLED)
  }

  let expectedAddress: string | undefined
  let expectedPassphrase: string | undefined

  if (typeof optionsOrExpectedAddress === 'string') {
    expectedAddress = optionsOrExpectedAddress
    expectedPassphrase = expectedPassphraseParam
  } else if (optionsOrExpectedAddress && typeof optionsOrExpectedAddress === 'object') {
    expectedAddress = optionsOrExpectedAddress.expectedAddress || undefined
    expectedPassphrase = optionsOrExpectedAddress.expectedPassphrase || expectedPassphraseParam
  }

  if (!expectedPassphrase) {
    expectedPassphrase = NETWORK.networkPassphrase
  }

  // 1. Verify active account
  const activeAddress = await getAddress()
  if (!activeAddress) {
    throw new Error('Wallet session inactive. Please connect your Freighter wallet.')
  }

  if (expectedAddress && activeAddress.trim().toLowerCase() !== expectedAddress.trim().toLowerCase()) {
    throw new Error(
      `Wallet account mismatch: Active wallet account (${activeAddress}) does not match expected transaction source (${expectedAddress}). Please switch account in Freighter or reconnect.`,
    )
  }

  // 2. Verify active network
  const networkDetails = await getNetworkDetails()
  const activeNet = (networkDetails.network || '').trim()
  const activePass = (networkDetails.networkPassphrase || '').trim()
  const expPass = expectedPassphrase.trim()

  const passMatches = activePass && activePass.toLowerCase() === expPass.toLowerCase()
  const netMatches =
    activeNet &&
    (activeNet.toLowerCase() === expPass.toLowerCase() ||
      expPass.toLowerCase().includes(activeNet.toLowerCase()) ||
      activeNet.toLowerCase().includes(expPass.toLowerCase()))

  if (!passMatches && !netMatches) {
    throw new Error(
      `Wallet network mismatch: Active wallet is connected to ${activeNet || 'unknown'} (${activePass || 'no passphrase'}), but ${expectedPassphrase} is expected. Please switch networks in Freighter.`,
    )
  }

  return {
    address: activeAddress,
    network: activeNet,
    networkPassphrase: activePass,
  }
}

/**
 * Sign a transaction XDR with Freighter and return the signed XDR.
 * Executes validateWalletSession preflight checks prior to requesting signature.
 */
export async function signTransaction(
  xdr: string,
  networkPassphrase: string = NETWORK.networkPassphrase,
  expectedAddress?: string,
): Promise<string> {
  if (!(await isFreighterInstalled())) {
    throw new Error(FREIGHTER_NOT_INSTALLED)
  }

  // Run preflight guard
  await validateWalletSession({
    expectedAddress,
    expectedPassphrase: networkPassphrase,
  })

  const signFn = freighterApi.signTransaction || (freighterModule as any).signTransaction
  const signed = await signFn(xdr, { networkPassphrase, network: networkPassphrase })
  if (typeof signed === 'string') return signed
  if (signed && typeof signed === 'object') {
    const obj = signed as Record<string, unknown>
    if (obj.error) throw new Error(String(obj.error))
    if (typeof obj.signedTxXdr === 'string') return obj.signedTxXdr
    if (typeof obj.signedXDR === 'string') return obj.signedXDR
    if (typeof obj.signedXdr === 'string') return obj.signedXdr
    return signed as any
  }
  throw new Error('Freighter did not return a signed transaction.')
}

export type WalletStateChangeHandler = (state: {
  address: string | null
  network: string | null
  networkPassphrase: string | null
}) => void

/**
 * Watch for Freighter wallet account and network switches.
 * When changes are detected, invokes callback to invalidate stale UI state.
 */
export function watchWalletChanges(callback: WalletStateChangeHandler): () => void {
  let intervalId: any
  let lastAddress: string | null = null
  let lastNetwork: string | null = null
  let lastPassphrase: string | null = null

  const checkState = async () => {
    try {
      if (!(await isFreighterInstalled())) {
        if (lastAddress !== null) {
          lastAddress = null
          lastNetwork = null
          lastPassphrase = null
          callback({ address: null, network: null, networkPassphrase: null })
        }
        return
      }

      const address = await getAddress().catch(() => null)
      let network: string | null = null
      let networkPassphrase: string | null = null

      if (address) {
        try {
          const details = await getNetworkDetails()
          network = details.network || null
          networkPassphrase = details.networkPassphrase || null
        } catch {
          // ignore network details fetch failure
        }
      }

      if (address !== lastAddress || network !== lastNetwork || networkPassphrase !== lastPassphrase) {
        lastAddress = address
        lastNetwork = network
        lastPassphrase = networkPassphrase
        callback({ address, network, networkPassphrase })
      }
    } catch {
      // Ignore polling errors
    }
  }

  intervalId = setInterval(checkState, 1500)
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('freighter:accountChanged', checkState)
    window.addEventListener('freighter:networkChanged', checkState)
  }

  return () => {
    if (intervalId) clearInterval(intervalId)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('freighter:accountChanged', checkState)
      window.removeEventListener('freighter:networkChanged', checkState)
    }
  }
}
