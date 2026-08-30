#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, Vec};

mod errors;
mod storage;
mod types;

use errors::StreamError;
use storage::{
    add_recipient_stream, add_sender_stream, extend_stream_ttl, get_admin, get_recipient_stream_at,
    get_recipient_stream_count, get_legacy_recipient_streams, get_legacy_sender_streams,
    get_sender_stream_at, get_sender_stream_count, get_stream, get_stream_count, has_admin,
    set_admin, set_stream, set_stream_count,
};
use types::{CancelSettlement, CreateStreamParams, PayrollStream, StreamPage, StreamStatus};

const MAX_PAGE_SIZE: u32 = 50;

#[contract]
pub struct PayrollStreamContract;

#[contractimpl]
impl PayrollStreamContract {
    /// Initialize the payroll stream contract with an organization admin.
    pub fn initialize(env: Env, admin: Address) -> Result<(), StreamError> {
        if has_admin(&env) {
            return Err(StreamError::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_stream_count(&env, 0);

        env.events()
            .publish((symbol_short!("init"), 1u32), admin.clone());

        Ok(())
    }

    /// Create a new payment stream to an employee/recipient.
    /// Tokens are linearly streamed from `start_time` to `end_time`.
    pub fn create_stream(
        env: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
    ) -> Result<u32, StreamError> {
        if !has_admin(&env) {
            return Err(StreamError::NotInitialized);
        }
        sender.require_auth();

        if sender == recipient {
            return Err(StreamError::InvalidRecipient);
        }
        if total_amount <= 0 {
            return Err(StreamError::InvalidAmount);
        }
        if end_time <= start_time {
            return Err(StreamError::InvalidDuration);
        }

        let duration = end_time - start_time;
        let rate_per_second = total_amount / (duration as i128);

        let stream_id = get_stream_count(&env);
        let stream = PayrollStream {
            id: stream_id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            total_amount,
            claimed_amount: 0,
            start_time,
            end_time,
            last_claim_time: start_time,
            status: StreamStatus::Active,
            rate_per_second,
        };

        // Transfer total_amount from sender to contract (contributor task SC-10)
        token::Client::new(&env, &token).transfer(
            &sender,
            &env.current_contract_address(),
            &total_amount,
        );

        set_stream(&env, stream_id, &stream);
        set_stream_count(&env, stream_id + 1);
        add_sender_stream(&env, &sender, stream_id);
        add_recipient_stream(&env, &recipient, stream_id);

        env.events()
            .publish((symbol_short!("s_create"), 1u32, sender.clone()), stream_id);

        Ok(stream_id)
    }

    /// Create multiple payment streams in a single transaction.
    /// Emits a single batch event with all created stream IDs.
    pub fn create_batch_streams(
        env: Env,
        sender: Address,
        streams: Vec<CreateStreamParams>,
    ) -> Result<Vec<u32>, StreamError> {
        if !has_admin(&env) {
            return Err(StreamError::NotInitialized);
        }
        sender.require_auth();

        let batch_size = streams.len();
        if batch_size > 50 {
            return Err(StreamError::BatchTooLarge);
        }

        let mut token_totals: soroban_sdk::Map<Address, i128> = soroban_sdk::Map::new(&env);
        let mut seen_recipients = Vec::new(&env);

        // First pass: validation and escrow calculation
        for stream_params in streams.iter() {
            let recipient = stream_params.recipient;
            let token = stream_params.token;
            let total_amount = stream_params.total_amount;
            let start_time = stream_params.start_time;
            let end_time = stream_params.end_time;

            if sender == recipient {
                return Err(StreamError::InvalidRecipient);
            }
            if seen_recipients.contains(recipient.clone()) {
                return Err(StreamError::DuplicateRecipient);
            }
            seen_recipients.push_back(recipient.clone());

            if total_amount <= 0 {
                return Err(StreamError::InvalidAmount);
            }
            if end_time <= start_time {
                return Err(StreamError::InvalidDuration);
            }

            let current_total = token_totals.get(token.clone()).unwrap_or(0);
            let new_total = current_total
                .checked_add(total_amount)
                .ok_or(StreamError::ArithmeticOverflow)?;
            token_totals.set(token.clone(), new_total);
        }

        // Fund all tokens atomically
        let contract_addr = env.current_contract_address();
        for (token, amount) in token_totals.iter() {
            token::Client::new(&env, &token).transfer(&sender, &contract_addr, &amount);
        }

        let mut stream_ids: Vec<u32> = Vec::new(&env);
        let mut count = get_stream_count(&env);

        // Second pass: persistence and event emission
        for stream_params in streams.iter() {
            let recipient = stream_params.recipient;
            let token = stream_params.token;
            let total_amount = stream_params.total_amount;
            let start_time = stream_params.start_time;
            let end_time = stream_params.end_time;

            let duration = end_time - start_time;
            let rate_per_second = total_amount / (duration as i128);

            let stream_id = count;
            let stream = PayrollStream {
                id: stream_id,
                sender: sender.clone(),
                recipient: recipient.clone(),
                token: token.clone(),
                total_amount,
                claimed_amount: 0,
                start_time,
                end_time,
                last_claim_time: start_time,
                status: StreamStatus::Active,
                rate_per_second,
            };

            set_stream(&env, stream_id, &stream);
            add_sender_stream(&env, &sender, stream_id);
            add_recipient_stream(&env, &recipient, stream_id);

            env.events()
                .publish((symbol_short!("s_create"), 1u32, sender.clone()), stream_id);

            stream_ids.push_back(stream_id);
            count += 1;
        }

        set_stream_count(&env, count);

        env.events().publish(
            (symbol_short!("b_create"), 1u32, sender.clone()),
            stream_ids.clone(),
        );

        Ok(stream_ids)
    }

    /// Claim accrued tokens from an active stream.
    /// The recipient can claim at any point — they receive tokens proportional to elapsed time.
    pub fn claim(env: Env, recipient: Address, stream_id: u32) -> Result<i128, StreamError> {
        if !has_admin(&env) {
            return Err(StreamError::NotInitialized);
        }
        recipient.require_auth();

        let mut stream = get_stream(&env, stream_id).ok_or(StreamError::StreamNotFound)?;

        if stream.recipient != recipient {
            return Err(StreamError::Unauthorized);
        }
        if stream.status == StreamStatus::Cancelled {
            return Err(StreamError::StreamAlreadyCancelled);
        }
        if stream.status == StreamStatus::Completed {
            return Err(StreamError::StreamCompleted);
        }

        let claimable = Self::calculate_claimable(&env, &stream);
        if claimable <= 0 {
            return Err(StreamError::NothingToClaim);
        }

        stream.claimed_amount += claimable;
        let now = env.ledger().timestamp();
        stream.last_claim_time = now;

        // Check if stream is fully claimed
        if stream.claimed_amount >= stream.total_amount {
            stream.status = StreamStatus::Completed;
        }

        // Transfer claimable tokens to recipient (contributor task SC-11)
        token::Client::new(&env, &stream.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &claimable,
        );

        set_stream(&env, stream_id, &stream);

        env.events()
            .publish((symbol_short!("claim"), 1u32, recipient.clone()), claimable);

        Ok(claimable)
    }

    /// Cancel a stream. Only the sender (organization) can cancel.
    /// Unclaimed tokens are returned to the sender. Already-claimed tokens stay with recipient.
    pub fn cancel_stream(
        env: Env,
        sender: Address,
        stream_id: u32,
    ) -> Result<CancelSettlement, StreamError> {
        if !has_admin(&env) {
            return Err(StreamError::NotInitialized);
        }
        sender.require_auth();

        let mut stream = get_stream(&env, stream_id).ok_or(StreamError::StreamNotFound)?;

        if stream.sender != sender {
            return Err(StreamError::Unauthorized);
        }
        if stream.status == StreamStatus::Cancelled {
            return Err(StreamError::StreamAlreadyCancelled);
        }
        if stream.status == StreamStatus::Completed {
            return Err(StreamError::StreamCompleted);
        }

        // Calculate what recipient is owed up to now
        let claimable = Self::calculate_claimable(&env, &stream);
        let refund = stream.total_amount - stream.claimed_amount - claimable;

        // Set claimed/settled accounting
        stream.claimed_amount += claimable;
        stream.last_claim_time = env.ledger().timestamp();
        stream.status = StreamStatus::Cancelled;

        let contract_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &stream.token);

        if claimable > 0 {
            token_client.transfer(&contract_addr, &stream.recipient, &claimable);
        }
        if refund > 0 {
            token_client.transfer(&contract_addr, &sender, &refund);
        }

        set_stream(&env, stream_id, &stream);

        // Extend TTL (approximately 30 days of ledgers: 17280 * 30)
        extend_stream_ttl(&env, stream_id, 17280 * 30, 17280 * 30);

        let settlement = CancelSettlement {
            stream_id,
            recipient: stream.recipient.clone(),
            sender: sender.clone(),
            recipient_amount: claimable,
            sender_refund: refund,
        };

        // Emit versioned cancellation settlement event (version 1)
        env.events().publish(
            (symbol_short!("cancel"), 1u32, sender.clone()),
            settlement.clone(),
        );

        Ok(settlement)
    }

    // ── Internal Helpers ─────────────────────────────────────────

    /// Calculate the amount of tokens claimable by the recipient at the current time.
    fn calculate_claimable(env: &Env, stream: &PayrollStream) -> i128 {
        let now = env.ledger().timestamp();

        if now <= stream.start_time {
            return 0;
        }

        let effective_time = if now >= stream.end_time {
            stream.end_time
        } else {
            now
        };

        let elapsed = effective_time - stream.start_time;
        // Check if stream is completed to avoid division by zero (though duration checked at creation)
        if stream.end_time <= stream.start_time {
            return 0;
        }

        // Recalculate based on total amount and duration to minimize rounding errors
        // Instead of using stored rate_per_second which might have rounding loss
        let duration = stream.end_time - stream.start_time;
        let total_accrued = (stream.total_amount * (elapsed as i128)) / (duration as i128);

        // Clamp to total_amount
        let total_accrued = if total_accrued > stream.total_amount {
            stream.total_amount
        } else {
            total_accrued
        };

        // Ensure we don't return negative claimable if something is wrong with state
        if total_accrued < stream.claimed_amount {
            return 0;
        }

        total_accrued - stream.claimed_amount
    }

    // ── Query Functions ──────────────────────────────────────────

    /// Get a specific stream by ID.
    pub fn get_stream(env: Env, stream_id: u32) -> Result<PayrollStream, StreamError> {
        get_stream(&env, stream_id).ok_or(StreamError::StreamNotFound)
    }

    /// Get the claimable balance for a stream at the current time.
    pub fn get_claimable(env: Env, stream_id: u32) -> Result<i128, StreamError> {
        let stream = get_stream(&env, stream_id).ok_or(StreamError::StreamNotFound)?;
        Ok(Self::calculate_claimable(&env, &stream))
    }

    /// Get the total number of streams created.
    pub fn get_stream_count(env: Env) -> u32 {
        get_stream_count(&env)
    }

    /// List sender stream IDs in creation order. Cursor zero starts the index;
    /// a zero next cursor means the final page.
    pub fn get_streams_by_sender_page(
        env: Env,
        sender: Address,
        cursor: u32,
        limit: u32,
    ) -> Result<StreamPage, StreamError> {
        let legacy = get_legacy_sender_streams(&env, &sender);
        let legacy_count = legacy.len();
        Self::stream_page(
            &env,
            cursor,
            limit,
            legacy_count + get_sender_stream_count(&env, &sender),
            |index| {
                if index < legacy_count {
                    legacy.get(index)
                } else {
                    get_sender_stream_at(&env, &sender, index - legacy_count)
                }
            },
        )
    }

    /// List recipient stream IDs in creation order. Cursor zero starts the
    /// index; a zero next cursor means the final page.
    pub fn get_streams_by_recipient_page(
        env: Env,
        recipient: Address,
        cursor: u32,
        limit: u32,
    ) -> Result<StreamPage, StreamError> {
        let legacy = get_legacy_recipient_streams(&env, &recipient);
        let legacy_count = legacy.len();
        Self::stream_page(
            &env,
            cursor,
            limit,
            legacy_count + get_recipient_stream_count(&env, &recipient),
            |index| {
                if index < legacy_count {
                    legacy.get(index)
                } else {
                    get_recipient_stream_at(&env, &recipient, index - legacy_count)
                }
            },
        )
    }

    /// Get the admin address.
    pub fn get_admin(env: Env) -> Result<Address, StreamError> {
        if !has_admin(&env) {
            return Err(StreamError::NotInitialized);
        }
        Ok(get_admin(&env))
    }

    /// Upgrade the contract WASM. Restricted to admin.
    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: soroban_sdk::BytesN<32>,
    ) -> Result<(), StreamError> {
        let stored_admin = get_admin(&env);
        if admin != stored_admin {
            return Err(StreamError::Unauthorized);
        }
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    fn stream_page<F>(
        env: &Env,
        cursor: u32,
        limit: u32,
        count: u32,
        get_at: F,
    ) -> Result<StreamPage, StreamError>
    where
        F: Fn(u32) -> Option<u32>,
    {
        if limit == 0 {
            return Err(StreamError::InvalidPageSize);
        }
        if cursor > count {
            return Err(StreamError::InvalidCursor);
        }

        let end = core::cmp::min(
            cursor.saturating_add(core::cmp::min(limit, MAX_PAGE_SIZE)),
            count,
        );
        let mut stream_ids = Vec::new(env);
        let mut index = cursor;
        while index < end {
            stream_ids.push_back(get_at(index).ok_or(StreamError::InvalidCursor)?);
            index += 1;
        }
        Ok(StreamPage {
            stream_ids,
            next_cursor: if end == count { 0 } else { end },
        })
    }
}

mod test;
mod test_properties;
mod test_sentinel_auth;
