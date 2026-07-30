#![cfg(test)]

//! Property-based / invariant fuzz tests for the payroll stream contract.
//!
//! Uses a seeded PRNG and model-based testing to verify:
//! - Conservation: claimed + refunded + escrow == total_amount
//! - Monotonic accrual: claimable is non-decreasing until fully vested
//! - No negative / no overflow in i128 accrual math
//! - Terminal states: no payout after Cancelled/Completed

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, token,
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
        if lo >= hi { return lo; }
        lo + (self.next_u32() as u64 % (hi - lo + 1))
    }

    fn range_i128(&mut self, lo: i128, hi: i128) -> i128 {
        if lo >= hi { return lo; }
        lo + (self.next_u32() as i128 % (hi - lo + 1))
    }
}

// ── Test helpers ───────────────────────────────────────────────

fn create_token_contract<'a>(
    e: &Env,
    admin: &Address,
) -> token::StellarAssetClient<'a> {
    let contract_addr = e.register_stellar_asset_contract(admin.clone());
    token::StellarAssetClient::new(e, &contract_addr)
}

fn create_token_client<'a>(e: &Env, contract_addr: &Address) -> token::Client<'a> {
    token::Client::new(e, contract_addr)
}

/// Returns (env, admin, contract_address, client).
fn setup_env() -> (Env, Address, Address, PayrollStreamContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayrollStreamContract, ());
    let client = PayrollStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, contract_id, client)
}

fn tok_balance(e: &Env, tok: &Address, addr: &Address) -> i128 {
    create_token_client(e, tok).balance(addr)
}

/// Verify the full-stream conservation invariant:
///   escrow + claimed_out + refunded_out == total_amount
/// After cancel, escrow should be 0 and the settlement amounts should sum to total.
fn assert_stream_conservation(
    total: i128,
    contract_balance: i128,
    settlement_recipient: i128,
    settlement_refund: i128,
) {
    assert_eq!(
        contract_balance + settlement_recipient + settlement_refund,
        total,
        "Stream conservation violated: escrow={contract_balance} \
         claimable={settlement_recipient} refund={settlement_refund} total={total}",
    );
}

/// Conservation check that includes prior claims already distributed.
fn assert_stream_conservation_with_prior_claims(
    total: i128,
    contract_balance: i128,
    prior_claimed: i128,
    settlement_recipient: i128,
    settlement_refund: i128,
) {
    assert_eq!(
        contract_balance + prior_claimed + settlement_recipient + settlement_refund,
        total,
        "Stream conservation violated: escrow={contract_balance} \
         prior_claimed={prior_claimed} claimable={settlement_recipient} \
         refund={settlement_refund} total={total}",
    );
}

fn assert_non_negative(val: i128, label: &str) {
    assert!(val >= 0, "Negative balance: {label}={val}");
}

// ── Conservation: cancel before start ──────────────────────────

