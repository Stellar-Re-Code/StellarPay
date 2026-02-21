#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, Vec};
use types::StreamStatus;

fn setup_env() -> (Env, Address, PayrollStreamContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayrollStreamContract, ());
    let client = PayrollStreamContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (_env, admin, client) = setup_env();
    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_stream_count(), 0);
}

#[test]
#[should_panic]
fn test_double_initialize() {
    let (_env, admin, client) = setup_env();
    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
fn test_create_stream() {
    let (env, admin, client) = setup_env();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token,
        &10000_i128,
        &1000_u64,
        &2000_u64,
    );

    assert_eq!(stream_id, 0);
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.total_amount, 10000);
    assert_eq!(stream.status, StreamStatus::Active);
    assert_eq!(stream.rate_per_second, 10); // 10000 / 1000 seconds
}

#[test]
fn test_create_batch_streams() {
    let (env, admin, client) = setup_env();
    let sender = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    let mut streams = Vec::new(&env);
    
    // Stream 1
    streams.push_back(CreateStreamParams {
        recipient: Address::generate(&env),
        token: token.clone(),
        total_amount: 10000,
        start_time: 1000,
        end_time: 2000,
    });

    // Stream 2
    streams.push_back(CreateStreamParams {
        recipient: Address::generate(&env),
        token: token.clone(),
        total_amount: 20000,
        start_time: 1000,
        end_time: 3000,
    });

    let stream_ids = client.create_batch_streams(&sender, &streams);
    
    assert_eq!(stream_ids.len(), 2);
    assert_eq!(stream_ids.get(0).unwrap(), 0);
    assert_eq!(stream_ids.get(1).unwrap(), 1);

    let stream0 = client.get_stream(&0);
    assert_eq!(stream0.total_amount, 10000);
    
    let stream1 = client.get_stream(&1);
    assert_eq!(stream1.total_amount, 20000);
}

#[test]
fn test_calculate_claimable() {
    let (env, admin, client) = setup_env();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token,
        &10000_i128,
        &1000_u64,
        &2000_u64,
    );

    // At 50% of the stream duration
    env.ledger().with_mut(|li| {
        li.timestamp = 1500;
    });

    let claimable = client.get_claimable(&stream_id);
    assert_eq!(claimable, 5000); // 50% of 10000
}

#[test]
fn test_cancel_stream() {
    let (env, admin, client) = setup_env();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    let stream_id = client.create_stream(
        &sender,
        &recipient,
        &token,
        &10000_i128,
        &1000_u64,
        &2000_u64,
    );

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.status, StreamStatus::Active);

    client.cancel_stream(&sender, &stream_id);
    
    let stream_cancelled = client.get_stream(&stream_id);
    assert_eq!(stream_cancelled.status, StreamStatus::Cancelled);
}
