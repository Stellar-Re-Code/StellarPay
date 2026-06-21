import { isFreighterInstalled, connectWallet, signTransaction } from '../wallet';
import * as freighterApi from '@stellar/freighter-api';

jest.mock('@stellar/freighter-api', () => ({
  isConnected: jest.fn(),
  isAllowed: jest.fn(),
  setAllowed: jest.fn(),
  getAddress: jest.fn(),
  signTransaction: jest.fn(),
  getNetworkDetails: jest.fn(),
}));

describe('wallet utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('connectWallet prompts for access if not allowed', async () => {
    (freighterApi.isConnected as jest.Mock).mockResolvedValue(true);
    (freighterApi.isAllowed as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    (freighterApi.getAddress as jest.Mock).mockResolvedValue('GDK...123');

    const address = await connectWallet();

    expect(freighterApi.setAllowed).toHaveBeenCalled();
    expect(address).toBe('GDK...123');
  });

  test('signTransaction fails on network mismatch', async () => {
    (freighterApi.isConnected as jest.Mock).mockResolvedValue(true);
    (freighterApi.getNetworkDetails as jest.Mock).mockResolvedValue({ network: 'PUBLIC' });

    await expect(signTransaction('xdr', 'TESTNET')).rejects.toThrow(/mismatch|expected/i);
  });

  test('signTransaction calls freighter correctly on network match', async () => {
    (freighterApi.isConnected as jest.Mock).mockResolvedValue(true);
    (freighterApi.getNetworkDetails as jest.Mock).mockResolvedValue({ network: 'TESTNET' });
    (freighterApi.signTransaction as jest.Mock).mockResolvedValue({ error: undefined, signedXdr: 'signed' });

    const result = await signTransaction('xdr', 'TESTNET');
    expect(result).toEqual({ error: undefined, signedXdr: 'signed' });
  });
});
