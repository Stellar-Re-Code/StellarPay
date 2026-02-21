#![cfg(test)]

use super::*;
use soroban_sdk::{symbol_short, testutils::Address as _, token, Address, Env, Vec};
use types::WithdrawalStatus;

fn setup_env() -> (Env, Address, TreasuryContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(TreasuryContract, ());
    let client = TreasuryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (env, admin, client) = setup_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1);
    signers.push_back(signer2);

    client.initialize(&admin, &signers, &2);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_threshold(), 2);
    assert_eq!(client.get_signers().len(), 2);
}

#[test]
#[should_panic]
fn test_double_initialize() {
    let (env, admin, client) = setup_env();
    let signer1 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1);

    client.initialize(&admin, &signers, &1);
    // This should panic with AlreadyInitialized
    client.initialize(&admin, &signers, &1);
}

#[test]
fn test_create_and_approve_withdrawal() {
    let (env, admin, client) = setup_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let token = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initialize(&admin, &signers, &2);

    let proposal_id = client.create_withdrawal(
        &signer1,
        &token,
        &recipient,
        &1000_i128,
        &symbol_short!("salary"),
    );
    assert_eq!(proposal_id, 0);

    // First approval is automatic (proposer)
    let request = client.get_withdrawal(&proposal_id);
    assert_eq!(request.approvals.len(), 1);

    // Second signer approves
    client.approve_withdrawal(&signer2, &proposal_id);
    let request = client.get_withdrawal(&proposal_id);
    assert_eq!(request.status, WithdrawalStatus::Approved);
}

#[test]
fn test_add_and_remove_signer() {
    let (env, admin, client) = setup_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initialize(&admin, &signers, &1);

    // Add a signer
    client.add_signer(&admin, &signer3);
    assert_eq!(client.get_signers().len(), 3);

    // Remove a signer
    client.remove_signer(&admin, &signer2);
    assert_eq!(client.get_signers().len(), 2);
}

// TODO: Additional tests for contributors (see SC-8 in issues)
// - test_unauthorized_withdrawal
// - test_threshold_update
// - test_cancel_withdrawal
// - test_invalid_threshold_rejected

fn create_token_contract<'a>(e: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let contract_addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(e, &contract_addr)
}

fn create_token_client<'a>(e: &Env, contract_addr: &Address) -> token::Client<'a> {
    token::Client::new(e, contract_addr)
}

#[test]
fn test_execute_withdrawal_full_flow() {
    let (env, admin, client) = setup_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let token_admin = Address::generate(&env);
    let token_admin_client = create_token_contract(&env, &token_admin);
    let token = token_admin_client.address.clone();
    let token_client = create_token_client(&env, &token);

    client.initialize(&admin, &signers, &2);

    let deposit_amount: i128 = 10000;
    token_admin_client.mint(&client.address, &deposit_amount);

    assert_eq!(token_client.balance(&client.address), deposit_amount);
    assert_eq!(token_client.balance(&recipient), 0);

    let withdrawal_amount: i128 = 5000;
    let proposal_id = client.create_withdrawal(
        &signer1,
        &token,
        &recipient,
        &withdrawal_amount,
        &symbol_short!("salary"),
    );

    client.approve_withdrawal(&signer2, &proposal_id);
    let request = client.get_withdrawal(&proposal_id);
    assert_eq!(request.status, WithdrawalStatus::Approved);

    client.execute_withdrawal(&signer1, &proposal_id);

    let request = client.get_withdrawal(&proposal_id);
    assert_eq!(request.status, WithdrawalStatus::Executed);

    assert_eq!(token_client.balance(&recipient), withdrawal_amount);
    assert_eq!(
        token_client.balance(&client.address),
        deposit_amount - withdrawal_amount
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_execute_withdrawal_insufficient_balance() {
    let (env, admin, client) = setup_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let token_admin = Address::generate(&env);
    let token_admin_client = create_token_contract(&env, &token_admin);
    let token = token_admin_client.address.clone();

    client.initialize(&admin, &signers, &2);

    let withdrawal_amount: i128 = 5000;
    let proposal_id = client.create_withdrawal(
        &signer1,
        &token,
        &recipient,
        &withdrawal_amount,
        &symbol_short!("salary"),
    );

    client.approve_withdrawal(&signer2, &proposal_id);

    client.execute_withdrawal(&signer1, &proposal_id);
}
