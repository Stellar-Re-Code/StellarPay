use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::VestingSchedule;

/// Keys used to store data in the contract's ledger storage.
#[contracttype]
pub enum DataKey {
    Admin,
    ScheduleCount,
    Schedule(u32),
    // Keep these discriminants for schedules written before paginated indexes.
    LegacyGrantorSchedules(Address),
    LegacyBeneficiarySchedules(Address),
    GrantorScheduleCount(Address),
    GrantorSchedule(Address, u32),
    BeneficiaryScheduleCount(Address),
    BeneficiarySchedule(Address, u32),
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

// ── Schedule count helpers ───────────────────────────────────────

pub fn get_schedule_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ScheduleCount)
        .unwrap_or(0)
}

pub fn set_schedule_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&DataKey::ScheduleCount, &count);
}

// ── Schedule helpers ─────────────────────────────────────────────

pub fn get_schedule(env: &Env, id: u32) -> Option<VestingSchedule> {
    env.storage().persistent().get(&DataKey::Schedule(id))
}

pub fn set_schedule(env: &Env, id: u32, schedule: &VestingSchedule) {
    env.storage()
        .persistent()
        .set(&DataKey::Schedule(id), schedule);
}

// ── Append-only grantor/beneficiary indexes ───────────────────────

pub fn get_legacy_grantor_schedules(env: &Env, grantor: &Address) -> Vec<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::LegacyGrantorSchedules(grantor.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn get_legacy_beneficiary_schedules(env: &Env, beneficiary: &Address) -> Vec<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::LegacyBeneficiarySchedules(beneficiary.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn get_grantor_schedule_count(env: &Env, grantor: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::GrantorScheduleCount(grantor.clone()))
        .unwrap_or(0)
}

pub fn add_grantor_schedule(env: &Env, grantor: &Address, schedule_id: u32) {
    let index = get_grantor_schedule_count(env, grantor);
    env.storage().persistent().set(
        &DataKey::GrantorSchedule(grantor.clone(), index),
        &schedule_id,
    );
    env.storage().persistent().set(
        &DataKey::GrantorScheduleCount(grantor.clone()),
        &(index + 1),
    );
}

pub fn get_grantor_schedule_at(env: &Env, grantor: &Address, index: u32) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::GrantorSchedule(grantor.clone(), index))
}

pub fn get_beneficiary_schedule_count(env: &Env, beneficiary: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::BeneficiaryScheduleCount(beneficiary.clone()))
        .unwrap_or(0)
}

pub fn add_beneficiary_schedule(env: &Env, beneficiary: &Address, schedule_id: u32) {
    let index = get_beneficiary_schedule_count(env, beneficiary);
    env.storage().persistent().set(
        &DataKey::BeneficiarySchedule(beneficiary.clone(), index),
        &schedule_id,
    );
    env.storage().persistent().set(
        &DataKey::BeneficiaryScheduleCount(beneficiary.clone()),
        &(index + 1),
    );
}

pub fn get_beneficiary_schedule_at(env: &Env, beneficiary: &Address, index: u32) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::BeneficiarySchedule(beneficiary.clone(), index))
}
