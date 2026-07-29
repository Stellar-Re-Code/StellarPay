// Simulated in-memory database to avoid sqlite3 GLIBC issues on this system

export const dataStore = {
  cursor: { id: 1, last_ledger: 0 },
  streams: new Map<string, any>(),
  discrepancies: [] as any[]
};

export const db = {
  run: async (query: string, params: any[] = []) => {
    // Basic mock of SQL logic for our specific queries
    if (query.includes('DELETE FROM streams')) {
      dataStore.streams.clear();
    } else if (query.includes('DELETE FROM cursor')) {
      dataStore.cursor.last_ledger = 0;
    } else if (query.includes('DELETE FROM discrepancies')) {
      dataStore.discrepancies = [];
    } else if (query.includes('INSERT INTO cursor')) {
      dataStore.cursor.last_ledger = params[1] || 0;
    } else if (query.includes('UPDATE cursor')) {
      dataStore.cursor.last_ledger = params[0];
    } else if (query.includes('INSERT OR REPLACE INTO streams') || query.includes('INSERT INTO streams')) {
      const stream = {
        stream_id: params[0],
        sender: params[1],
        recipient: params[2],
        amount: params[3],
        token: params[4],
        start_time: params[5],
        end_time: params[6],
        status: params[7],
        claimable_balance: params[8]
      };
      dataStore.streams.set(stream.stream_id, stream);
    } else if (query.includes('UPDATE streams SET claimable_balance')) {
      const stream = dataStore.streams.get(params[1]);
      if (stream) stream.claimable_balance = params[0];
    } else if (query.includes('UPDATE streams SET status')) {
      const stream = dataStore.streams.get(params[1]);
      if (stream) stream.status = params[0];
    } else if (query.includes('INSERT INTO discrepancies')) {
      dataStore.discrepancies.push({
        stream_id: params[0],
        derived_balance: params[1],
        onchain_balance: params[2],
        ledger_sequence: params[3],
        created_at: params[4]
      });
    }
  },
  
  get: async (query: string, params: any[] = []) => {
    if (query.includes('SELECT last_ledger FROM cursor')) {
      return { last_ledger: dataStore.cursor.last_ledger };
    } else if (query.includes('SELECT * FROM streams WHERE stream_id')) {
      return dataStore.streams.get(params[0]);
    }
    return null;
  },
  
  all: async (query: string, params: any[] = []) => {
    if (query.includes('SELECT * FROM streams')) {
      return Array.from(dataStore.streams.values());
    } else if (query.includes('SELECT * FROM discrepancies')) {
      return dataStore.discrepancies;
    }
    return [];
  }
};

export async function initDb() {
  // DB initialized automatically in-memory
  dataStore.cursor.last_ledger = 0;
  dataStore.streams.clear();
  dataStore.discrepancies = [];
}
