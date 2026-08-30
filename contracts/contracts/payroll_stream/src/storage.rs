use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::PayrollStream;

/// Keys used to store data in the contract's ledger storage.
#[contracttype]
pub enum DataKey {
    /// The admin/organization address — stored in Instance storage.
    Admin,
    /// Running count of streams created — stored in Instance storage.
    StreamCount,
    /// A specific stream by ID — stored in Persistent storage.
    Stream(u32),
    // Preserve deployed key names for records created before paginated indexes.
    SenderStreams(Address),
    RecipientStreams(Address),
    SenderStreamCount(Address),
    SenderStream(Address, u32),
    RecipientStreamCount(Address),
    RecipientStream(Address, u32),
}

// ── Admin helpers ────────────────────────────────────────────────

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ── Stream count helpers ─────────────────────────────────────────

pub fn get_stream_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::StreamCount)
        .unwrap_or(0)
}

pub fn set_stream_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::StreamCount, &count);
}

// ── Stream helpers ───────────────────────────────────────────────

pub fn get_stream(env: &Env, id: u32) -> Option<PayrollStream> {
    env.storage().persistent().get(&DataKey::Stream(id))
}

pub fn set_stream(env: &Env, id: u32, stream: &PayrollStream) {
    env.storage().persistent().set(&DataKey::Stream(id), stream);
}

pub fn extend_stream_ttl(env: &Env, id: u32, threshold: u32, extend_to: u32) {
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Stream(id), threshold, extend_to);
}

// ── Append-only sender/recipient indexes ─────────────────────────

pub fn get_legacy_sender_streams(env: &Env, sender: &Address) -> Vec<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::SenderStreams(sender.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn get_legacy_recipient_streams(env: &Env, recipient: &Address) -> Vec<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::RecipientStreams(recipient.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn get_sender_stream_count(env: &Env, sender: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::SenderStreamCount(sender.clone()))
        .unwrap_or(0)
}

pub fn add_sender_stream(env: &Env, sender: &Address, stream_id: u32) {
    let index = get_sender_stream_count(env, sender);
    env.storage()
        .persistent()
        .set(&DataKey::SenderStream(sender.clone(), index), &stream_id);
    env.storage()
        .persistent()
        .set(&DataKey::SenderStreamCount(sender.clone()), &(index + 1));
}

pub fn get_sender_stream_at(env: &Env, sender: &Address, index: u32) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::SenderStream(sender.clone(), index))
}

pub fn get_recipient_stream_count(env: &Env, recipient: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::RecipientStreamCount(recipient.clone()))
        .unwrap_or(0)
}

pub fn add_recipient_stream(env: &Env, recipient: &Address, stream_id: u32) {
    let index = get_recipient_stream_count(env, recipient);
    env.storage().persistent().set(
        &DataKey::RecipientStream(recipient.clone(), index),
        &stream_id,
    );
    env.storage().persistent().set(
        &DataKey::RecipientStreamCount(recipient.clone()),
        &(index + 1),
    );
}

pub fn get_recipient_stream_at(env: &Env, recipient: &Address, index: u32) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::RecipientStream(recipient.clone(), index))
}
