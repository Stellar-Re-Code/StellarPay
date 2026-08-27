#![cfg(test)]

//! Property-based / invariant fuzz tests for the vesting contract.
//!
//! Uses a seeded PRNG to verify:
//! - Conservation: claimed + refunded + escrow == total_amount
//! - Monotonic accrual: vested amount is non-decreasing over time
//! - Cliff: nothing (beyond cliff_amount) is claimable before cliff
//! - Terminal states: no payout after Revoked/FullyClaimed
//! - No overflow in i128 accrual math

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

// ── Seeded PRNG ────────────────────────────────────────────────

struct Rng {
    state: u32,
}

impl Rng {
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let mut z = self.state;
        z = (z ^ (z >> 15)) & 0x7FFFFFFF;
        z = z.wrapping_mul(0x85EBCA6B);
        z = z ^ (z >> 13);
        z = z.wrapping_mul(0xC2B2AE35);
        z ^ (z >> 16)
    }

    fn range_u64(&mut self, lo: u64, hi: u64) -> u64 {
        if lo >= hi {
            return lo;
        }
        lo + (self.next_u32() as u64 % (hi - lo + 1))
    }

    fn range_i128(&mut self, lo: i128, hi: i128) -> i128 {
        if lo >= hi {
            return lo;
        }
        lo + (self.next_u32() as i128 % (hi - lo + 1))
    }
}

// ── Test helpers ───────────────────────────────────────────────

fn create_token_contract<'a>(e: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let contract_addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(e, &contract_addr)
}

fn create_token_client<'a>(e: &Env, contract_addr: &Address) -> token::Client<'a> {
    token::Client::new(e, contract_addr)
}

/// Returns (env, admin, contract_address, client).
fn setup_env() -> (Env, Address, Address, VestingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VestingContract, ());
    let client = VestingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, contract_id, client)
}

fn tok_balance(e: &Env, tok: &Address, addr: &Address) -> i128 {
    create_token_client(e, tok).balance(addr)
}

// ── Conservation: full lifecycle through revoke ────────────────

#[test]
fn prop_conservation_revoke() {
    let mut rng = Rng::new(0xA110_0001);
    for _ in 0..15 {
        let (env, admin, _contract, client) = setup_env();
        let grantor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();

        let total = rng.range_i128(10_000, 500_000);
        token_admin_client.mint(&grantor, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 10_000);
        let year = 365 * 24 * 60 * 60_u64;
        let cliff_duration = rng.range_u64(year, 2 * year);
        let total_duration = rng.range_u64(3 * year, 5 * year);
        let cliff_amount = rng.range_i128(0, total / 4);

        env.ledger().with_mut(|li| li.timestamp = start);
        let schedule_id = client.create_schedule(
            &grantor,
            &beneficiary,
            &tok,
            &total,
            &start,
            &cliff_duration,
            &cliff_amount,
            &total_duration,
            &symbol_short!("team"),
            &true,
        );

        // Move to 50% vesting, then revoke
        let revoke_time = start + total_duration / 2;
        env.ledger().with_mut(|li| li.timestamp = revoke_time);

        let vested_before = client.get_progress(&schedule_id).vested_amount;
        let settlement = client.revoke(&grantor, &schedule_id);

        // STRONG conservation (issue #77): payout + refund + prior claims == escrow
        assert_eq!(
            settlement.beneficiary_payout + settlement.issuer_refund + settlement.prior_claims,
            total,
            "Revoke conservation: payout={} refund={} prior={} != total={}",
            settlement.beneficiary_payout,
            settlement.issuer_refund,
            settlement.prior_claims,
            total,
        );
        assert_eq!(settlement.beneficiary_payout, vested_before);

        // Beneficiary actually received the payout on-chain.
        assert_eq!(
            tok_balance(&env, &tok, &beneficiary),
            settlement.beneficiary_payout
        );
        assert_eq!(
            tok_balance(&env, &tok, &grantor),
            total - settlement.beneficiary_payout
        );
        assert_eq!(tok_balance(&env, &tok, &_contract), 0);
    }
}

// ── Conservation: claim then revoke ────────────────────────────

