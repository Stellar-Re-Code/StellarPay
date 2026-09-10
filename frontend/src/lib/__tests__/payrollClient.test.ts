import { describe, test, expect, beforeEach, vi } from 'vitest';
import { PayrollClient } from '../payrollClient';
import { getSorobanServer, NETWORK } from '../network';
import { signTransaction } from '../wallet';
import * as StellarSdk from '@stellar/stellar-sdk';

vi.mock('../network', () => ({
  getSorobanServer: vi.fn(),
  NETWORK: {
    name: 'Testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
  },
  CONTRACTS: {
    payrollStream: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  },
}));

vi.mock('../wallet', () => ({
  signTransaction: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', async () => {
  const original = await vi.importActual<any>('@stellar/stellar-sdk');
  return {
    ...original,
    rpc: {
      ...original.rpc,
      assembleTransaction: vi.fn().mockReturnValue({
        build: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('mockedxdr'),
        }),
      }),
    },
  };
});

vi.mock('../env', () => ({
  env: {
    rpcUrl: 'http://test',
    networkPassphrase: 'test',
    explorerUrl: 'http://test',
    payrollContractId: 'C123',
  },
  validateEnv: vi.fn(),
}));

describe('PayrollClient', () => {
  let client: PayrollClient;
  let mockServer: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = {
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: 'mocked',
        },
        transactionData: 'mock_tx_data',
      }),
      sendTransaction: vi.fn().mockResolvedValue({
        status: 'PENDING',
        hash: 'txhash123',
      }),
      getTransaction: vi.fn().mockResolvedValue({
        status: 'SUCCESS',
      }),
      getAccount: vi.fn().mockImplementation((addr) => {
        return new StellarSdk.Account(addr, '1');
      }),
    };
    (getSorobanServer as any).mockReturnValue(mockServer);
    client = new PayrollClient();
  });

  test('creates a stream successfully with state tracking', async () => {
    const states: string[] = [];
    const onStateChange = (state: any) => states.push(state);

    (signTransaction as any).mockResolvedValue('signedxdr');

    vi.spyOn(StellarSdk.TransactionBuilder, 'fromXDR').mockReturnValue({} as any);

    const result = await client.createStream(
      StellarSdk.Keypair.random().publicKey(),
      {
        recipient: StellarSdk.Keypair.random().publicKey(),
        amount: '1000',
        startTime: 0,
        endTime: 1000,
      },
      onStateChange
    );

    expect(result.status).toBe('SUCCESS');
    expect(states).toEqual(['simulating', 'signing', 'submitting', 'polling', 'success']);
    expect(mockServer.simulateTransaction).toHaveBeenCalled();
    expect(signTransaction).toHaveBeenCalled();
    expect(mockServer.sendTransaction).toHaveBeenCalled();
  });
});
