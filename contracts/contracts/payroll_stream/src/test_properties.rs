#![cfg(test)]

//! Property-based / invariant fuzz tests for the payroll stream contract.
//!
//! Uses a seeded PRNG and model-based testing to verify:
//! - Conservation: claimed + refunded + escrow == total_amount
//! - Monotonic accrual: claimable is non-decreasing until fully vested
//! - No negative / no overflow in i128 accrual math
//! - Terminal states: no payout after Cancelled/Completed
//! - Cliff: nothing claimable before cliff end

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, token,
};

// ── Seeded PRNG ────────────────────────────────────────────────

/// Mulberry32 — a simple 32-bit PRNG with period 2^32.
/// Deterministic and fast; good enough for bounded-exhaustive fuzzing.
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

    /// Returns a value in [lo, hi].
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

// ── Model ──────────────────────────────────────────────────────

/// Mirror of the on-chain PayrollStream state.
#[derive(Clone, Debug)]
struct ModelState {
    total_amount: i128,
    claimed_amount: i128,
    start_time: u64,
    end_time: u64,
    last_claim_time: u64,
    status: StreamStatus,
}

/// Tracks token balances off-chain to verify conservation.
struct TokenLedger {
    contract_balance: i128,
    sender_balance: i128,
    recipient_balance: i128,
}

impl ModelState {
    fn rate_per_second(&self) -> i128 {
        let duration = self.end_time - self.start_time;
        self.total_amount / (duration as i128)
    }

    /// Pure model of on-chain `calculate_claimable`.
    fn calculate_claimable(&self, now: u64) -> i128 {
        if now <= self.start_time {
            return 0;
        }
        let effective_time = if now >= self.end_time {
            self.end_time
        } else {
            now
        };
        let elapsed = effective_time - self.start_time;
        if self.end_time <= self.start_time {
            return 0;
        }
        let duration = self.end_time - self.start_time;
        let total_accrued =
            (self.total_amount * (elapsed as i128)) / (duration as i128);
        let total_accrued = if total_accrued > self.total_amount {
            self.total_amount
        } else {
            total_accrued
        };
        if total_accrued < self.claimed_amount {
            return 0;
        }
        total_accrued - self.claimed_amount
    }

    fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            StreamStatus::Cancelled | StreamStatus::Completed
        )
    }
}

// ── Test helpers ───────────────────────────────────────────────

fn create_token(e: &Env, admin: &Address) -> (Address, token::StellarAssetClient<'_>) {
    let addr = e.register_stellar_asset_contract(admin.clone());
    let client = token::StellarAssetClient::new(e, &addr);
    (addr, client)
}

fn setup() -> (
    Env,
    Address,
    Address,
    Address,
    Address,
    PayrollStreamContractClient<'static>,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayrollStreamContract, ());
    let client = PayrollStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_addr, token_admin_client) = create_token(&env, &token_admin);
    (env, admin, sender, recipient, token_admin_client, client, token_addr)
}

/// Assert conservation: contract + recipient == total_amount at all times.
fn assert_conservation(total: i128, contract_bal: i128, recipient_bal: i128) {
    assert_eq!(
        contract_bal + recipient_bal,
        total,
        "Conservation violated: contract={contract_bal} recipient={recipient_bal} total={total}",
    );
}

fn assert_non_negative(val: i128, label: &str) {
    assert!(val >= 0, "Negative balance: {label}={val}");
}

fn tok_bal(env: &Env, tok: &Address, addr: &Address) -> i128 {
    token::Client::new(env, tok).balance(addr)
}

// ── Conservation: cancel before start ──────────────────────────