#[test]
fn prop_conservation_claim_then_revoke() {
    let mut rng = Rng::new(0xA110_0002);
    for _ in 0..15 {
        let (env, admin, _contract, client) = setup_env();
        let grantor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();

        let total = rng.range_i128(10_000, 500_000);
        token_admin_client.mint(&grantor, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 10_000);
        let year = 365 * 24 * 60 * 60_u64;
        let cliff_duration = rng.range_u64(year, 2 * year);
        let total_duration = rng.range_u64(3 * year, 5 * year);
        let cliff_amount = rng.range_i128(0, total / 4);

        env.ledger().with_mut(|li| li.timestamp = start);
        let schedule_id = client.create_schedule(
            &grantor,
            &beneficiary,
            &tok,
            &total,
            &start,
            &cliff_duration,
            &cliff_amount,
            &total_duration,
            &symbol_short!("team"),
            &true,
        );

        // Claim at 50%
        let claim_time = start + total_duration / 2;
        env.ledger().with_mut(|li| li.timestamp = claim_time);
        let claimed = client.claim(&beneficiary, &schedule_id);

        // Revoke at 75%
        let revoke_time = start + (total_duration * 3) / 4;
        env.ledger().with_mut(|li| li.timestamp = revoke_time);
        let settlement = client.revoke(&grantor, &schedule_id);

        // STRONG conservation (issue #77): payout + refund + prior claims == escrow
        assert_eq!(
            settlement.beneficiary_payout + settlement.issuer_refund + settlement.prior_claims,
            total,
            "Revoke conservation: payout={} refund={} prior={} != total={}",
            settlement.beneficiary_payout,
            settlement.issuer_refund,
            settlement.prior_claims,
            total,
        );
        assert_eq!(settlement.prior_claims, claimed);

        // On-chain balances: beneficiary holds claim + revocation payout,
        // grantor got exactly the refund, contract is fully drained.
        assert_eq!(
            tok_balance(&env, &tok, &beneficiary),
            claimed + settlement.beneficiary_payout
        );
        assert_eq!(
            tok_balance(&env, &tok, &grantor),
            settlement.issuer_refund,
            "DBG total={} claimed={} payout={} refund={}",
            total,
            claimed,
            settlement.beneficiary_payout,
            settlement.issuer_refund
        );
        assert_eq!(tok_balance(&env, &tok, &_contract), 0);
    }
}

// ── Monotonicity: vested is non-decreasing ─────────────────────

#[test]
fn prop_monotonic_vested() {
    let mut rng = Rng::new(0xA110_0003);
    for _ in 0..15 {
        let (env, admin, _contract, client) = setup_env();
        let grantor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();

        let total = rng.range_i128(10_000, 500_000);
        token_admin_client.mint(&grantor, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 10_000);
        let year = 365 * 24 * 60 * 60_u64;
        let cliff_duration = rng.range_u64(year, 2 * year);
        let total_duration = rng.range_u64(3 * year, 5 * year);
        let cliff_amount = rng.range_i128(0, total / 4);

        env.ledger().with_mut(|li| li.timestamp = start);
        let schedule_id = client.create_schedule(
            &grantor,
            &beneficiary,
            &tok,
            &total,
            &start,
            &cliff_duration,
            &cliff_amount,
            &total_duration,
            &symbol_short!("team"),
            &true,
        );

        let mut prev_vested = 0i128;
        for i in 0..=20 {
            let t = start + (total_duration * i) / 20;
            env.ledger().with_mut(|li| li.timestamp = t);
            let progress = client.get_progress(&schedule_id);
            let vested = progress.vested_amount;

            assert!(
                vested >= prev_vested,
                "Monotonicity violated at t={t}: vested={vested} < prev={prev_vested}",
            );
            assert!(vested <= total, "Vested {vested} > total {total}");
            prev_vested = vested;
        }
    }
}

// ── Cliff: nothing before cliff (except cliff_amount) ──────────

#[test]
fn prop_cliff_invariant() {
    let mut rng = Rng::new(0xA110_0004);
    for _ in 0..15 {
        let (env, admin, _contract, client) = setup_env();
        let grantor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();

        let total = rng.range_i128(10_000, 500_000);
        token_admin_client.mint(&grantor, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 10_000);
        let year = 365 * 24 * 60 * 60_u64;
        let cliff_duration = rng.range_u64(year, 2 * year);
        let total_duration = rng.range_u64(3 * year, 5 * year);
        let cliff_amount = rng.range_i128(0, total / 4);

        env.ledger().with_mut(|li| li.timestamp = start);
        let schedule_id = client.create_schedule(
            &grantor,
            &beneficiary,
            &tok,
            &total,
            &start,
            &cliff_duration,
            &cliff_amount,
            &total_duration,
            &symbol_short!("team"),
            &true,
        );

        // Before cliff: vested should be 0
        let before_cliff = start + cliff_duration / 2;
        env.ledger().with_mut(|li| li.timestamp = before_cliff);
        let progress_before = client.get_progress(&schedule_id);
        assert_eq!(
            progress_before.vested_amount, 0,
            "Should be 0 before cliff (vested={})",
            progress_before.vested_amount,
        );
        assert_eq!(
            progress_before.claimable_amount, 0,
            "Nothing claimable before cliff",
        );

        // At cliff: vested should be cliff_amount
        let at_cliff = start + cliff_duration;
        env.ledger().with_mut(|li| li.timestamp = at_cliff);
        let progress_at_cliff = client.get_progress(&schedule_id);
        assert_eq!(
            progress_at_cliff.vested_amount, cliff_amount,
            "At cliff: vested={} should equal cliff_amount={}",
            progress_at_cliff.vested_amount, cliff_amount,
        );
    }
}

