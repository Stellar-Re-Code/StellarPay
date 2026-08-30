# ADR: Privacy-Preserving Payroll History and Audit Index

Status: Accepted (spike recommendation)

Date: 2026-08-30

Related issue: #79

## Context

StellarPay lets an organization stream pay and vest token compensation to employees on-chain. Today the frontend reads live contract state directly through contract reads (`get_streams_by_sender_page`, `get_claimable`, `get_schedule`, and friends); there is no history API and no persisted index. The backend contains a small event indexer prototype (`backend/src/indexer.ts`) and a reconciler scaffold (`backend/src/reconciler.ts`) with an in-memory mock database.

We need an architecture for exposing payroll and vesting history for an organization that:

- keeps a verifiable on-chain source of truth,
- minimizes the personal data collected off-chain,
- tolerates failure, restart, and duplicate events,
- can be backfilled and reconciled,
- and supports retention and access control.

This spike compares the viable approaches and recommends a first release. It does not implement the service or deploy a database; it produces the decision, the data model, the operational plan, and follow-up tickets.

### What the events actually contain

The contracts emit terse events. The full catalog is in `docs/EVENT_SCHEMA.md`. The relevant facts for this decision:

- `s_create` and `v_create` publish only the new `stream_id` / `schedule_id`.
- `claim` and `v_claim` publish only the actor and the `i128` amount; the object id is not in the payload.
- `b_create` publishes an aggregate id list on top of the per-item `s_create` events.
- Only `cancel` and `v_revoke` publish structured settlements carrying ids, both parties, and amounts.
- No event carries full object state. Amounts, statuses, timestamps, token addresses, and counterparties mostly live in contract storage, not in events.

So events alone cannot reconstruct a complete, human-legible history row for a stream or a schedule. Any design that must display the full record needs the contract as the source of truth, either read live or snapped into the index at event time.

### Platform constraints

- Soroban RPC `getEvents` pages forward with a `startLedger` cursor but has no native streaming; the indexer polls.
- RPC history is bounded by the provider retention window, about 7 days. Older queries need a data lake, Hubble, Galexie, or a self-hosted archive.
- Contract reads are cheap and authoritative for current state but cannot deliver history: a completed or cancelled stream is still in storage (streams are never deleted), but there is no built-in "list all claims ever made on this stream" primitive; `claimed_amount` is an aggregate, not a ledger of claims.
- Token transfer events from the SAC asset contract are available on-chain and are the ground truth for movement of the asset itself.

## Options considered

### Option A: Direct RPC reads only

Serve history by calling the contracts live on each request.

Strengths: no index to build or maintain, nothing stored, privacy is trivial because nothing is persisted.

Weaknesses: cannot answer "what happened on stream X" because there is no event ledger primitive; `claimed_amount` is a running total, not a history. Terse `claim`/`v_claim` events are not reconstructable into per-stream lines without replaying transaction history, which RPC does not retain past its window. No audit trail, no organizational rollup, no paginated history. Restart and backfill concerns disappear but so does the product's core feature (history and audit).

Verdict: rejected as a standalone model. It remains the correctness backstop and the reconciliation target.

### Option B: Event indexer only

Persist events into a database and serve history from the persisted event log.

Strengths: gives ordering, provenance (tx hash, ledger), and an append-only audit trail. This is what the prototype indexer reaches toward.

Weaknesses: because the payloads are terse, the stored event rows still cannot render a complete history row without a state source. A `claim` row has an actor and an amount but no stream id; a `v_create` row has an id but no beneficiary, token, or amounts. Restricting the model to events means either storing useless partial rows or, worse, guessing identities and amounts that are not in the data. It also duplicates what the contract already records.

Verdict: rejected as a standalone model because the event set is a provenance log, not a complete relational picture.

### Option C: Hybrid — event-driven materialization with contract reads (recommended)

Use events to drive ingestion, provenance, and ordering, and read contract state to fill the fields events do not carry. Two cooperating layers:

1. A forward indexer polls `getEvents`, filters the four StellarPay contracts plus relevant SAC transfer events, and for each event captures the transaction context and the authoritative contract read for the affected object.
2. A materialized view in PostgreSQL persists one row per stream and one per vesting schedule (current authoritative state), plus an append-only event ledger for history and audit, plus an account link table used only for access control.

