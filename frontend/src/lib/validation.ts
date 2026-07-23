/**
 * Pure validation helpers for the stream-creation form and claim/cancel flows.
 * No network or wallet access — these run before any signing happens.
 */

import { StrKey } from '@stellar/stellar-sdk'
import { toStroops } from './format'

export interface FieldError {
  field: string
  message: string
}

/** True for a syntactically valid Stellar ed25519 public key (G...56). */
export function isValidStellarAddress(address: string): boolean {
  if (!address) return false
  try {
    return StrKey.isValidEd25519PublicKey(address.trim())
  } catch {
    return false
  }
}

/** True for a syntactically valid Soroban contract id (C...56). */
export function isValidContractId(id: string): boolean {
  if (!id) return false
  try {
    return StrKey.isValidContract(id.trim())
  } catch {
    return false
  }
}

export interface CreateStreamInput {
  sender: string
  recipient: string
  token: string
  amount: string
  startUnix: number
  endUnix: number
  decimals: number
  /** Optional wallet balance in stroops for an affordability check. */
  balanceStroops?: bigint
  /** Current unix time (seconds); injected for testability. */
  nowUnix: number
}

export interface CreateStreamValidation {
  errors: FieldError[]
  warnings: FieldError[]
  amountStroops: bigint | null
}

/**
 * Validate every field of the create-stream form. Returns hard `errors`
 * (block submission) and soft `warnings` (allow submission but inform the
 * user, e.g. a start time slightly in the past).
 */
export function validateCreateStream(input: CreateStreamInput): CreateStreamValidation {
  const errors: FieldError[] = []
  const warnings: FieldError[] = []
  let amountStroops: bigint | null = null

  if (!isValidStellarAddress(input.recipient)) {
    errors.push({
      field: 'recipient',
      message: 'Enter a valid Stellar address (starts with G, 56 characters).',
    })
  } else if (
    isValidStellarAddress(input.sender) &&
    input.recipient.trim() === input.sender.trim()
  ) {
    errors.push({
      field: 'recipient',
      message: 'Recipient cannot be the same as your own wallet address.',
    })
  }

  if (!isValidContractId(input.token)) {
    errors.push({
      field: 'token',
      message: 'Enter a valid token contract id (starts with C, 56 characters).',
    })
  }

  try {
    const stroops = toStroops(input.amount, input.decimals)
    if (stroops <= 0n) {
      errors.push({ field: 'amount', message: 'Amount must be greater than zero.' })
    } else {
      amountStroops = stroops
    }
  } catch (e) {
    errors.push({
      field: 'amount',
      message: e instanceof Error ? e.message : 'Invalid amount.',
    })
  }

  if (!Number.isFinite(input.startUnix)) {
    errors.push({ field: 'startTime', message: 'Choose a valid start date and time.' })
  }
  if (!Number.isFinite(input.endUnix)) {
    errors.push({ field: 'endTime', message: 'Choose a valid end date and time.' })
  }
  if (
    Number.isFinite(input.startUnix) &&
    Number.isFinite(input.endUnix) &&
    input.endUnix <= input.startUnix
  ) {
    errors.push({
      field: 'endTime',
      message: 'The end time must be after the start time.',
    })
  }
  if (Number.isFinite(input.startUnix) && input.startUnix < input.nowUnix) {
    warnings.push({
      field: 'startTime',
      message: 'Start time is in the past — streaming will begin accruing immediately.',
    })
  }

  if (
    amountStroops !== null &&
    input.balanceStroops !== undefined &&
    amountStroops > input.balanceStroops
  ) {
    errors.push({
      field: 'amount',
      message: 'Insufficient wallet balance to fully fund this stream.',
    })
  }

  return { errors, warnings, amountStroops }
}

/**
 * Compute the rate-per-second (stroops/sec) for a stream using integer math,
 * mirroring the contract's `total_amount / duration`. Returns 0n if the
 * duration is non-positive.
 */
export function computeRatePerSecond(amountStroops: bigint, durationSeconds: number): bigint {
  if (durationSeconds <= 0) return 0n
  return amountStroops / BigInt(durationSeconds)
}

