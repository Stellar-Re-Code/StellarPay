# Escrow Asset Policy

## Decision

StellarPay must accept only Stellar Asset Contract (SAC) assets on a governance-managed allow-list. The initial allow-list should contain the network native asset and specifically approved issued Stellar assets. Do not accept arbitrary SEP-41 contract addresses, and do not rely on runtime interface checks as a substitute for allow-list membership.

A generic SEP-41 interface only proves that the entry points can be called. It does not prove conservation, immutability, pause behavior, authorization semantics, or decimal metadata. The contracts record the caller-supplied `total_amount` as the liability and therefore require an exact-value transfer in both directions.

## Supported Assets

| Behavior | Policy | Reason |
| --- | --- | --- |
| SAC native asset | Supported after allow-listing | Canonical SAC transfer and balance semantics. |
| SAC issued asset | Supported after allow-listing | Canonical SAC transfer and balance semantics, with issuer risk disclosed. |
| Fixed decimal metadata | Required for UI display | Prevents a misleading human-readable amount. Amounts on-chain remain integer stroops. |
| Issuer authorization or clawback controls | Only with explicit governance approval | These controls can make a previously funded escrow unpayable. |

## Unsupported Behaviors

| Behavior | Why it is unsafe |
| --- | --- |
| Transfer fees, burns, rebases, or recipient-dependent transfer amounts | The contract records the nominal amount but receives less collateral. |
| Pausable, blacklistable, frozen, or clawback-capable tokens without an approved issuer-risk exception | Claim, cancellation, or revocation can become unavailable after funds are accepted. |
| Non-standard transfer return or error behavior | The contracts depend on a successful call meaning the exact requested transfer settled. |
| Mutable or missing decimals metadata | The frontend currently formats all values with a fixed decimal count, which can misstate liabilities. |
| Arbitrary custom SEP-41 contracts | Interface compatibility cannot establish the escrow invariants above. |

## Demonstrated Threat

`contracts/contracts/payroll_stream/src/test.rs` contains `FeeOnTransferToken` and `test_fee_on_transfer_token_breaks_escrow_conservation`. Its `transfer` deducts 100 from the sender but credits only 99 to the recipient. A payroll stream records a 100-token obligation, but the escrow holds 99 and the final 100-token claim fails. This is a reproducible example of why a successful `transfer` call alone is not adequate validation.

## Source Assumption Map

| Location | Assumption | Failure mode |
| --- | --- | --- |
| `contracts/contracts/payroll_stream/src/lib.rs:83` | Funding transfer credits exactly `total_amount` | Fee token creates an undercollateralized stream. |
| `contracts/contracts/payroll_stream/src/lib.rs:149` | Aggregated batch transfer credits every aggregate amount | Fee token underfunds every stream sharing that asset. |
| `contracts/contracts/payroll_stream/src/lib.rs:240-241` | Escrow can transfer the recorded claimable amount | A fee, pause, or blacklist blocks recipient settlement. |
| `contracts/contracts/payroll_stream/src/lib.rs:288-295` | Escrow can settle recipient and refund exactly | Cancellation cannot preserve the recorded accounting if transfers are taxed or blocked. |
| `contracts/contracts/vesting/src/lib.rs:98-103` | Funding transfer credits exactly `total_amount` | The vesting schedule is undercollateralized at creation. |
| `contracts/contracts/vesting/src/lib.rs:149-154` | Escrow can deliver the calculated vested amount | A later token policy change can block a valid claim. |
| `contracts/contracts/vesting/src/lib.rs:219-238` | Two settlement transfers preserve the computed split | Fees or transfer controls break the revoke conservation invariant. |
| `frontend/src/components/CreateStreamForm.tsx:140-151` | User-entered contract ID is a suitable token | Arbitrary custom contracts can reach payroll creation. |
| `frontend/src/components/CreateScheduleForm.tsx:145-156` | User-entered contract ID is a suitable token | Arbitrary custom contracts can reach vesting creation. |
| `frontend/src/lib/format.ts` and both creation forms | Display uses `STELLAR_DECIMALS` | Assets with other metadata can be displayed incorrectly. |

## Frontend Requirements

The token field must become an allow-list selector populated from the selected network's approved SAC assets. Before signing, show asset code, issuer, contract ID, decimals, issuer-control warning where applicable, and the exact base-unit amount. Do not permit free-form token contract IDs for escrow creation. Existing streams should retain the recorded contract ID and show an explicit unsupported-asset warning rather than silently formatting it as a supported asset.

## Follow-up Tickets

1. Add an on-chain admin-managed asset allow-list used by payroll and vesting creation. Acceptance: creation with an unlisted contract fails before any token transfer; an approved SAC asset succeeds in both contracts.
2. Add frontend asset registry and selector. Acceptance: users cannot submit a free-form escrow asset; the confirmation view shows code, issuer, decimals, and contract ID from the registry.
3. Add escrow health monitoring for issuer controls. Acceptance: indexer reports every active escrow whose approved asset becomes frozen, paused, or otherwise non-transferable, with a linked operator runbook.

## Review Trigger

Re-evaluate this policy before enabling a new asset class, a custom SEP-41 token, or an issuer-controlled asset. Supporting custom tokens safely requires a dedicated adapter plus proofs and tests that requested transfer amounts equal received amounts for funding, claims, refunds, and revocations.