The contract remains the source of truth; the database is a derived, indexed, queryable projection that can always be rebuilt from chain state and reconciled against it.

Decision: record Option C as the architecture.

## Why hybrid

- Every displayed field has a stated authoritative source (table below): contract reads for amounts, statuses, timestamps, and identities that the events omit; events for the fact and order of the action; the SAC asset contract for actual token movement.
- Events give the ordering and provenance that contract state does not; contract state gives the completeness that terse events do not. Each covers the other's gap.
- The materialized view is rebuildable and reconcilable, which satisfies the "verifiable on-chain source of truth" requirement: any row can be traced to a ledger and a read.
- Privacy is controlled at the write boundary: the index stores only on-chain identifiers and derived amounts, and an explicit account-link table scopes what each querier may see.

## Authoritative source for every displayed history field

| Displayed field | Authoritative source | How the index gets it |
| --- | --- | --- |
| stream id / schedule id | contract event | parsed from event payload |
| sender / grantor, recipient / beneficiary | contract storage | read after `s_create` / `v_create` event |
| token | contract storage | read after creation event |
| total amount, claimed amount, rate / vesting params, cliff | contract storage | read after creation and refreshed on state change |
| status (active/paused/cancelled/completed, revoked/fully claimed) | contract storage | read after every event touching the object |
| start / end / last claim timestamps | contract storage | read after creation and on claims |
| each claim (amount, time, actor) | event + tx context | `claim` / `v_claim` event correlated to stream via transaction; amount from event, object id from tx args or state read |
| cancellation / revocation settlement | event payload | `cancel` / `v_revoke` carries the full settlement |
| actual token movement | SAC `transfer` event | emitted by the asset contract in the same transaction |
| organizational rollup (totals, burn rate) | derived | computed from the materialized rows |

The rationale for contract reads as the source for most fields is structural: the events deliberately carry keys, not snapshots, and `claim`/`v_claim` do not even carry the object id. Recording a claim as merely `(actor, amount)` would be non-attributable. The hybrid model attributes every claim to a stream using the containing transaction, then re-reads state so the stored row is complete at write time.

## Event-to-table mapping

The mapping is built from `docs/EVENT_SCHEMA.md`. Base units are integers (stroops) with decimals resolved only for display.

### `streams` (materialized current state, one row per stream)

| Column | Populated by | Notes |
| --- | --- | --- |
| `stream_id` | `s_create` | primary key |
| `sender`, `recipient`, `token` | read after `s_create` | stored as on-chain addresses |
| `total_amount`, `rate_per_second`, `start_time`, `end_time` | read after `s_create` | |
| `claimed_amount`, `status`, `last_claim_time` | read after `claim` / `cancel` | status transitions: claim can complete; cancel sets cancelled |
| `created_ledger`, `created_tx`, `created_at` | `s_create` event | provenance |
| `last_event_ledger`, `last_seen_at` | any event | monotonic marker for reconciliation |

### `vesting_schedules` (materialized current state)

| Column | Populated by | Notes |
| --- | --- | --- |
| `schedule_id` | `v_create` | primary key |
| `grantor`, `beneficiary`, `token` | read after `v_create` | |
| `total_amount`, `claimed_amount`, `cliff_duration`, `cliff_amount`, `total_duration`, `label` | read after `v_create` | |
| `status`, `revocable` | read after `v_create`; status refreshes on `v_claim` / `v_revoke` | |
| `created_ledger`, `created_tx`, `created_at` | `v_create` event | |

### `stream_events` / `vesting_events` (append-only event ledger for history and audit)

| Column | Populated by | Notes |
| --- | --- | --- |
| `event_id` | indexer | unique, e.g. `(ledger, tx, index)` |
| `event_type` | event symbol | `s_create`, `b_create`, `claim`, `cancel`, `v_create`, `v_claim`, `v_revoke` |
| `object_id` | event or tx context | stream/schedule id |
| `actor` | event | sender / recipient / grantor / beneficiary |
| `amount` | event | claimable / payout / refund where present, else null |
| `payload_json` | event | full decoded payload for settlements |
| `ledger`, `tx_hash`, `created_at` | event | provenance |
| `indexer_version` | indexer | schema version from `EVENT_SCHEMA.md` |

