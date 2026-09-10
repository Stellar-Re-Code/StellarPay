import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isFreighterInstalled,
  connectWallet,
  getAddress,
  getNetworkDetails,
  validateWalletSession,
  signTransaction,
  watchWalletChanges,
  FREIGHTER_NOT_INSTALLED,
} from '../wallet'
import * as freighterApi from '@stellar/freighter-api'

vi.mock('@stellar/freighter-api', () => {
  const mocks = {
    isConnected: vi.fn(),
    isAllowed: vi.fn(),
    setAllowed: vi.fn(),
    getAddress: vi.fn(),
    getPublicKey: vi.fn(),
    signTransaction: vi.fn(),
    getNetworkDetails: vi.fn(),
    requestAccess: vi.fn(),
  }
  return {
    default: mocks,
    ...mocks,
  }
})

describe('Freighter wallet & session preflight guard', () => {
  const validAddress = 'GDKACCOUNT11111111111111111111111111111111111111111111111'
  const otherAddress = 'GBBACCOUNT22222222222222222222222222222222222222222222222'
  const validPassphrase = 'Test SDF Network ; September 2015'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(freighterApi.isConnected).mockResolvedValue(true)
    vi.mocked(freighterApi.isAllowed).mockResolvedValue(true)
    vi.mocked(freighterApi.getPublicKey).mockResolvedValue(validAddress)
    vi.mocked(freighterApi.getAddress).mockResolvedValue(validAddress)
    vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: validPassphrase,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Installation & Connection', () => {
    it('detects when Freighter is not installed', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue(false)
      expect(await isFreighterInstalled()).toBe(false)
      await expect(connectWallet()).rejects.toThrow(FREIGHTER_NOT_INSTALLED)
      await expect(getAddress()).rejects.toThrow(FREIGHTER_NOT_INSTALLED)
    })

    it('connectWallet prompts for access if not allowed', async () => {
      vi.mocked(freighterApi.isAllowed).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      vi.mocked(freighterApi.getAddress).mockResolvedValue(validAddress)

      const address = await connectWallet()
      expect(freighterApi.setAllowed).toHaveBeenCalled()
      expect(address).toBe(validAddress)
    })
  })

  describe('validateWalletSession preflight checks', () => {
    it('passes when wallet session matches expected address and network', async () => {
      const session = await validateWalletSession({
        expectedAddress: validAddress,
        expectedPassphrase: validPassphrase,
      })
      expect(session.address).toBe(validAddress)
      expect(session.network).toBe('TESTNET')
      expect(session.networkPassphrase).toBe(validPassphrase)
    })

    it('rejects with actionable message when active account mismatches transaction source', async () => {
      await expect(
        validateWalletSession({
          expectedAddress: otherAddress,
          expectedPassphrase: validPassphrase,
        }),
      ).rejects.toThrow(/mismatch.*switch account/i)
    })

    it('rejects with actionable message on network mismatch', async () => {
      vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      })

      await expect(
        validateWalletSession({
          expectedAddress: validAddress,
          expectedPassphrase: validPassphrase,
        }),
      ).rejects.toThrow(/mismatch.*expected.*switch network/i)
    })
  })

  describe('signTransaction preflight enforcement', () => {
    it('signs successfully when account and network match', async () => {
      vi.mocked(freighterApi.signTransaction).mockResolvedValue('AAAA_SIGNED_XDR')

      const res = await signTransaction('mock_tx_xdr', validPassphrase, validAddress)
      expect(res).toBe('AAAA_SIGNED_XDR')
      expect(freighterApi.signTransaction).toHaveBeenCalledWith('mock_tx_xdr', {
        networkPassphrase: validPassphrase,
        network: validPassphrase,
      })
    })

    it('blocks signature and rejects if wallet network is wrong', async () => {
      vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      })

      await expect(signTransaction('mock_tx_xdr', 'TESTNET')).rejects.toThrow(/mismatch|expected/i)
      expect(freighterApi.signTransaction).not.toHaveBeenCalled()
    })

    it('blocks signature and rejects if wallet account does not match source', async () => {
      await expect(signTransaction('mock_tx_xdr', validPassphrase, otherAddress)).rejects.toThrow(
        /mismatch.*account/i,
      )
      expect(freighterApi.signTransaction).not.toHaveBeenCalled()
    })
  })

  describe('watchWalletChanges event listener', () => {
    it('triggers callback and invalidates state when account or network changes', async () => {
      vi.useFakeTimers()
      const callback = vi.fn()

      const unwatch = watchWalletChanges(callback)

      // Initial check inside interval: simulate account switch
      vi.mocked(freighterApi.getPublicKey).mockResolvedValue(otherAddress)
      await vi.advanceTimersByTimeAsync(1600)

      expect(callback).toHaveBeenCalledWith({
        address: otherAddress,
        network: 'TESTNET',
        networkPassphrase: validPassphrase,
      })

      // Simulate network switch
      vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      })
      await vi.advanceTimersByTimeAsync(1600)

      expect(callback).toHaveBeenCalledWith({
        address: otherAddress,
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      })

      unwatch()
      vi.useRealTimers()
    })
  })
})
