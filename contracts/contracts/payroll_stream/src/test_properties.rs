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

/// Mulberry32 — a simple 32-bit PRNG with period 2^32.
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

fn create_token<'a>(
    e: &'a Env,
    admin: &Address,
) -> (Address, token::StellarAssetClient<'a>) {
    let addr = e.register_stellar_asset_contract_v2(admin.clone()).address();
    let client = token::StellarAssetClient::new(e, &addr);
    (addr, client)
}

struct TestEnv {
    env: Env,
    admin: Address,
    sender: Address,
    recipient: Address,
    tok_admin: token::StellarAssetClient<'static>,
    client: PayrollStreamContractClient<'static>,
    tok: Address,
}

fn setup() -> TestEnv {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayrollStreamContract, ());
    let client = PayrollStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (tok, tok_admin) = create_token(&env, &token_admin);
    // SAFETY: Env is leaked in tests; Soroban test harness owns it.
    let tok_admin = unsafe {
        std::mem::transmute::<
            token::StellarAssetClient<'_>,
            token::StellarAssetClient<'static>,
        >(tok_admin)
    };
    let client = unsafe {
        std::mem::transmute::<
            PayrollStreamContractClient<'_>,
            PayrollStreamContractClient<'static>,
        >(client)
    };
    TestEnv { env, admin, sender, recipient, tok_admin, client, tok }
}

fn tok_bal(e: &Env, tok: &Address, addr: &Address) -> i128 {
    token::Client::new(e, tok).balance(addr)
}

fn assert_conservation(total: i128, cb: i128, rb: i128) {
    assert_eq!(cb + rb, total, "Conservation violated: {cb} + {rb} != {total}");
}

fn assert_non_negative(val: i128, label: &str) {
    assert!(val >= 0, "Negative balance: {label}={val}");
}

// ── Conservation: cancel before start ──────────────────────────

