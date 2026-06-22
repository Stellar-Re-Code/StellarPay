import { PayrollClient } from '../payrollClient';
import { getSorobanServer, NETWORK } from '../network';
import { signTransaction } from '../wallet';
import * as StellarSdk from '@stellar/stellar-sdk';

jest.mock('../network', () => ({
  getSorobanServer: jest.fn(),
  NETWORK: {
    name: 'Testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
  },
  CONTRACTS: {
    payrollStream: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  },
}));

jest.mock('../wallet', () => ({
  signTransaction: jest.fn(),
}));


jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    rpc: {
      ...original.rpc,
      assembleTransaction: jest.fn().mockReturnValue({
        toXDR: jest.fn().mockReturnValue('mockedxdr'),
      }),
    },
  };
});

jest.mock('../env', () => ({
  env: {
    rpcUrl: 'http://test',
    networkPassphrase: 'test',
    explorerUrl: 'http://test',
    payrollContractId: 'C123',
  },
  validateEnv: jest.fn()
}));

describe('PayrollClient', () => {
  let mockServer: any;

  beforeEach(() => {
    const mockAccountId = StellarSdk.Keypair.random().publicKey();
    StellarSdk.rpc.Api.isSimulationError = jest.fn().mockReturnValue(false);
    mockServer = {
      getAccount: jest.fn().mockResolvedValue(new StellarSdk.Account(mockAccountId, '1')),
      simulateTransaction: jest.fn(),
      sendTransaction: jest.fn(),
      getTransaction: jest.fn(),
    };
    (getSorobanServer as jest.Mock).mockReturnValue(mockServer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('creates a stream successfully with state tracking', async () => {
    const client = new PayrollClient();
    const onStateChange = jest.fn();

    // Mock Simulation Success
    mockServer.simulateTransaction.mockResolvedValue({
      error: undefined,
      transactionData: new StellarSdk.xdr.SorobanTransactionData({
        ext: new StellarSdk.xdr.ExtensionPoint(0),
        resources: new StellarSdk.xdr.SorobanResources({
          footprint: new StellarSdk.xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
          instructions: 0,
          readBytes: 0,
          writeBytes: 0,
        }),
        resourceFee: StellarSdk.nativeToScVal(100, { type: 'i128' }).value() as StellarSdk.xdr.Int64,
      })
    });

    const mockAccountId = StellarSdk.Keypair.random().publicKey();
    // Mock Wallet Sign
    (signTransaction as jest.Mock).mockResolvedValue(
      new StellarSdk.TransactionBuilder(new StellarSdk.Account(mockAccountId, '1'), { fee: '100', networkPassphrase: 'Test SDF Network ; September 2015' })
        .setTimeout(30)
        .build()
        .toXDR()
    );

    // Mock Submit
    mockServer.sendTransaction.mockResolvedValue({
      errorResultXdr: undefined,
      hash: 'testhash123',
    });

    // Mock Polling Success
    mockServer.getTransaction.mockResolvedValue({
      status: StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS,
    });

    await client.createStream(
      mockAccountId,
      { recipient: StellarSdk.Keypair.random().publicKey(), amount: '100', startTime: '1000', endTime: '2000' },
      onStateChange
    );

    expect(onStateChange).toHaveBeenCalledWith('simulating');
    expect(onStateChange).toHaveBeenCalledWith('signing');
    expect(onStateChange).toHaveBeenCalledWith('submitting');
    expect(onStateChange).toHaveBeenCalledWith('polling');
    expect(onStateChange).toHaveBeenCalledWith('success');
  });

  test('throws human-readable error on simulation failure', async () => {
    const client = new PayrollClient();
    
    mockServer.simulateTransaction.mockResolvedValue({
      error: 'HostError: budget exceeded',
    });
    // Add isSimulationError check for SDK 12.x
    StellarSdk.rpc.Api.isSimulationError = jest.fn().mockReturnValue(true);

    await expect(
      client.createStream(StellarSdk.Keypair.random().publicKey(), { recipient: StellarSdk.Keypair.random().publicKey(), amount: '100', startTime: '1000', endTime: '2000' })
    ).rejects.toThrow(/Simulation failed.*budget exceeded/);
  });
});
