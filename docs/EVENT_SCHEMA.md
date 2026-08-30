# StellarPay On-Chain Event Schema

Canonical reference for the Soroban events emitted by the StellarPay payroll and vesting contracts. Off-chain indexers and audit tooling must key their ingestion off this document; any contract change that adds, removes, or renames an event, or alters a topic or payload shape, updates this file in the same commit.

## Conventions

- Topics are `(symbol, version?, actor?)`. The version segment is `1u32` where present. Versioning a topic lets the indexer detect a breaking schema change instead of silently mis-parsing a payload.
- The actor segment names who signed/authored the action and is deliberately NOT treated as a primary key. Identities derived from payloads are addresses; any human-attributable identity (name, email, employee ID) is off-chain and out of scope here.
- Values are `i128` base-unit token amounts and `u64` Unix timestamps unless stated otherwise.
- Payloads are terse keys, not snapshots. Most events carry an id or an amount and no other context, so a complete history row requires a read of the authoritative contract state (see the ADR).

## Payroll contract events

Contract: `contracts/contracts/payroll_stream`. Event symbols: `init`, `s_create`, `b_create`, `claim`, `cancel`.

### `init`

| Field | Type | Meaning |
| --- | --- | --- |
| topic | `(init, u32)` | symbol + version |
| value | `Address` | the organization admin |

Emitted once when the contract is initialized.

### `s_create`

| Field | Type | Meaning |
| --- | --- | --- |
| topic | `(s_create, u32, Address sender)` | symbol + version + funding sender |
| value | `u32` | the new `stream_id` |

Emitted once per stream created, including for every stream inside a batch. `b_create` is emitted in addition for batch calls.

### `b_create`

| Field | Type | Meaning |
| --- | --- | --- |
| topic | `(b_create, u32, Address sender)` | symbol + version + funding sender |
| value | `Vec<u32>` | all `stream_id`s created in the batch |

Aggregate event emitted once per batch after every per-stream `s_create` event. An indexer that stores per-stream rows from `s_create` must treat `b_create` as an audit/group record, not as a second source of the streams themselves.

### `claim`

| Field | Type | Meaning |
| --- | --- | --- |
| topic | `(claim, u32, Address recipient)` | symbol + version + claiming recipient |
| value | `i128` | `claimable` amount paid out |

Emitted for each successful stream claim. The `stream_id` is NOT in the payload, so the indexer must associate the claim with a stream. This is only possible from event data if the claim is correlated within a transaction; see the ADR for the required enrichment.

### `cancel`

| Field | Type | Meaning |
| --- | --- | --- |
| topic | `(cancel, u32, Address sender)` | symbol + version + cancelling sender |
| value | `CancelSettlement` | structured settlement |

`CancelSettlement` fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `stream_id` | `u32` | the cancelled stream |
| `recipient` | `Address` | employee recipient |
| `sender` | `Address` | organization sender |
| `recipient_amount` | `i128` | accrued amount paid to the recipient |
| `sender_refund` | `i128` | remainder returned to the sender |

The cancel event is the richest payroll payload because it carries a full settlement. Conservation holds for the contract's accounting: `recipient_amount + sender_refund + prior_claims == total_amount`, enforced by contract tests.

## Vesting contract events

Contract: `contracts/contracts/vesting`. Event symbols: `init`, `v_create`, `v_claim`, `v_revoke`.

### `init`

| Field | Type | Meaning |
| --- | --- | --- |
| topic | `(init)` | symbol (no version segment) |
| value | `Address` | the admin |

Emitted once when the contract is initialized.

### `v_create`

| Field | Type | Meaning |
| --- | --- | --- |
| topic | `(v_create, Address grantor)` | symbol + grantor |
| value | `u32` | the new `schedule_id` |

Emitted when a vesting schedule is created. Like `s_create`, the payload is only the id; schedule details (beneficiary, token, amounts, cliff, label) must be read from contract state to render history.

Note: this event has no version segment. Topic filter compatibility must tolerate the v1 shape.

### `v_claim`

| Field | Type | Meaning |
| --- | --- | --- |
| topic | `(v_claim, Address beneficiary)` | symbol + claiming beneficiary |
| value | `i128` | vested `claimable` amount paid out |

Emitted for each successful vesting claim. The `schedule_id` is NOT in the payload; the indexer must correlate the claim to a schedule from transaction context.

### `v_revoke`

| Field | Type | Meaning |
| --- | --- | --- |
| topic | `(v_revoke, u32 schedule_id)` | symbol + revoked schedule |
| value | `VestingRevocation` | structured settlement |

Emitted when a revocable schedule is revoked. `VestingRevocation` fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `schedule_id` | `u32` | the revoked schedule |
| `actor` | `Address` | the grantor who revoked |
| `beneficiary_payout` | `i128` | vested-but-unclaimed paid to beneficiary |
| `issuer_refund` | `i128` | unvested returned to the grantor |
| `prior_claims` | `i128` | already-claimed before revocation |
| `terminal_status` | `Symbol` | always `Revoked` |

Conservation invariant enforced by contract tests: `beneficiary_payout + issuer_refund + prior_claims == original_escrow`.

## Indexing implications

- **Terse payloads dominate.** `s_create`, `b_create` ids, `v_create`, `claim`, `v_claim` all omit full context. Event-only indexing cannot reconstruct a human-legible history row for these without a state read or a captured snapshot. This is the core argument for the hybrid model in the ADR.
- **`claim` and `v_claim` lack the object id.** They carry only the actor and the amount. Correlation must come from the containing transaction (operations → contract invocation args) or from a state read immediately after the event.
- **Batch creates emit per-item and aggregate events.** Deduplication and grouping are required; see the ADR idempotency section.
- **Contract state is the authoritative source** for every amount, status, timestamp, and identity that a payload does not carry. Events are the provenance/ordering layer, not the primary record.

## Versioning policy

- Adding a new event symbol is backward compatible.
- Changing an existing payload or topic shape bumps the numeric version segment where one exists and adds one where it does not. The indexer schema-version table is set from this document.
