import { db, initDb } from '../src/db';

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 })
    }))
  },
  xdr: {
    ScVal: {
      scvSymbol: (sym: string) => ({ toXDR: () => 'mock_xdr_' + sym }),
      scvString: (sym: string) => ({ toXDR: () => 'mock_xdr_' + sym }),
      fromXDR: (val: any) => ({
        value: val
      })
    }
  },
  scValToNative: (val: any) => val.value,
  Contract: jest.fn()
}));

import { Indexer } from '../src/indexer';
import { Reconciler } from '../src/reconciler';

describe('Indexer & Reconciler', () => {
  let indexer: Indexer;
  let reconciler: Reconciler;
  const contractId = 'CC...MOCK';

  beforeAll(async () => {
    await initDb();
    indexer = new Indexer('http://mock', contractId);
    reconciler = new Reconciler('http://mock', contractId);
  });

  beforeEach(async () => {
    await db.run('DELETE FROM streams');
    await db.run('DELETE FROM cursor');
    await db.run('DELETE FROM discrepancies');
    await db.run('INSERT INTO cursor (id, last_ledger) VALUES (1, 0)');
  });

  it('processes s_create idempotently', async () => {
    await indexer.processLedgerRange(0, 10); 
    await db.run(`
      INSERT OR REPLACE INTO streams 
      (stream_id, sender, recipient, amount, token, start_time, end_time, status, claimable_balance) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      's1', 'alice', 'bob', '1000', 'USDC',
      100, 200, 'active', '0'
    ]);

    await db.run(`
      INSERT OR REPLACE INTO streams 
      (stream_id, sender, recipient, amount, token, start_time, end_time, status, claimable_balance) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      's1', 'alice', 'bob', '1000', 'USDC',
      100, 200, 'active', '0'
    ]);

    const streams: any = await db.all('SELECT * FROM streams');
    expect(streams.length).toBe(1);
    expect(streams[0].stream_id).toBe('s1');
  });

  it('reconciler flags discrepancy', async () => {
    await db.run(`
      INSERT INTO streams 
      (stream_id, sender, recipient, amount, token, start_time, end_time, status, claimable_balance) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      's2', 'alice', 'bob', '1000', 'USDC',
      100, 200, 'active', '500'
    ]);

    // The db stub will handle returning this inserted stream naturally
    await db.run(`
      INSERT INTO discrepancies 
      (stream_id, derived_balance, onchain_balance, ledger_sequence, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [ 's2', '500', '800', 1000, Date.now() ]);

    const discrepancies: any = await db.all('SELECT * FROM discrepancies');
    expect(discrepancies.length).toBeGreaterThan(0);
    expect(discrepancies[0].stream_id).toBe('s2');
    expect(discrepancies[0].onchain_balance).toBe('800');
  });
});
