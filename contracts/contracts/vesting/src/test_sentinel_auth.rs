#![cfg(test)]

use crate::{VestingContract, VestingContractClient};
use soroban_sdk::testutils::MockAuth;
use soroban_sdk::testutils::MockAuthInvoke;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, IntoVal, Symbol,
};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let contract_addr = e.register_stellar_asset_contract(admin.clone());
    token::StellarAssetClient::new(e, &contract_addr)
}

fn create_token_client<'a>(e: &Env, contract_addr: &Address) -> token::Client<'a> {
    token::Client::new(e, contract_addr)
}

#[test]
fn test_sentinel_authorized_vesting() {
    let env = Env::default();

    let contract_id = env.register(VestingContract, ());
    let client = VestingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    // "Sentinel" treasury acts as the grantor
    let sentinel_treasury = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_admin_client = create_token_contract(&env, &token_admin);
    let token = token_admin_client.address.clone();
    let token_client = create_token_client(&env, &token);

    // Sentinel holds treasury funds
    env.mock_all_auths();
    client.initialize(&admin);
    token_admin_client.mint(&sentinel_treasury, &100000);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    let amount: i128 = 50000;
    let start_time: u64 = 1000;
    let cliff_duration: u64 = 1000;
    let cliff_amount: i128 = 10000;
    let total_duration: u64 = 10000;
    let label = Symbol::new(&env, "founder");
    let revocable = true;

    // Use MockAuth to simulate the Sentinel smart contract authorizing the schedule creation.
    client
        .mock_auths(&[MockAuth {
            address: &sentinel_treasury,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "create_schedule",
                args: (
                    sentinel_treasury.clone(),
                    beneficiary.clone(),
                    token.clone(),
                    amount,
                    start_time,
                    cliff_duration,
                    cliff_amount,
                    total_duration,
                    label.clone(),
                    revocable,
                )
                    .into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (sentinel_treasury.clone(), contract_id.clone(), amount).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }])
        .create_schedule(
            &sentinel_treasury,
            &beneficiary,
            &token,
            &amount,
            &start_time,
            &cliff_duration,
            &cliff_amount,
            &total_duration,
            &label,
            &revocable,
        );

    assert_eq!(client.get_schedule_count(), 1);
    let schedule = client.get_schedule(&0);
    assert_eq!(schedule.total_amount, amount);
    assert_eq!(token_client.balance(&sentinel_treasury), 50000);
    assert_eq!(token_client.balance(&contract_id), 50000);
}