`b_create` is stored in `stream_events` as a batch audit row only; the individual streams come from the per-item `s_create` events so streams are never double-counted.

### `batch_creates` (audit grouping for payroll batches)

| Column | Populated by | Notes |
| --- | --- | --- |
| `tx_hash` | `b_create` | groups one batch |
| `sender`, `stream_ids` | `b_create` payload | array of ids |

### `account_links` (access control only, never a history field)

| Column | Populated by | Notes |
| --- | --- | --- |
| `address` | first event seen for it | derived from events |
| `role` | config | `admin`, `recipient`, `grantor`, `beneficiary`, `auditor` |
| `org_id` | config | which organization this address belongs to |

This table exists to scope queries. It stores only on-chain addresses and a role tag; it never stores email, name, employee id, or any off-chain personal data.

### `indexer_state` (cursor + version bookkeeping)

| Column | Notes |
| --- | --- |
| `last_ledger` | durable poll cursor |
| `schema_version` | from `EVENT_SCHEMA.md` |

## Operational plan

### Backfill

Capture the RPC retention window first. Strategy is idempotent and resumable:

1. Initialize the contract set: read `get_stream_count` / `get_schedule_count`, then page all objects by index (the contracts expose deterministic paged listing) to seed `streams` and `vesting_schedules` from live contract state.
2. For history older than the RPC window, page `getLedgers` backward from a data lake or archive provider if deep history is required; otherwise record the backfill anchor and scope history to the retention window for the first release.
3. Replay events within the window from the anchor ledger forward, applying the same upsert paths the live indexer uses.
4. Mark the anchor in `indexer_state`; never treat a partially applied ledger as durable.

Because backfill and live ingestion share the same idempotent upsert path, a backfill run and a live poll can target the same rows without conflict; the reconciler is the arbiter.

### Idempotency and duplicate-event handling

- Row identity is content-derived, not auto-increment: `streams` and `vesting_schedules` key on the on-chain id; events key on `(ledger, tx, index)`.
- Business-logic upserts are `INSERT ... ON CONFLICT DO UPDATE`, and state rows carry a monotonic `last_event_ledger` so a stale or out-of-order write never regresses fresher state. A write with `last_event_ledger <=` the stored value is skipped.
- Batch double-counting is prevented by structure: streams are created only from per-item `s_create` events; `b_create` is an audit row only.
- Restart recovery uses a single durable cursor column. On restart the indexer resumes at `last_ledger`, reads forward with a small overlap window, and relies on the idempotent upserts to absorb re-read items.
- Claims are attributed to a stream from transaction context, then confirmed by a state read; a claim whose object cannot be resolved is parked for reconciliation rather than guessed.

### Reconciliation

A periodic job compares the materialized rows against two ground truths:

1. Contract state: re-read each active stream and schedule and diff `claimed_amount`, `status`, and derived totals against the stored row. Mismatches are recorded in a `discrepancies` table with `(object_id, derived, onchain, ledger, created_at)`.
2. Token movement: sum the `claim`/`v_claim`/`cancel`/`v_revoke` events per object and check they tie to the SAC `transfer` events and to the contract's `claimed_amount`.

The reconciler is not a trust anchor by itself; it is the backstop that turns a silent indexer bug into a visible, actionable discrepancy. It must be wired into monitoring as an alert, not a silent job. The prototype reconciler (`backend/src/reconciler.ts`) is the seed for this; its mock state reads must be replaced with real `simulateTransaction` read invocations, which is tracked as a follow-up ticket.

## Failure / restart / configuration

- Failure modes addressed: RPC outage (backoff + retry with exponential backoff, durable cursor), partial batch (idempotent upserts), duplicate ingestion (content-derived keys), out-of-order writes (monotonic marker), schema drift (versioned events from `EVENT_SCHEMA.md`).
- Required configuration is explicit and env-driven: RPC endpoint, the four contract ids, poll interval, retention anchor, list of approved assets, reconciliation interval, retention window, and the access-control allow-list. All of it ships in `.env.example` with the first release.

## Privacy, access control, and retention

### What is never stored