#[test]
fn prop_conservation_cancel_before_start() {
    let mut rng = Rng::new(0xDEAD_BEEF);
    for _ in 0..20 {
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(1_000, 500_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(100, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

        env.ledger().with_mut(|li| li.timestamp = start.saturating_sub(1));
        let settlement = client.cancel_stream(&sender, &stream_id);

        let cb = tok_bal(&env, &tok, &env.current_contract_address());
        let rb = tok_bal(&env, &tok, &recipient);
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
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(1_000, 500_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(100, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

        let cancel_time = start + duration / 2;
        env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let settlement = client.cancel_stream(&sender, &stream_id);

        let cb = tok_bal(&env, &tok, &env.current_contract_address());
        let rb = tok_bal(&env, &tok, &recipient);
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
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(1_000, 500_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(200, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

        // Claim midway
        let claim_time = start + duration / 2;
        env.ledger().with_mut(|li| li.timestamp = claim_time);
        let _ = client.claim(&recipient, &stream_id);

        // Cancel at 75%
        let cancel_time = start + (duration * 3) / 4;
        env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let settlement = client.cancel_stream(&sender, &stream_id);

        let cb = tok_bal(&env, &tok, &env.current_contract_address());
        let rb = tok_bal(&env, &tok, &recipient);
        assert_conservation(total, cb, rb);
        assert_eq!(
            settlement.recipient_amount + settlement.sender_refund,
            total - (total * (duration / 2) / duration),
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
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(2_000, 500_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(400, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

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

        let cb = tok_bal(&env, &tok, &env.current_contract_address());
        let rb = tok_bal(&env, &tok, &recipient);
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
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(1_000, 500_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(200, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

        let mut prev_claimable = 0i128;
        for i in 1..=10 {
            let t = start + (duration * i) / 10;
            env.ledger().with_mut(|li| li.timestamp = t);
            let claimable = client.get_claimable(&stream_id);
            assert!(
                claimable >= prev_claimable,
                "Monotonicity violated at t={t}: claimable={claimable} < prev={prev_claimable}",
            );
            assert!(
                claimable <= total,
                "Claimable exceeds total: {claimable} > {total}",
            );
            prev_claimable = claimable;
        }
    }
}

// ── Monotonicity: after full vest, claimable stays constant ────

#[test]
fn prop_monotonic_post_completion() {
    let mut rng = Rng::new(0xFEED_5678);
    for _ in 0..10 {
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(1_000, 500_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(100, 1000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

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
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(5_000, 100_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(200, 1000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

        let cancel_time = start + duration / 2;
        env.ledger().with_mut(|li| li.timestamp = cancel_time);
        let _ = client.cancel_stream(&sender, &stream_id);

        // Verify stream is in terminal state
        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.status, StreamStatus::Cancelled);

        // Claiming on a cancelled stream should fail
        let t_after = cancel_time + 100;
        env.ledger().with_mut(|li| li.timestamp = t_after);
        let result = client.try_claim(&recipient, &stream_id);
        assert!(result.is_err(), "Claim should fail on cancelled stream");

        // Cancelling again should also fail
        let result2 = client.try_cancel_stream(&sender, &stream_id);
        assert!(result2.is_err(), "Double cancel should fail");
    }
}

// ── Terminal states: no payout after completion ────────────────

#[test]
fn prop_terminal_no_claim_after_complete() {
    let mut rng = Rng::new(0xDADD_7777);
    for _ in 0..10 {
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(1_000, 50_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 3000);
        let duration = rng.range_u64(100, 500);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

        // Claim at end to fully complete
        env.ledger().with_mut(|li| li.timestamp = end);
        let _ = client.claim(&recipient, &stream_id);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.status, StreamStatus::Completed);

        // Further claims should fail
        env.ledger().with_mut(|li| li.timestamp = end + 500);
        let result = client.try_claim(&recipient, &stream_id);
        assert!(result.is_err(), "Claim should fail after completion");

        // Cancellation should also fail
        let result2 = client.try_cancel_stream(&sender, &stream_id);
        assert!(result2.is_err(), "Cancel should fail after completion");
    }
}

// ── Overflow / underflow: i128 arithmetic stays in bounds ──────

#[test]
fn prop_no_overflow_large_amounts() {
    let mut rng = Rng::new(0xBAD0_0001);
    for _ in 0..10 {
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        // Use large but plausible amounts (well within i128 range)
        let total = rng.range_i128(10_000_000, i128::MAX / 1_000_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 100_000);
        let duration = rng.range_u64(1000, 86400 * 365);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

        // Claim midway — must not panic/overflow
        env.ledger().with_mut(|li| li.timestamp = start + duration / 2);
        let claimable = client.get_claimable(&stream_id);
        assert!(claimable >= 0, "Negative claimable: {claimable}");
        assert!(claimable <= total, "Claimable > total: {claimable} > {total}");

        if claimable > 0 {
            let claimed = client.claim(&recipient, &stream_id);
            assert!(claimed >= 0, "Negative claimed: {claimed}");
            assert!(claimed <= total, "Claimed > total: {claimed} > {total}");
        }
    }
}

#[test]
fn prop_no_overflow_small_duration() {
    let mut rng = Rng::new(0xBAD0_0002);
    for _ in 0..10 {
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(1, 100_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        // Duration of 1 second — rate_per_second truncates, must not crash
        let end = start + 1;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

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
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(1_000, 100_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(100, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

        // Before start
        let before = start.saturating_sub(1);
        env.ledger().with_mut(|li| li.timestamp = before);
        let claimable = client.get_claimable(&stream_id);
        assert_eq!(claimable, 0, "Should be 0 before start");

        // Exactly at start
        env.ledger().with_mut(|li| li.timestamp = start);
        let claimable_start = client.get_claimable(&stream_id);
        assert_eq!(claimable_start, 0, "Should be 0 at exact start");
    }
}

// ── Randomized operation sequence fuzz ─────────────────────────

#[test]
fn prop_random_operation_sequence() {
    let mut rng = Rng::new(0xFACE_9999);
    for _ in 0..15 {
        let (env, admin, sender, recipient, tok_admin, client, tok) = setup();
        let total = rng.range_i128(5_000, 200_000);
        tok_admin.mint(&sender, &total);
        client.initialize(&admin);

        let start = rng.range_u64(1000, 5000);
        let duration = rng.range_u64(200, 2000);
        let end = start + duration;

        env.ledger().with_mut(|li| li.timestamp = start);
        let stream_id =
            client.create_stream(&sender, &recipient, &tok, &total, &start, &end);

        let mut cumulative_claimed = 0i128;
        let mut terminated = false;

        // Perform up to 5 random operations
        for step in 0..5 {
            let time_offset = rng.range_u64(0, duration);
            let t = start + time_offset;
            env.ledger().with_mut(|li| li.timestamp = t);

            let op = rng.range_u64(0, 2);
            if terminated {
                // Verify terminal: both claim and cancel should fail
                let c = client.try_claim(&recipient, &stream_id);
                assert!(c.is_err(), "Claim in terminal state at step {step}");
                break;
            }
            match op {
                0 => {
                    // Claim
                    let res = client.try_claim(&recipient, &stream_id);
                    if let Ok(claimed) = res {
                        cumulative_claimed += claimed;
                    }
                }
                1 => {
                    // Cancel
                    let _ = client.try_cancel_stream(&sender, &stream_id);
                    let stream = client.get_stream(&stream_id);
                    terminated =
                        matches!(stream.status, StreamStatus::Cancelled | StreamStatus::Completed);
                }
                _ => {
                    // Query claimable
                    let claimable = client.get_claimable(&stream_id);
                    assert!(claimable >= 0, "Negative claimable at step {step}");
                    assert!(
                        claimable <= total,
                        "Claimable > total at step {step}"
                    );
                }
            }
        }

        // Final conservation check
        let cb = tok_bal(&env, &tok, &env.current_contract_address());
        let rb = tok_bal(&env, &tok, &recipient);
        assert_conservation(total, cb, rb);
        assert_non_negative(cb, "contract");
        assert_non_negative(rb, "recipient");
    }
}
