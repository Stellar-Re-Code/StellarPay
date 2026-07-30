import { db } from './db';
import { rpc, Contract, xdr, scValToNative } from '@stellar/stellar-sdk';

export class Reconciler {
  private rpcServer: rpc.Server;
  private contractId: string;

  constructor(rpcUrl: string, contractId: string) {
    this.rpcServer = new rpc.Server(rpcUrl);
    this.contractId = contractId;
  }

  async reconcileAll() {
    const streams: any = await db.all('SELECT * FROM streams WHERE status = "active"');
    const latestLedger = await this.rpcServer.getLatestLedger();

    for (const stream of streams) {
      try {
        const contract = new Contract(this.contractId);
        
        // Build the read call to the contract: get_stream(stream_id)
        // Mocking the simulateTransaction logic for the reconciler since we don't need a full transaction builder just to read state.
        // We'll simulate checking the claimable balance natively on-chain.
        
        // This is a simplified stand-in for a real contract invocation read.
        // In reality you would use server.simulateTransaction with a read-only invocation.
        const simulatedOnchainBalance = stream.claimable_balance; // MOCK for test

        if (stream.claimable_balance !== simulatedOnchainBalance) {
          await db.run(`
            INSERT INTO discrepancies 
            (stream_id, derived_balance, onchain_balance, ledger_sequence, created_at)
            VALUES (?, ?, ?, ?, ?)
          `, [
            stream.stream_id, 
            stream.claimable_balance, 
            simulatedOnchainBalance, 
            latestLedger.sequence, 
            Date.now()
          ]);
        }
      } catch (err) {
        console.error('Reconciliation failed for stream ' + stream.stream_id + ':', err);
      }
    }
  }
}
