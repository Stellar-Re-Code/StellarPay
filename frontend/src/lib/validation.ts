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