// ── Terminal states: no claim after FullyClaimed ───────────────

#[test]
fn prop_terminal_no_claim_after_fully_claimed() {
    let mut rng = Rng::new(0xA110_0005);
    for _ in 0..10 {
        let (env, admin, _contract, client) = setup_env();
        let grantor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();

        let total = rng.range_i128(1_000, 50_000);
        token_admin_client.mint(&grantor, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let year = 365 * 24 * 60 * 60_u64;

        env.ledger().with_mut(|li| li.timestamp = start);
        let schedule_id = client.create_schedule(
            &grantor,
            &beneficiary,
            &tok,
            &total,
            &start,
            &(year),
            &(total / 4),
            &(4 * year),
            &symbol_short!("team"),
            &true,
        );

        // Move past full vesting
        env.ledger().with_mut(|li| li.timestamp = start + 4 * year);
        let _ = client.claim(&beneficiary, &schedule_id);

        let schedule = client.get_schedule(&schedule_id);
        assert_eq!(schedule.status, VestingStatus::FullyClaimed);

        // Further claims should fail
        env.ledger()
            .with_mut(|li| li.timestamp = start + 4 * year + 1000);
        let result = client.try_claim(&beneficiary, &schedule_id);
        assert!(result.is_err(), "Claim should fail after FullyClaimed");
    }
}

// ── Terminal states: no claim after Revoked ────────────────────

#[test]
fn prop_terminal_no_claim_after_revoke() {
    let mut rng = Rng::new(0xA110_0006);
    for _ in 0..10 {
        let (env, admin, _contract, client) = setup_env();
        let grantor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();

        let total = rng.range_i128(1_000, 50_000);
        token_admin_client.mint(&grantor, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let year = 365 * 24 * 60 * 60_u64;

        env.ledger().with_mut(|li| li.timestamp = start);
        let schedule_id = client.create_schedule(
            &grantor,
            &beneficiary,
            &tok,
            &total,
            &start,
            &(year),
            &(total / 4),
            &(4 * year),
            &symbol_short!("team"),
            &true,
        );

        // Claim at 50%
        env.ledger().with_mut(|li| li.timestamp = start + 2 * year);
        let _ = client.claim(&beneficiary, &schedule_id);

        // Revoke at 75%
        env.ledger().with_mut(|li| li.timestamp = start + 3 * year);
        let _ = client.revoke(&grantor, &schedule_id);

        let schedule = client.get_schedule(&schedule_id);
        assert_eq!(schedule.status, VestingStatus::Revoked);

        // Further claims should fail
        env.ledger()
            .with_mut(|li| li.timestamp = start + 3 * year + 1000);
        let result = client.try_claim(&beneficiary, &schedule_id);
        assert!(result.is_err(), "Claim should fail after Revoked");
    }
}

// ── Overflow: large amounts don't panic ────────────────────────

#[test]
fn prop_no_overflow_large_amounts() {
    let mut rng = Rng::new(0xA110_0007);
    for _ in 0..10 {
        let (env, admin, _contract, client) = setup_env();
        let grantor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();

        let total = rng.range_i128(10_000_000, 1_000_000_000_000);
        token_admin_client.mint(&grantor, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 10_000);
        let year = 365 * 24 * 60 * 60_u64;

        env.ledger().with_mut(|li| li.timestamp = start);
        let schedule_id = client.create_schedule(
            &grantor,
            &beneficiary,
            &tok,
            &total,
            &start,
            &(year),
            &(total / 4),
            &(4 * year),
            &symbol_short!("team"),
            &true,
        );

        // Vest at 50% — must not overflow
        env.ledger().with_mut(|li| li.timestamp = start + 2 * year);
        let progress = client.get_progress(&schedule_id);
        assert!(progress.vested_amount >= 0, "Negative vested");
        assert!(progress.vested_amount <= total, "Vested > total");
    }
}
