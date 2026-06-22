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

export interface Stream {
  sender: string
  recipient: string
  token: string
  totalAmount: string
  claimedAmount: string
  startTime: string
  endTime: string
  lastClaimTime: string
  status: 'Active' | 'Paused' | 'Completed' | 'Cancelled'
  ratePerSecond: string
}

export class PayrollClient {
  private server: StellarSdk.rpc.Server
  private contractId: string

  constructor() {
    this.server = getSorobanServer()
    this.contractId = CONTRACTS.payrollStream
  }

  public async getStream(streamId: string): Promise<Stream | null> {
    const contract = new StellarSdk.Contract(this.contractId)
    const txBuilder = new StellarSdk.TransactionBuilder(new StellarSdk.Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'), {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK.networkPassphrase,
    })

    txBuilder.addOperation(
      contract.call('get_stream', StellarSdk.nativeToScVal(Number(streamId), { type: 'u32' }))
    )
    
    txBuilder.setTimeout(30)
    const tx = txBuilder.build()

    const simResult = await this.server.simulateTransaction(tx)
    if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
      return null
    }

    if (!simResult.result || !simResult.result.retval) {
      return null
    }

    const retval = simResult.result.retval
    // Parse the returned ScVal (which is a Map/Struct for Stream)
    // Here we'd map it correctly, for now we will just return a placeholder typed object 
    // since parsing scVal deeply requires knowing the exact structure
    return {
      sender: 'placeholder',
      recipient: 'placeholder',
      token: 'placeholder',
      totalAmount: '0',
      claimedAmount: '0',
      startTime: '0',
      endTime: '0',
      lastClaimTime: '0',
      status: 'Active',
      ratePerSecond: '0'
    }
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