#[test]
fn prop_conservation_cancel_before_start() {
    let mut rng = Rng::new(0xDEAD_BEEF);
    for _ in 0..20 {
        let (env, admin, contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(1_000, 500_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(100, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        env.ledger().with_mut(|li| li.timestamp = start.saturating_sub(1));
        let settlement = client.cancel_stream(&sender, &stream_id);

        let cb = tok_balance(&env, &tok, &contract);
        assert_stream_conservation(
            total, cb,
            settlement.recipient_amount,
            settlement.sender_refund,
        );
        assert_eq!(settlement.recipient_amount + settlement.sender_refund, total);
        assert_non_negative(cb, "contract");
        assert_non_negative(settlement.recipient_amount, "recipient_claimable");
        assert_non_negative(settlement.sender_refund, "sender_refund");
    }
}

// ── Conservation: cancel midway ────────────────────────────────

#[test]
fn prop_conservation_cancel_midway() {
    let mut rng = Rng::new(0xCAFE_BABE);
    for _ in 0..20 {
        let (env, admin, contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(1_000, 500_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(100, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        let cancel_time = start + duration / 2;
        env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let settlement = client.cancel_stream(&sender, &stream_id);

        let cb = tok_balance(&env, &tok, &contract);
        assert_stream_conservation(
            total, cb,
            settlement.recipient_amount,
            settlement.sender_refund,
        );
        assert_eq!(settlement.recipient_amount + settlement.sender_refund, total);
        assert_non_negative(cb, "contract");
        assert_non_negative(settlement.recipient_amount, "recipient_claimable");
        assert_non_negative(settlement.sender_refund, "sender_refund");
    }
}

// ── Conservation: claim then cancel ────────────────────────────

#[test]
fn prop_conservation_claim_then_cancel() {
    let mut rng = Rng::new(0xFACE_1234);
    for _ in 0..20 {
        let (env, admin, contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(1_000, 500_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(200, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        let claim_time = start + duration / 2;
        env.ledger().with_mut(|li| li.timestamp = claim_time);
        let prior_claim = client.claim(&recipient, &stream_id);

        let cancel_time = start + (duration * 3) / 4;
        env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let settlement = client.cancel_stream(&sender, &stream_id);

        let cb = tok_balance(&env, &tok, &contract);
        assert_stream_conservation_with_prior_claims(
            total, cb, prior_claim,
            settlement.recipient_amount,
            settlement.sender_refund,
        );
        assert_eq!(
            settlement.recipient_amount + settlement.sender_refund,
            total - (total * (duration as i128 / 2) / duration as i128),
        );
        assert_non_negative(cb, "contract");
        assert_non_negative(settlement.recipient_amount, "recipient_claimable");
        assert_non_negative(settlement.sender_refund, "sender_refund");
    }
}

// ── Conservation: multiple claims then cancel ──────────────────

#[test]
fn prop_conservation_multi_claim_then_cancel() {
    let mut rng = Rng::new(0x1234_5678);
    for _ in 0..20 {
        let (env, admin, contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(2_000, 500_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(400, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        let t1 = start + duration / 4;
        env.ledger().with_mut(|li| li.timestamp = t1);
        let c1 = client.claim(&recipient, &stream_id);

        let t2 = start + duration / 2;
        env.ledger().with_mut(|li| li.timestamp = t2);
        let c2 = client.claim(&recipient, &stream_id);

        let t3 = start + (duration * 3) / 4;
        env.ledger().with_mut(|li| li.timestamp = t3);
        let c3 = client.claim(&recipient, &stream_id);

        let total_claimed = c1 + c2 + c3;

        let cancel_time = t3 + 1;
        env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let settlement = client.cancel_stream(&sender, &stream_id);

        let cb = tok_balance(&env, &tok, &contract);
        assert_stream_conservation_with_prior_claims(
            total, cb, total_claimed,
            settlement.recipient_amount,
            settlement.sender_refund,
        );
        assert_eq!(
            settlement.recipient_amount + settlement.sender_refund,
            total - total_claimed,
        );
        assert_non_negative(cb, "contract");
        assert_non_negative(settlement.recipient_amount, "recipient_claimable");
        assert_non_negative(settlement.sender_refund, "sender_refund");
    }
}

// ── Monotonicity: claimable is non-decreasing in time ──────────

#[test]
fn prop_monotonic_claimable() {
    let mut rng = Rng::new(0xBEEF_4321);
    for _ in 0..20 {
        let (env, admin, _contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(1_000, 500_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(200, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        let mut prev_claimable = 0i128;
        for i in 1..=10 {
            let t_now = start + (duration * i) / 10;
            env.ledger().with_mut(|li| li.timestamp = t_now);
            let claimable = client.get_claimable(&stream_id);
            assert!(
                claimable >= prev_claimable,
                "Monotonicity violated at t={t_now}: {claimable} < {prev_claimable}",
            );
            assert!(claimable <= total, "Claimable {claimable} > total {total}");
            prev_claimable = claimable;
        }
    }
}

// ── Monotonicity: after full vest, claimable stays constant ────

#[test]
fn prop_monotonic_post_completion() {
    let mut rng = Rng::new(0xFEED_5678);
    for _ in 0..10 {
        let (env, admin, _contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(1_000, 500_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(100, 1000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        env.ledger().with_mut(|li| li.timestamp = end);
        let claimable_at_end = client.get_claimable(&stream_id);
        assert!(claimable_at_end > 0, "Nothing claimable at end");
        let _ = client.claim(&recipient, &stream_id);

        env.ledger().with_mut(|li| li.timestamp = end + 1000);
        let claimable_after = client.get_claimable(&stream_id);
        assert_eq!(claimable_after, 0);
    }
}

// ── Terminal states: no payout after cancellation ──────────────

#[test]
fn prop_terminal_no_claim_after_cancel() {
    let mut rng = Rng::new(0xABCD_9999);
    for _ in 0..10 {
        let (env, admin, _contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(5_000, 100_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(200, 1000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        let cancel_time = start + duration / 2;
        env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let _ = client.cancel_stream(&sender, &stream_id);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.status, StreamStatus::Cancelled);

        env.ledger().with_mut(|li| li.timestamp = cancel_time + 100);
        let result = client.try_claim(&recipient, &stream_id);
        assert!(result.is_err(), "Claim should fail on cancelled stream");

        let result2 = client.try_cancel_stream(&sender, &stream_id);
        assert!(result2.is_err(), "Double cancel should fail");
    }
}

// ── Terminal states: no payout after completion ────────────────

#[test]
fn prop_terminal_no_claim_after_complete() {
    let mut rng = Rng::new(0xDADD_7777);
    for _ in 0..10 {
        let (env, admin, _contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(1_000, 50_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(100, 500);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        env.ledger().with_mut(|li| li.timestamp = end);
        let _ = client.claim(&recipient, &stream_id);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.status, StreamStatus::Completed);

        env.ledger().with_mut(|li| li.timestamp = end + 500);
        let result = client.try_claim(&recipient, &stream_id);
        assert!(result.is_err(), "Claim should fail after completion");

        let result2 = client.try_cancel_stream(&sender, &stream_id);
        assert!(result2.is_err(), "Cancel should fail after completion");
    }
}

// ── Overflow: i128 arithmetic stays in bounds ──────────────────

#[test]
fn prop_no_overflow_large_amounts() {
    let mut rng = Rng::new(0xBAD0_0001);
    for _ in 0..10 {
        let (env, admin, _contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(10_000_000, 1_000_000_000_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 100_000);
        let duration = rng.range_u64(1000, 86400 * 365);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        env.ledger().with_mut(|li| li.timestamp = start + duration / 2);
        let claimable = client.get_claimable(&stream_id);
        assert!(claimable >= 0, "Negative claimable: {claimable}");
        assert!(claimable <= total, "Claimable > total: {claimable}");

        if claimable > 0 {
            let claimed = client.claim(&recipient, &stream_id);
            assert!(claimed >= 0, "Negative claimed: {claimed}");
            assert!(claimed <= total, "Claimed > total: {claimed}");
        }
    }
}

#[test]
fn prop_no_overflow_small_duration() {
    let mut rng = Rng::new(0xBAD0_0002);
    for _ in 0..10 {
        let (env, admin, _contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(1, 100_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let end = start + 1;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        env.ledger().with_mut(|li| li.timestamp = end);
        let claimable = client.get_claimable(&stream_id);
        assert!(claimable >= 0, "Negative claimable on unit duration");
        assert!(claimable <= total, "Claimable > total on unit duration");
    }
}

// ── Before start: nothing claimable ────────────────────────────

#[test]
fn prop_nothing_claimable_before_start() {
    let mut rng = Rng::new(0xCAFE_0003);
    for _ in 0..10 {
        let (env, admin, _contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(1_000, 100_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(100, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        env.ledger().with_mut(|li| li.timestamp = start.saturating_sub(1));
        assert_eq!(client.get_claimable(&stream_id), 0, "Should be 0 before start");

        env.ledger().with_mut(|li| li.timestamp = start);
        assert_eq!(client.get_claimable(&stream_id), 0, "Should be 0 at exact start");
    }
}

// ── Randomized operation sequence fuzz ─────────────────────────

#[test]
fn prop_random_operation_sequence() {
    let mut rng = Rng::new(0xFACE_9999);
    for _ in 0..15 {
        let (env, admin, _contract, client) = setup_env();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_admin_client = create_token_contract(&env, &token_admin);
        let tok = token_admin_client.address.clone();
        let total = rng.range_i128(5_000, 200_000);
        token_admin_client.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(200, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = client.create_stream(
            &sender, &recipient, &tok, &total, &start, &end,
        );

        let mut terminated = false;

        for step in 0..5 {
            let t_now = start + rng.range_u64(0, duration);
            env.ledger().with_mut(|li| li.timestamp = t_now);

            let op = rng.range_u64(0, 2);
            if terminated {
                let c = client.try_claim(&recipient, &stream_id);
                assert!(c.is_err(), "Claim in terminal at step {step}");
                break;
            }
            match op {
                0 => { let _ = client.try_claim(&recipient, &stream_id); }
                1 => {
                    let _ = client.try_cancel_stream(&sender, &stream_id);
                    let stream = client.get_stream(&stream_id);
                    terminated = matches!(
                        stream.status,
                        StreamStatus::Cancelled | StreamStatus::Completed,
                    );
                }
                _ => {
                    let claimable = client.get_claimable(&stream_id);
                    assert!(claimable >= 0, "Negative claimable at step {step}");
                    assert!(claimable <= total, "Claimable > total at step {step}");
                }
            }
        }
    }
}
