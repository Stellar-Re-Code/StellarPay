import { db } from './db';
import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk';

export class Indexer {
  private rpcServer: rpc.Server;
  private contractId: string;
  private isPolling = false;

  constructor(rpcUrl: string, contractId: string) {
    this.rpcServer = new rpc.Server(rpcUrl);
    this.contractId = contractId;
  }

  async start(startLedger: number) {
    this.isPolling = true;
    
    // Check cursor
    const cursorRow = await db.get('SELECT last_ledger FROM cursor WHERE id = 1');
    let currentLedger = Math.max(cursorRow.last_ledger, startLedger);

    while (this.isPolling) {
      try {
        const latestLedger = await this.rpcServer.getLatestLedger();
        if (currentLedger < latestLedger.sequence) {
          const toLedger = Math.min(currentLedger + 100, latestLedger.sequence);
          
          await this.processLedgerRange(currentLedger, toLedger);
          
          // Update cursor safely (idempotent design)
          await db.run('UPDATE cursor SET last_ledger = ? WHERE id = 1', [toLedger]);
          currentLedger = toLedger + 1;
        } else {
          // Wait before polling again
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        console.error('Polling error:', err);
        await new Promise(resolve => setTimeout(resolve, 5000)); // backoff
      }
    }
  }

  stop() {
    this.isPolling = false;
  }

  async processLedgerRange(start: number, end: number) {
    const response = await this.rpcServer.getEvents({
      startLedger: start,
      filters: [
        {
          type: 'contract',
          contractIds: [this.contractId],
          topics: [
             [xdr.ScVal.scvSymbol('s_create').toXDR('base64')],
             [xdr.ScVal.scvSymbol('claim').toXDR('base64')],
             [xdr.ScVal.scvSymbol('cancel').toXDR('base64')]
          ]
        }
      ],
      limit: 100
    });

    for (const event of response.events) {
      // Decode topic
      const topicVals = event.topic.map((t: any) => t.toXDR ? t : xdr.ScVal.fromXDR(t as string, 'base64'));
      const eventName = scValToNative(topicVals[0]);

      // Decode value
      const val = (event.value as any).toXDR ? event.value as any : xdr.ScVal.fromXDR(event.value as any as string, 'base64');
      const data = scValToNative(val);

      if (eventName === 's_create') {
        // idempotent insert
        await db.run(`
          INSERT OR REPLACE INTO streams 
          (stream_id, sender, recipient, amount, token, start_time, end_time, status, claimable_balance) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          data.stream_id, data.sender, data.recipient, data.amount.toString(), data.token,
          data.start_time, data.end_time, 'active', '0'
        ]);
      } else if (eventName === 'claim') {
        const stream = await db.get('SELECT * FROM streams WHERE stream_id = ?', [data.stream_id]);
        if (stream) {
           const newClaimable = BigInt(stream.claimable_balance) + BigInt(data.amount);
           await db.run('UPDATE streams SET claimable_balance = ? WHERE stream_id = ?', [newClaimable.toString(), data.stream_id]);
        }
      } else if (eventName === 'cancel') {
        await db.run('UPDATE streams SET status = ? WHERE stream_id = ?', ['cancelled', data.stream_id]);
      }
    }
  }
}
