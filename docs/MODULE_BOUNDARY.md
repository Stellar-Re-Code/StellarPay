# Module Boundary: Treasury & Governance → StellarSentinel

## Decision

**StellarSentinel owns treasury and governance. StellarPay owns payroll and vesting.**

This document defines the deprecation path and disposition matrix for the `treasury` and `governance` modules currently residing in StellarPay. These modules are being migrated to [StellarSentinel](https://github.com/Stellar-Re-Code/StellarSentinel) to eliminate duplicate custody/governance implementations and establish a clean separation of concerns.

## Cross-Repository Ownership

| Repository | Scope | Status |
|---|---|---|
| **StellarPay** | Payroll streaming, token vesting | Active |
| **StellarSentinel** | Treasury (multi-sig vault), governance (proposals + voting) | Active |

## Disposition Matrix

### Smart Contracts

| Path | Type | Disposition | Rationale | Migration Target |
|---|---|---|---|---|
| `contracts/contracts/treasury/` | Rust crate | **Migrate** | Complete multi-sig vault: initialize, deposit, approve/execute withdrawals, signer management, TTL. 12 passing tests. Already has a TODO for token transfer (SC-4). | StellarSentinel `contracts/treasury/` |
| `contracts/contracts/governance/` | Rust crate | **Migrate** | Complete proposal system: create, vote, finalize, execute proposals, member management, expiration. 7 tests. Cross-contract call to treasury stubbed (SC-24). | StellarSentinel `contracts/governance/` |
| `contracts/contracts/treasury/test_snapshots/` | Test data | **Migrate** | 18 snapshot files. Must move with source. | StellarSentinel |
| `contracts/contracts/governance/test_snapshots/` | Test data | **Migrate** | 4 snapshot files. Must move with source. | StellarSentinel |
| `contracts/Cargo.toml` | Workspace config | **Update** | Remove `contracts/treasury` and `contracts/governance` from workspace members after migration. | StellarPay (trim) |

### Frontend

| Path | Type | Disposition | Rationale | Migration Target |
|---|---|---|---|---|
| `frontend/src/app/treasury/page.tsx` | Page | **Replace** | Placeholder page. Replace with navigation to StellarSentinel dashboard and a deprecation notice. | StellarSentinel (new implementation) |
| `frontend/src/app/governance/page.tsx` | Page | **Replace** | Placeholder page. Replace with navigation to StellarSentinel dashboard and a deprecation notice. | StellarSentinel (new implementation) |
| `frontend/src/hooks/useTreasury.ts` | Hook | **Remove** | Scaffold only. No implementation. | N/A |
| `frontend/src/hooks/useGovernance.ts` | Hook | **Remove** | Scaffold only. No implementation. | N/A |

### Documentation

| Path | Type | Disposition | Rationale | Migration Target |
|---|---|---|---|---|
| `docs/ISSUES-SMARTCONTRACT.md` (SC-1..SC-8) | Issues | **Transfer** | 8 treasury issues. Move to StellarSentinel issue tracker. | StellarSentinel `docs/ISSUES-SMARTCONTRACT.md` |
| `docs/ISSUES-SMARTCONTRACT.md` (SC-21..SC-25) | Issues | **Transfer** | 5 governance issues. Move to StellarSentinel issue tracker. | StellarSentinel `docs/ISSUES-SMARTCONTRACT.md` |
| `docs/ISSUES-FRONTEND.md` (FE-6..FE-10) | Issues | **Transfer** | 5 treasury UI issues. Move to StellarSentinel. | StellarSentinel `docs/ISSUES-FRONTEND.md` |
| `docs/ISSUES-FRONTEND.md` (FE-20..FE-23) | Issues | **Transfer** | 4 governance UI issues. Move to StellarSentinel. | StellarSentinel `docs/ISSUES-FRONTEND.md` |
| `docs/ISSUES-BACKEND.md` (treasury/governance refs) | Issues | **Transfer** | Backend schemas referencing treasury_events/proposals tables. | StellarSentinel `docs/ISSUES-BACKEND.md` |
| `docs/ISSUES-SDK-TOOLING.md` (TL-2, TL-7) | Issues | **Transfer** | Treasury SDK client + governance→treasury integration test. | StellarSentinel |
| `docs/SMARTCONTRACT_GUIDE.md` | Guide | **Update** | Remove treasury/governance architecture references. | StellarPay (doc update) |
| `docs/FRONTEND_GUIDE.md` | Guide | **Update** | Remove treasury/governance page/hook references. | StellarPay (doc update) |

### Configuration / Metadata

| Path | Type | Disposition | Rationale |
|---|---|---|---|
| `frontend/src/lib/network.ts` | Config | **Trim** | Remove `treasury` and `governance` contract ID placeholders. |
| `README.md` | Documentation | **Update** | Reflect StellarPay = payroll + vesting. Remove treasury/governance from architecture diagram. |
| `CONTRIBUTING.md` | Guide | **Update** | Note deprecated modules. |

## Deprecation Timeline

| Phase | Action | Trigger |
|---|---|---|
| **Phase 1 (this PR)** | Mark modules deprecated in StellarPay. Add notices. Update docs. | Merge of this PR |
| **Phase 2** | Migrate source code + tests to StellarSentinel. | Maintainer coordination |
| **Phase 3** | Transfer open issues to StellarSentinel. | Post-migration |
| **Phase 4** | Remove deprecated code from StellarPay. Trim workspace. | After StellarSentinel integration is stable |

## Build/CI Behavior

- During Phase 1-3, treasury and governance contracts **remain in the Cargo workspace** and continue to build/test.
- No changes to CI are required — `cargo build --all` and `cargo test --all` continue to include these crates until Phase 4.
- After Phase 4, the workspace is trimmed and CI adjusts accordingly.

## Integration Boundary

Once migration is complete, the integration boundary is:

```
StellarPay (payroll / vesting)
  │
  │  On-chain cross-contract call or event-based trigger
  │
  ▼
StellarSentinel (treasury / governance)
  │
  │  Authenticated on-chain authorization
  │
  ▼
Funds disbursement
```

**Key principle:** No off-chain Sentinel approval is sufficient authorization. All cross-repository integration MUST be verifiable on-chain.

## Follow-Up Tickets

| Ticket | Description | Blocks |
|---|---|---|
| MIG-1 | Migrate `contracts/treasury/` to StellarSentinel | Phase 2 |
| MIG-2 | Migrate `contracts/governance/` to StellarSentinel | Phase 2 |
| MIG-3 | Transfer open SC/FE/BK/TL issues to StellarSentinel | Phase 3 |
| MIG-4 | Implement StellarSentinel frontend dashboard (treasury + governance) | Phase 2 |
| MIG-5 | Wire governance→treasury cross-contract call (SC-24) | Phase 2 |
| MIG-6 | Remove deprecated code from StellarPay; trim workspace | Phase 4 |

## Attribution

All contributor attribution is preserved:
- Git history travels with migrated source code.
- Issue tracker updates reference original authors.
- Migration commits cite the source repository and original contributors.