The design stores only on-chain identifiers and derived amounts. It must never store:

- employee name, email, phone, or employee id,
- legal, tax, or bank identifiers,
- salary figures expressed in human currency or any amount outside what the on-chain record already publicizes,
- wallet addresses for no purpose beyond what an audit row requires.

Storing a tiny set of on-chain identifiers (the parties present in each event) is unavoidable to render history and is exactly what the on-chain record already exposes. The index adds no new personal data about a person beyond linking the same public identifiers already visible on the ledger; it organizes them for query.

### Access control

- The `account_links` table scopes reads: an organization admin sees rows where they are `sender`/`grantor`; a recipient/beneficiary sees only their own rows; an auditor sees configured scoped history. Authorization is enforced on every read endpoint, never by filtering in the client.
- Endpoints that expose "payroll history for an organization" must be restricted to the configured admin/auditor role for that organization and must never return another organization's counterparties' rows.
- This protection is administrative: the data is public on-chain. The indexer does not pretend it is a privacy shroud; it prevents casual bulk enumeration through the API.

### Retention

- The event ledger and materialized views are append-mostly and normally never pruned while an object is active. Retention policy is required configuration:
  - `RETENTION_WINDOW`: how long the event ledger keeps rows after an object reaches a terminal state (cancelled, completed, revoked, fully claimed). Default e.g. 7 years to match common payroll audit obligations.
  - `PURGE_UNLINKED`: whether to drop account-link rows whose address has no remaining active rows, to honor "delete on request" under privacy expectations.
  - Tokens with clawback or issuer-control risk (documented in `ASSET_POLICY.md`) have their own monitoring, not retention, implications.
- The privacy trade-off is explicit: full history requires storing event rows forever, and per-request deletion of an entity's ledger is impossible because contract events are immutable and public. What can be deleted is any local enumeration (account links) and any project-internal derived table, via `PURGE_UNLINKED`.

## Recommended first release

Ship, in order:

1. `EVENT_SCHEMA.md` (this PR) and the ADR as the contract for all later work.
2. PostgreSQL schema and migrations for the tables above; `.env.example` with the required configuration.
3. A forward indexer that polls `getEvents`, correlates claims to objects, and writes state rows with the monotonic guard. Replace the mock in-memory db with the real adapter.
4. A reconciler whose contract reads are real `simulateTransaction` invocations, wired to the discrepancies table and an alert.
5. A read API (`GET /api/streams`, `GET /api/vesting`, event endpoints) enforcing the access-control scope from `account_links`.
6. Retention and purge jobs driven by `RETENTION_WINDOW` and `PURGE_UNLINKED`.

The first release intentionally omits deep pre-window history (bounded by RPC retention) and omits treasury/governance history, which is migrating to StellarSentinel.

## Follow-up tickets

Split into independently mergeable, serially listed work. Each is mergeable on its own with its own tests.

1. **BK-11** Backend database schema and migrations for the tables above. Acceptance: migrations apply cleanly to a fresh Postgres; every table has a uniqueness constraint matching the content-derived identity rules.
2. **BK-12** Forward event indexer for payroll and vesting with claim correlation to object id. Acceptance: getEvents poll writes state rows and event ledger with the monotonic no-regression guard; restart resumes without duplication (tested).
3. **BK-13** Batch create audit handling. Acceptance: `b_create` stored as an audit row; per-item `s_create` streams are not double-counted; test covers a 50-stream batch.
4. **BK-14** Real reconciler replacing mock reads with `simulateTransaction`. Acceptance: reconciler against a local/standalone network flags a forced discrepancy and records it in `discrepancies`.
5. **BK-15** Read API with access-control scoping. Acceptance: admin, recipient, and auditor sees only their scoped rows; cross-organization reads rejected.
6. **BK-16** Backfill from RPC anchor and the first-release retention/purge jobs. Acceptance: backfill reproduces idempotently; `PURGE_UNLINKED` drops only unlinked links.

## Out of scope

Implementing the service, deploying a database, migrating treasury/governance data, and deep pre-window history.

## Alternatives revisited

Option A (direct reads) stays valuable as the correctness backstop and as the fallback UI if the index is down. Keeping the frontend contract-read path intact is intentional; the index complements it and does not replace it.
