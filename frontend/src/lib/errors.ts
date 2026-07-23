/**
 * Maps payroll_stream contract error codes (and common RPC/wallet failures)
 * to friendly, action-oriented messages for the UI.
 *
 * Error codes mirror `contracts/contracts/payroll_stream/src/errors.rs`.
 */

export const STREAM_ERROR_CODES = {
  AlreadyInitialized: 1,
  NotInitialized: 2,
  Unauthorized: 3,
  InvalidAmount: 4,
  InvalidDuration: 5,
  StreamNotFound: 6,
  StreamAlreadyCancelled: 7,
  StreamCompleted: 8,
  NothingToClaim: 9,
  InvalidStartTime: 10,
  InvalidRecipient: 11,
} as const

const MESSAGES: Record<number, string> = {
  1: 'The contract is already initialized.',
  2: 'The payroll contract has not been initialized yet. Contact the organization admin.',
  3: 'You are not authorized to perform this action on this stream.',
  4: 'The stream amount is invalid. It must be greater than zero.',
  5: 'The stream duration is invalid. The end time must be after the start time.',
  6: 'Stream not found. It may have been removed or never existed.',
  7: 'This stream has already been cancelled.',
  8: 'This stream has already completed — all tokens have been distributed.',
  9: 'There is nothing to claim right now. Check back once more time has elapsed.',
  10: 'The start time is invalid. It must be now or in the future.',
  11: 'Invalid recipient. The recipient cannot be the same as the sender.',
}

/** Look up the friendly message for a numeric contract error code. */
export function messageForStreamErrorCode(code: number): string {
  return MESSAGES[code] ?? `Contract error #${code}.`
}

/**
 * Best-effort extraction of a contract error code from a thrown error or RPC
 * result string. Soroban surfaces contract errors as
 * `Error(Contract, #N)` inside diagnostic / result XDR-decoded strings.
 */
export function extractStreamErrorCode(input: unknown): number | null {
  const text = stringifyError(input)
  // Match patterns like "Error(Contract, #9)" or "ContractError(9)" or "#9".
  const patterns = [
    /Error\(Contract,\s*#(\d+)\)/i,
    /ContractError\((\d+)\)/i,
    /contract error[^0-9]*(\d+)/i,
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    if (m) return Number(m[1])
  }
  return null
}

/** True when the error indicates the user rejected the signing request. */
export function isUserRejection(input: unknown): boolean {
  const text = stringifyError(input).toLowerCase()
  return (
    text.includes('user declined') ||
    text.includes('user rejected') ||
    text.includes('denied') ||
    text.includes('rejected the request')
  )
}

/**
 * Produce a single human-readable message for any error surfaced by the
 * contract, RPC, or wallet. Prefers a specific contract-error message when
 * a code can be extracted.
 */
export function toFriendlyError(input: unknown): string {
  if (isUserRejection(input)) {
    return 'Signature request was rejected. No transaction was submitted and no funds moved.'
  }
  const code = extractStreamErrorCode(input)
  if (code !== null) {
    return messageForStreamErrorCode(code)
  }
  const text = stringifyError(input)
  if (text.toLowerCase().includes('freighter')) {
    return text
  }
  if (
    text.toLowerCase().includes('insufficient') ||
    text.toLowerCase().includes('underfunded')
  ) {
    return 'Insufficient balance to complete this transaction. No funds were moved.'
  }
  return text || 'An unexpected error occurred.'
}

/**
 * Maps `vesting` contract error codes to friendly messages. Mirrors
 * `contracts/contracts/vesting/src/errors.rs`.
 *
 * Note: the contract never actually returns CliffNotReached (#9) today —
 * `calculate_vested` simply returns 0 before the cliff, so a pre-cliff claim
 * fails with NothingToClaim (#8) instead. The message is kept here for
 * completeness/future-proofing; the UI should gate the claim button on the
 * cliff date client-side rather than expecting this code to appear.
 */
export const VESTING_ERROR_CODES = {
  AlreadyInitialized: 1,
  NotInitialized: 2,
  Unauthorized: 3,
  InvalidAmount: 4,
  InvalidSchedule: 5,
  ScheduleNotFound: 6,
  ScheduleRevoked: 7,
  NothingToClaim: 8,
  CliffNotReached: 9,
  AlreadyFullyClaimed: 10,
  InvalidCliffDuration: 11,
  InsufficientBalance: 12,
} as const

const VESTING_MESSAGES: Record<number, string> = {
  1: 'The vesting contract is already initialized.',
  2: 'The vesting contract has not been initialized yet. Contact the organization admin.',
  3: 'You are not authorized to perform this action on this schedule.',
  4: 'The amount is invalid. Total amount must be greater than zero, and cliff amount must be between 0 and the total.',
  5: 'The schedule is invalid. Total duration must be greater than zero.',
  6: 'Schedule not found. It may have been removed or never existed.',
  7: 'This schedule has already been revoked.',
  8: 'There is nothing to claim right now. Check back once more time has elapsed, or after the cliff.',
  9: 'The cliff period has not been reached yet — nothing vests until then.',
  10: 'This schedule has already been fully claimed.',
  11: 'The cliff duration must be shorter than the total vesting duration.',
  12: 'Insufficient token balance to complete this transaction. No funds were moved.',
}

/** Look up the friendly message for a numeric vesting contract error code. */
export function messageForVestingErrorCode(code: number): string {
  return VESTING_MESSAGES[code] ?? `Contract error #${code}.`
}

/**
 * Produce a single human-readable message for any error surfaced by the
 * vesting contract, RPC, or wallet. Prefers a specific contract-error
 * message when a code can be extracted.
 */
export function toFriendlyVestingError(input: unknown): string {
  if (isUserRejection(input)) {
    return 'Signature request was rejected. No transaction was submitted and no funds moved.'
  }
  const code = extractStreamErrorCode(input)
  if (code !== null) {
    return messageForVestingErrorCode(code)
  }
  const text = stringifyError(input)
  if (text.toLowerCase().includes('freighter')) {
    return text
  }
  if (text.toLowerCase().includes('insufficient') || text.toLowerCase().includes('underfunded')) {
    return 'Insufficient balance to complete this transaction. No funds were moved.'
  }
  return text || 'An unexpected error occurred.'
}

function stringifyError(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  if (input instanceof Error) return input.message
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    try {
      return JSON.stringify(input)
    } catch {
      return String(input)
    }
  }
  return String(input)
}