/**
 * Compute claimable, recipient settlement, and sender refund for a cancel
 * preview, mirroring the contract's linear accrual math exactly (integer
 * division). All values are stroops.
 *
 * - accrued   = total * elapsed / duration, clamped to [claimed, total]
 * - claimable = accrued - claimed (recipient settlement on cancel)
 * - refund    = total - claimed - claimable (returned to sender)
 */
export function computeCancelSettlement(params: {
  totalAmount: bigint
  claimedAmount: bigint
  startTime: number
  endTime: number
  nowUnix: number
}): { claimable: bigint; refund: bigint; accrued: bigint } {
  const { totalAmount, claimedAmount, startTime, endTime, nowUnix } = params
  const duration = endTime - startTime
  if (duration <= 0 || nowUnix <= startTime) {
    return { claimable: 0n, refund: totalAmount - claimedAmount, accrued: claimedAmount }
  }
  const effective = nowUnix >= endTime ? endTime : nowUnix
  const elapsed = BigInt(effective - startTime)
  let accrued = (totalAmount * elapsed) / BigInt(duration)
  if (accrued > totalAmount) accrued = totalAmount
  if (accrued < claimedAmount) accrued = claimedAmount
  const claimable = accrued - claimedAmount
  const refund = totalAmount - claimedAmount - claimable
  return { claimable, refund, accrued }
}

// ── Vesting ──────────────────────────────────────────────────────────────

/**
 * Preset labels offered in the vesting schedule form (FE-16). A grantor can
 * still type a custom label — these are just the common cases.
 */
export const VESTING_LABELS = ['team', 'advisor', 'seed', 'custom'] as const

/**
 * Compute the amount vested by `nowUnix`, mirroring the contract's
 * `calculate_vested` exactly (integer bigint math only — see
 * contracts/contracts/vesting/src/lib.rs):
 *
 * - Before start_time: 0.
 * - Before the cliff (elapsed < cliff_duration): 0.
 * - At/after total_duration: the full total_amount.
 * - Otherwise: cliff_amount + linear share of (total_amount - cliff_amount)
 *   over (total_duration - cliff_duration), based on time since the cliff.
 */
export function computeVestedAmount(params: {
  totalAmount: bigint
  cliffAmount: bigint
  startTime: number
  cliffDuration: number
  totalDuration: number
  nowUnix: number
}): bigint {
  const { totalAmount, cliffAmount, startTime, cliffDuration, totalDuration, nowUnix } = params
  if (nowUnix < startTime) return 0n

  const elapsed = nowUnix - startTime
  if (elapsed < cliffDuration) return 0n
  if (elapsed >= totalDuration) return totalAmount

  const remainingAmount = totalAmount - cliffAmount
  const vestingDuration = BigInt(totalDuration - cliffDuration)
  const timeSinceCliff = BigInt(elapsed - cliffDuration)
  const vestedLinear = (remainingAmount * timeSinceCliff) / vestingDuration

  return cliffAmount + vestedLinear
}

/**
 * Vested/claimable preview for a schedule, mirroring get_progress's
 * claimable_amount clamp (never negative).
 */
export function computeVestingProgress(params: {
  totalAmount: bigint
  claimedAmount: bigint
  cliffAmount: bigint
  startTime: number
  cliffDuration: number
  totalDuration: number
  nowUnix: number
}): { vested: bigint; claimable: bigint } {
  const vested = computeVestedAmount(params)
  const claimableRaw = vested - params.claimedAmount
  return { vested, claimable: claimableRaw > 0n ? claimableRaw : 0n }
}

export interface CreateScheduleInput {
  grantor: string
  beneficiary: string
  token: string
  amount: string
  startUnix: number
  cliffDurationSeconds: number
  cliffAmount: string
  totalDurationSeconds: number
  label: string
  decimals: number
  /** Optional wallet balance in stroops for an affordability check. */
  balanceStroops?: bigint
  /** Current unix time (seconds); injected for testability. */
  nowUnix: number
}

