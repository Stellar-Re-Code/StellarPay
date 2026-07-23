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
