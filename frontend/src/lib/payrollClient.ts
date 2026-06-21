import * as StellarSdk from '@stellar/stellar-sdk'
import { getSorobanServer, CONTRACTS, NETWORK } from './network'
import { signTransaction } from './wallet'
import { toStroops, toBigIntSafe } from './utils'

export type TransactionState =
  | 'idle'
  | 'simulating'
  | 'signing'
  | 'submitting'
  | 'polling'
  | 'success'
  | 'error'

export interface CreateStreamParams {
  recipient: string
  amount: string
  startTime: string | number
  endTime: string | number
}

export class PayrollClient {
  private server: StellarSdk.rpc.Server
  private contractId: string

  constructor() {
    this.server = getSorobanServer()
    this.contractId = CONTRACTS.payrollStream
  }

  public async getStream(streamId: string): Promise<any> {
    const contract = new StellarSdk.Contract(this.contractId)
    // Here we'd build the transaction to call a read-only method if needed
    // For direct reads, typically we use server.getEvents or getLedgerEntry if we know the key
    // For now, let's just use simulateTransaction to "read" state
    // We need an account to simulate
    return null; // Implementation depends on contract read interface
  }

  public async createStream(
    sourceAddress: string,
    params: CreateStreamParams,
    onStateChange?: (state: TransactionState, message?: string) => void
  ) {
    try {
      if (onStateChange) onStateChange('simulating')

      const sourceAccount = await this.server.getAccount(sourceAddress)
      const contract = new StellarSdk.Contract(this.contractId)

      const amountBigInt = toStroops(params.amount)
      const startTimeBigInt = toBigIntSafe(params.startTime)
      const endTimeBigInt = toBigIntSafe(params.endTime)

      const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK.networkPassphrase,
      })

      txBuilder.addOperation(
        contract.call('create_stream', 
          new StellarSdk.Address(params.recipient).toScVal(),
          StellarSdk.nativeToScVal(amountBigInt, { type: 'i128' }),
          StellarSdk.nativeToScVal(startTimeBigInt, { type: 'u64' }),
          StellarSdk.nativeToScVal(endTimeBigInt, { type: 'u64' })
        )
      )

      txBuilder.setTimeout(30)
      const tx = txBuilder.build()

      // Simulation
      const simResult = await this.server.simulateTransaction(tx)
      
      if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
        throw new Error(`Simulation failed: ${simResult.error}`)
      }
      
      if (!simResult.transactionData) {
        throw new Error('Simulation failed: No transaction data returned')
      }

      // Assemble with transaction data from simulation
      const assembledTx = StellarSdk.rpc.assembleTransaction(tx, simResult) as StellarSdk.Transaction
      
      // Convert the assembledTx to XDR
      const xdrToSign = assembledTx.toXDR()

      if (onStateChange) onStateChange('signing')
      
      const signedXdr = await signTransaction(xdrToSign, NETWORK.name)
      const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NETWORK.networkPassphrase) as StellarSdk.Transaction

      if (onStateChange) onStateChange('submitting')

      const sendResult = await this.server.sendTransaction(signedTx)
      if (sendResult.errorResultXdr) {
        throw new Error(`Submission failed: ${sendResult.errorResultXdr}`)
      }

      if (onStateChange) onStateChange('polling')
      
      let txStatus = await this.server.getTransaction(sendResult.hash)
      let attempts = 0
      while (txStatus.status === StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 15) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        txStatus = await this.server.getTransaction(sendResult.hash)
        attempts++
      }

      if (txStatus.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
        if (onStateChange) onStateChange('success')
        return txStatus
      } else {
        throw new Error(`Transaction failed with status: ${txStatus.status}`)
      }

    } catch (err: any) {
      if (onStateChange) onStateChange('error', err.message || 'Unknown error')
      throw err
    }
  }
}