export interface CreateScheduleValidation {
  errors: FieldError[]
  warnings: FieldError[]
  amountStroops: bigint | null
  cliffAmountStroops: bigint | null
}

/**
 * Validate every field of the create-schedule form. Mirrors the contract's
 * own checks (create_schedule in lib.rs) so invalid input is caught before
 * a transaction is ever built:
 * total_amount > 0, total_duration > 0, cliff_duration < total_duration,
 * 0 <= cliff_amount <= total_amount.
 */
export function validateCreateSchedule(input: CreateScheduleInput): CreateScheduleValidation {
  const errors: FieldError[] = []
  const warnings: FieldError[] = []
  let amountStroops: bigint | null = null
  let cliffAmountStroops: bigint | null = null

  if (!isValidStellarAddress(input.beneficiary)) {
    errors.push({
      field: 'beneficiary',
      message: 'Enter a valid Stellar address (starts with G, 56 characters).',
    })
  } else if (
    isValidStellarAddress(input.grantor) &&
    input.beneficiary.trim() === input.grantor.trim()
  ) {
    errors.push({
      field: 'beneficiary',
      message: 'Beneficiary cannot be the same as your own wallet address.',
    })
  }

  if (!isValidContractId(input.token)) {
    errors.push({
      field: 'token',
      message: 'Enter a valid token contract id (starts with C, 56 characters).',
    })
  }

  try {
    const stroops = toStroops(input.amount, input.decimals)
    if (stroops <= 0n) {
      errors.push({ field: 'amount', message: 'Total amount must be greater than zero.' })
    } else {
      amountStroops = stroops
    }
  } catch (e) {
    errors.push({
      field: 'amount',
      message: e instanceof Error ? e.message : 'Invalid amount.',
    })
  }

  try {
    cliffAmountStroops = input.cliffAmount.trim() === '' ? 0n : toStroops(input.cliffAmount, input.decimals)
    if (cliffAmountStroops < 0n) {
      errors.push({ field: 'cliffAmount', message: 'Cliff amount cannot be negative.' })
    }
  } catch (e) {
    errors.push({
      field: 'cliffAmount',
      message: e instanceof Error ? e.message : 'Invalid cliff amount.',
    })
  }

  if (
    amountStroops !== null &&
    cliffAmountStroops !== null &&
    cliffAmountStroops > amountStroops
  ) {
    errors.push({
      field: 'cliffAmount',
      message: 'Cliff amount cannot exceed the total amount.',
    })
  }

  if (!Number.isFinite(input.startUnix)) {
    errors.push({ field: 'startTime', message: 'Choose a valid start date and time.' })
  } else if (input.startUnix < input.nowUnix) {
    warnings.push({
      field: 'startTime',
      message: 'Start time is in the past — vesting will begin accruing immediately.',
    })
  }

  if (!Number.isFinite(input.totalDurationSeconds) || input.totalDurationSeconds <= 0) {
    errors.push({ field: 'totalDuration', message: 'Total duration must be greater than zero.' })
  }

  if (!Number.isFinite(input.cliffDurationSeconds) || input.cliffDurationSeconds < 0) {
    errors.push({ field: 'cliffDuration', message: 'Cliff duration cannot be negative.' })
  } else if (
    Number.isFinite(input.totalDurationSeconds) &&
    input.totalDurationSeconds > 0 &&
    input.cliffDurationSeconds >= input.totalDurationSeconds
  ) {
    errors.push({
      field: 'cliffDuration',
      message: 'Cliff duration must be shorter than the total vesting duration.',
    })
  }

  if (!input.label.trim()) {
    errors.push({ field: 'label', message: 'Choose or enter a label for this schedule.' })
  }

  if (
    amountStroops !== null &&
    input.balanceStroops !== undefined &&
    amountStroops > input.balanceStroops
  ) {
    errors.push({
      field: 'amount',
      message: 'Insufficient wallet balance to fully fund this schedule.',
    })
  }

  return { errors, warnings, amountStroops, cliffAmountStroops }
}