#[test]
fn prop_conservation_cancel_before_start() {
    let mut rng = Rng::new(0xDEAD_BEEF);
    for _ in 0..20 {
        let t = setup();
        let total = rng.range_i128(1_000, 500_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(100, 2000);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        t.env.ledger().with_mut(|li| li.timestamp = start.saturating_sub(1));
        let settlement = t.client.cancel_stream(&t.sender, &stream_id);

        let cb = tok_bal(&t.env, &t.tok, &t.env.current_contract_address());
        let rb = tok_bal(&t.env, &t.tok, &t.recipient);
        assert_conservation(total, cb, rb);
        assert_eq!(settlement.recipient_amount + settlement.sender_refund, total);
        assert_non_negative(cb, "contract");
        assert_non_negative(rb, "recipient");
    }
}

// ── Conservation: cancel midway ────────────────────────────────

#[test]
fn prop_conservation_cancel_midway() {
    let mut rng = Rng::new(0xCAFE_BABE);
    for _ in 0..20 {
        let t = setup();
        let total = rng.range_i128(1_000, 500_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(100, 2000);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        let cancel_time = start + duration / 2;
        t.env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let settlement = t.client.cancel_stream(&t.sender, &stream_id);

        let cb = tok_bal(&t.env, &t.tok, &t.env.current_contract_address());
        let rb = tok_bal(&t.env, &t.tok, &t.recipient);
        assert_conservation(total, cb, rb);
        assert_eq!(settlement.recipient_amount + settlement.sender_refund, total);
        assert_non_negative(cb, "contract");
        assert_non_negative(rb, "recipient");
    }
}

// ── Conservation: claim then cancel ────────────────────────────

#[test]
fn prop_conservation_claim_then_cancel() {
    let mut rng = Rng::new(0xFACE_1234);
    for _ in 0..20 {
        let t = setup();
        let total = rng.range_i128(1_000, 500_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(200, 2000);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        // Claim midway
        let claim_time = start + duration / 2;
        t.env.ledger().with_mut(|li| li.timestamp = claim_time);
        let _ = t.client.claim(&t.recipient, &stream_id);

        // Cancel at 75%
        let cancel_time = start + (duration * 3) / 4;
        t.env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let settlement = t.client.cancel_stream(&t.sender, &stream_id);

        let cb = tok_bal(&t.env, &t.tok, &t.env.current_contract_address());
        let rb = tok_bal(&t.env, &t.tok, &t.recipient);
        assert_conservation(total, cb, rb);
        assert_eq!(
            settlement.recipient_amount + settlement.sender_refund,
            total - (total * (duration as i128 / 2) / duration as i128),
        );
        assert_non_negative(cb, "contract");
        assert_non_negative(rb, "recipient");
    }
}

// ── Conservation: multiple claims then cancel ──────────────────

#[test]
fn prop_conservation_multi_claim_then_cancel() {
    let mut rng = Rng::new(0x1234_5678);
    for _ in 0..20 {
        let t = setup();
        let total = rng.range_i128(2_000, 500_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(400, 2000);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        let t1 = start + duration / 4;
        t.env.ledger().with_mut(|li| li.timestamp = t1);
        let c1 = t.client.claim(&t.recipient, &stream_id);

        let t2 = start + duration / 2;
        t.env.ledger().with_mut(|li| li.timestamp = t2);
        let c2 = t.client.claim(&t.recipient, &stream_id);

        let t3 = start + (duration * 3) / 4;
        t.env.ledger().with_mut(|li| li.timestamp = t3);
        let c3 = t.client.claim(&t.recipient, &stream_id);

        let total_claimed = c1 + c2 + c3;

        let cancel_time = t3 + 1;
        t.env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let settlement = t.client.cancel_stream(&t.sender, &stream_id);

        let cb = tok_bal(&t.env, &t.tok, &t.env.current_contract_address());
        let rb = tok_bal(&t.env, &t.tok, &t.recipient);
        assert_conservation(total, cb, rb);
        assert_eq!(
            settlement.recipient_amount + settlement.sender_refund,
            total - total_claimed,
        );
        assert_non_negative(cb, "contract");
        assert_non_negative(rb, "recipient");
    }
}

// ── Monotonicity: claimable is non-decreasing in time ──────────

#[test]
fn prop_monotonic_claimable() {
    let mut rng = Rng::new(0xBEEF_4321);
    for _ in 0..20 {
        let t = setup();
        let total = rng.range_i128(1_000, 500_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(200, 2000);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        let mut prev_claimable = 0i128;
        for i in 1..=10 {
            let t_now = start + (duration * i) / 10;
            t.env.ledger().with_mut(|li| li.timestamp = t_now);
            let claimable = t.client.get_claimable(&stream_id);
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
        let t = setup();
        let total = rng.range_i128(1_000, 500_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(100, 1000);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        t.env.ledger().with_mut(|li| li.timestamp = end);
        let claimable_at_end = t.client.get_claimable(&stream_id);
        assert!(claimable_at_end > 0, "Nothing claimable at end");
        let _ = t.client.claim(&t.recipient, &stream_id);

        t.env.ledger().with_mut(|li| li.timestamp = end + 1000);
        let claimable_after = t.client.get_claimable(&stream_id);
        assert_eq!(claimable_after, 0);
    }
}

// ── Terminal states: no payout after cancellation ──────────────

#[test]
fn prop_terminal_no_claim_after_cancel() {
    let mut rng = Rng::new(0xABCD_9999);
    for _ in 0..10 {
        let t = setup();
        let total = rng.range_i128(5_000, 100_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(200, 1000);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        let cancel_time = start + duration / 2;
        t.env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let _ = t.client.cancel_stream(&t.sender, &stream_id);

        let stream = t.client.get_stream(&stream_id);
        assert_eq!(stream.status, StreamStatus::Cancelled);

        // Claiming on a cancelled stream should fail
        t.env.ledger().with_mut(|li| li.timestamp = cancel_time + 100);
        let result = t.client.try_claim(&t.recipient, &stream_id);
        assert!(result.is_err(), "Claim should fail on cancelled stream");

        // Cancelling again should also fail
        let result2 = t.client.try_cancel_stream(&t.sender, &stream_id);
        assert!(result2.is_err(), "Double cancel should fail");
    }
}

// ── Terminal states: no payout after completion ────────────────

#[test]
fn prop_terminal_no_claim_after_complete() {
    let mut rng = Rng::new(0xDADD_7777);
    for _ in 0..10 {
        let t = setup();
        let total = rng.range_i128(1_000, 50_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(100, 500);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        // Claim at end to fully complete
        t.env.ledger().with_mut(|li| li.timestamp = end);
        let _ = t.client.claim(&t.recipient, &stream_id);

        let stream = t.client.get_stream(&stream_id);
        assert_eq!(stream.status, StreamStatus::Completed);

        // Further claims should fail
        t.env.ledger().with_mut(|li| li.timestamp = end + 500);
        let result = t.client.try_claim(&t.recipient, &stream_id);
        assert!(result.is_err(), "Claim should fail after completion");

        // Cancellation should also fail
        let result2 = t.client.try_cancel_stream(&t.sender, &stream_id);
        assert!(result2.is_err(), "Cancel should fail after completion");
    }
}

// ── Overflow: i128 arithmetic stays in bounds ──────────────────

#[test]
fn prop_no_overflow_large_amounts() {
    let mut rng = Rng::new(0xBAD0_0001);
    for _ in 0..10 {
        let t = setup();
        let total = rng.range_i128(10_000_000, 1_000_000_000_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 100_000);
        let duration = rng.range_u64(1000, 86400 * 365);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        t.env.ledger().with_mut(|li| li.timestamp = start + duration / 2);
        let claimable = t.client.get_claimable(&stream_id);
        assert!(claimable >= 0, "Negative claimable: {claimable}");
        assert!(claimable <= total, "Claimable > total: {claimable}");

        if claimable > 0 {
            let claimed = t.client.claim(&t.recipient, &stream_id);
            assert!(claimed >= 0, "Negative claimed: {claimed}");
            assert!(claimed <= total, "Claimed > total: {claimed}");
        }
    }
}

#[test]
fn prop_no_overflow_small_duration() {
    let mut rng = Rng::new(0xBAD0_0002);
    for _ in 0..10 {
        let t = setup();
        let total = rng.range_i128(1, 100_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 5000);
        let end = start + 1;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        t.env.ledger().with_mut(|li| li.timestamp = end);
        let claimable = t.client.get_claimable(&stream_id);
        assert!(claimable >= 0, "Negative claimable on unit duration");
        assert!(claimable <= total, "Claimable > total on unit duration");
    }
}

// ── Before start: nothing claimable ────────────────────────────

#[test]
fn prop_nothing_claimable_before_start() {
    let mut rng = Rng::new(0xCAFE_0003);
    for _ in 0..10 {
        let t = setup();
        let total = rng.range_i128(1_000, 100_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(100, 2000);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        t.env.ledger().with_mut(|li| li.timestamp = start.saturating_sub(1));
        assert_eq!(t.client.get_claimable(&stream_id), 0, "Should be 0 before start");

        t.env.ledger().with_mut(|li| li.timestamp = start);
        assert_eq!(t.client.get_claimable(&stream_id), 0, "Should be 0 at exact start");
    }
}

// ── Randomized operation sequence fuzz ─────────────────────────

#[test]
fn prop_random_operation_sequence() {
    let mut rng = Rng::new(0xFACE_9999);
    for _ in 0..15 {
        let t = setup();
        let total = rng.range_i128(5_000, 200_000);
        t.tok_admin.mint(&t.sender, &total);
        t.client.initialize(&t.admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(200, 2000);
        let end = start + duration;

        t.env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id = t.client.create_stream(
            &t.sender, &t.recipient, &t.tok, &total, &start, &end,
        );

        let mut terminated = false;

        for step in 0..5 {
            let t_now = start + rng.range_u64(0, duration);
            t.env.ledger().with_mut(|li| li.timestamp = t_now);

            let op = rng.range_u64(0, 2);
            if terminated {
                let c = t.client.try_claim(&t.recipient, &stream_id);
                assert!(c.is_err(), "Claim in terminal at step {step}");
                break;
            }
            match op {
                0 => { let _ = t.client.try_claim(&t.recipient, &stream_id); }
                1 => {
                    let _ = t.client.try_cancel_stream(&t.sender, &stream_id);
                    let stream = t.client.get_stream(&stream_id);
                    terminated = matches!(
                        stream.status,
                        StreamStatus::Cancelled | StreamStatus::Completed,
                    );
                }
                _ => {
                    let claimable = t.client.get_claimable(&stream_id);
                    assert!(claimable >= 0, "Negative claimable at step {step}");
                    assert!(claimable <= total, "Claimable > total at step {step}");
                }
            }
        }

        let cb = tok_bal(&t.env, &t.tok, &t.env.current_contract_address());
        let rb = tok_bal(&t.env, &t.tok, &t.recipient);
        assert_conservation(total, cb, rb);
        assert_non_negative(cb, "contract");
        assert_non_negative(rb, "recipient");
    }
}
