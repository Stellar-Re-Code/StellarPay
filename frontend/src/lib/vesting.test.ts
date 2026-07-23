import { describe, it, expect } from 'vitest'
import { computeVestedAmount, computeVestingProgress, validateCreateSchedule } from './validation'
import {
  messageForVestingErrorCode,
  toFriendlyVestingError,
  VESTING_ERROR_CODES,
} from './errors'

const VALID_G = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const OTHER_G = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ'
const VALID_C = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

// Fixture matches contracts/contracts/vesting/src/test.rs exactly: 100_000
// total, 25_000 cliff, 1-year cliff, 4-year total duration.
const YEAR = 365 * 24 * 60 * 60
const START = 1000

const BASE = {
  totalAmount: 100_000n,
  cliffAmount: 25_000n,
  startTime: START,
  cliffDuration: YEAR,
  totalDuration: 4 * YEAR,
}

describe('computeVestedAmount — mirrors calculate_vested', () => {
  it('is 0 before start_time', () => {
    expect(computeVestedAmount({ ...BASE, nowUnix: START - 1 })).toBe(0n)
  })

  it('is 0 before the cliff (6 months in, matches test_cliff_not_reached)', () => {
    expect(computeVestedAmount({ ...BASE, nowUnix: START + YEAR / 2 })).toBe(0n)
  })

  it('is exactly the cliff_amount right at the cliff', () => {
    expect(computeVestedAmount({ ...BASE, nowUnix: START + YEAR })).toBe(25_000n)
  })

  it('is 50_000 at exactly 2 years, matching test_vesting_after_cliff', () => {
    expect(computeVestedAmount({ ...BASE, nowUnix: START + 2 * YEAR })).toBe(50_000n)
  })

  it('is the full total_amount at/after total_duration', () => {
    expect(computeVestedAmount({ ...BASE, nowUnix: START + 4 * YEAR })).toBe(100_000n)
    expect(computeVestedAmount({ ...BASE, nowUnix: START + 10 * YEAR })).toBe(100_000n)
  })

  it('handles a zero cliff_amount (pure linear from start of cliff)', () => {
    const params = { ...BASE, cliffAmount: 0n }
    expect(computeVestedAmount({ ...params, nowUnix: START + YEAR })).toBe(0n)
    expect(computeVestedAmount({ ...params, nowUnix: START + 2 * YEAR })).toBe(
      (100_000n * BigInt(YEAR)) / BigInt(3 * YEAR),
    )
  })
})

describe('computeVestingProgress', () => {
  it('claimable is vested minus claimed, clamped at 0', () => {
    const result = computeVestingProgress({ ...BASE, claimedAmount: 25_000n, nowUnix: START + 2 * YEAR })
    expect(result.vested).toBe(50_000n)
    expect(result.claimable).toBe(25_000n)
  })

  it('claimable never goes negative even if claimed exceeds vested', () => {
    const result = computeVestingProgress({ ...BASE, claimedAmount: 60_000n, nowUnix: START + 2 * YEAR })
    expect(result.vested).toBe(50_000n)
    expect(result.claimable).toBe(0n)
  })

  it('claimable is 0 before the cliff even with no prior claims', () => {
    const result = computeVestingProgress({ ...BASE, claimedAmount: 0n, nowUnix: START + YEAR / 2 })
    expect(result.claimable).toBe(0n)
  })
})

describe('validateCreateSchedule', () => {
  const validInput = {
    grantor: VALID_G,
    beneficiary: OTHER_G,
    token: VALID_C,
    amount: '100',
    startUnix: 2_000_000_000,
    cliffDurationSeconds: YEAR,
    cliffAmount: '25',
    totalDurationSeconds: 4 * YEAR,
    label: 'team',
    decimals: 7,
    nowUnix: 1_000_000_000,
  }

  it('accepts a valid schedule', () => {
    const result = validateCreateSchedule(validInput)
    expect(result.errors).toHaveLength(0)
    expect(result.amountStroops).toBe(1_000_000_000n)
    expect(result.cliffAmountStroops).toBe(250_000_000n)
  })

  it('rejects an invalid beneficiary address', () => {
    const result = validateCreateSchedule({ ...validInput, beneficiary: 'not-an-address' })
    expect(result.errors.some((e) => e.field === 'beneficiary')).toBe(true)
  })

  it('rejects beneficiary === grantor', () => {
    const result = validateCreateSchedule({ ...validInput, beneficiary: validInput.grantor })
    expect(result.errors.some((e) => e.field === 'beneficiary')).toBe(true)
  })

  it('rejects an invalid token contract id', () => {
    const result = validateCreateSchedule({ ...validInput, token: 'not-a-contract' })
    expect(result.errors.some((e) => e.field === 'token')).toBe(true)
  })

  it('rejects a zero total amount', () => {
    const result = validateCreateSchedule({ ...validInput, amount: '0' })
    expect(result.errors.some((e) => e.field === 'amount')).toBe(true)
  })

  it('rejects a cliff amount exceeding the total', () => {
    const result = validateCreateSchedule({ ...validInput, amount: '100', cliffAmount: '200' })
    expect(result.errors.some((e) => e.field === 'cliffAmount')).toBe(true)
  })

  it('rejects a negative-duration cliff (cliff >= total)', () => {
    const result = validateCreateSchedule({
      ...validInput,
      cliffDurationSeconds: 4 * YEAR,
      totalDurationSeconds: 4 * YEAR,
    })
    expect(result.errors.some((e) => e.field === 'cliffDuration')).toBe(true)
  })

  it('rejects a zero total duration', () => {
    const result = validateCreateSchedule({ ...validInput, totalDurationSeconds: 0 })
    expect(result.errors.some((e) => e.field === 'totalDuration')).toBe(true)
  })

  it('rejects an empty label', () => {
    const result = validateCreateSchedule({ ...validInput, label: '  ' })
    expect(result.errors.some((e) => e.field === 'label')).toBe(true)
  })

  it('warns (not errors) when start time is in the past', () => {
    const result = validateCreateSchedule({ ...validInput, startUnix: validInput.nowUnix - 100 })
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.some((w) => w.field === 'startTime')).toBe(true)
  })

  it('errors when amount exceeds the supplied balance', () => {
    const result = validateCreateSchedule({ ...validInput, balanceStroops: 500_000_000n })
    expect(result.errors.some((e) => e.field === 'amount')).toBe(true)
  })

  it('allows an empty cliff amount, defaulting to 0', () => {
    const result = validateCreateSchedule({ ...validInput, cliffAmount: '' })
    expect(result.errors).toHaveLength(0)
    expect(result.cliffAmountStroops).toBe(0n)
  })
})

describe('vesting error code mapping', () => {
  it('maps every documented code to a distinct message', () => {
    for (const code of Object.values(VESTING_ERROR_CODES)) {
      expect(messageForVestingErrorCode(code)).not.toMatch(/^Contract error/)
    }
  })

  it('falls back to a generic message for an unknown code', () => {
    expect(messageForVestingErrorCode(999)).toBe('Contract error #999.')
  })

  it('toFriendlyVestingError extracts a known contract error code', () => {
    const err = new Error('HostError: Error(Contract, #8)')
    expect(toFriendlyVestingError(err)).toBe(messageForVestingErrorCode(VESTING_ERROR_CODES.NothingToClaim))
  })

  it('toFriendlyVestingError recognizes a user rejection', () => {
    const err = new Error('User declined access')
    expect(toFriendlyVestingError(err)).toMatch(/rejected/i)
  })
})
