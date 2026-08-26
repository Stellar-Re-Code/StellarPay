use soroban_sdk::{contracttype, Address, Symbol};

/// Status of a vesting schedule.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VestingStatus {
    /// Tokens are actively vesting according to the schedule.
    Active,
    /// The schedule has been revoked by the admin — unvested tokens returned.
    Revoked,
    /// All tokens have been fully vested and claimed.
    FullyClaimed,
}

/// A vesting schedule with cliff + linear vesting.
///
/// Example: 48-month vesting with 12-month cliff
/// - Nothing vests for the first 12 months (cliff period)
/// - At month 12, 25% vests instantly (cliff unlock)
/// - Remaining 75% vests linearly over the next 36 months
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    /// Unique identifier for this vesting schedule.
    pub id: u32,
    /// The organization or grantor creating the vesting schedule.
    pub grantor: Address,
    /// The beneficiary (employee, advisor, investor) receiving vested tokens.
    pub beneficiary: Address,
    /// The token being vested.
    pub token: Address,
    /// Total amount of tokens to vest.
    pub total_amount: i128,
    /// Amount already claimed by the beneficiary.
    pub claimed_amount: i128,
    /// Unix timestamp when vesting begins.
    pub start_time: u64,
    /// Duration (in seconds) of the cliff period. No tokens vest before this.
    pub cliff_duration: u64,
    /// Amount of tokens that unlock immediately at the cliff.
    pub cliff_amount: i128,
    /// Total vesting duration (in seconds) from start to fully vested.
    pub total_duration: u64,
    /// A label for this schedule (e.g., "advisor", "team", "seed").
    pub label: Symbol,
    /// Current status of the vesting schedule.
    pub status: VestingStatus,
    /// Whether the schedule is revocable by the grantor.
    pub revocable: bool,
}

/// Summary view of vesting progress.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingProgress {
    pub total_amount: i128,
    pub vested_amount: i128,
    pub claimed_amount: i128,
    pub claimable_amount: i128,
    pub status: VestingStatus,
}

/// Settlement result emitted when a vesting schedule is revoked (issue #77).
///
/// Conservation invariant: `beneficiary_payout + issuer_refund + prior_claims`
/// always equals the original escrow amount of the schedule.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingRevocation {
    /// The revoked schedule.
    pub schedule_id: u32,
    /// Who performed the revocation (the grantor).
    pub actor: Address,
    /// Vested-but-unclaimed tokens paid to the beneficiary at revocation.
    pub beneficiary_payout: i128,
    /// Unvested tokens returned to the issuer/grantor.
    pub issuer_refund: i128,
    /// Tokens the beneficiary had already claimed before revocation.
    pub prior_claims: i128,
    /// Terminal state marker (always `Revoked`).
    pub terminal_status: soroban_sdk::Symbol,
}
