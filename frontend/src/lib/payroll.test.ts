import { describe, it, expect } from 'vitest'
import {
  toStroops,
  fromStroops,
  formatAmount,
  truncateAddress,
  explorerTxUrl,
  explorerAccountUrl,
  datetimeLocalToUnix,
  unixToDatetimeLocal,
  formatRatePerSecond,
  formatDuration,
} from './format'
import {
  validateCreateStream,
  computeRatePerSecond,
  computeCancelSettlement,
  isValidStellarAddress,
} from './validation'
import {
  messageForStreamErrorCode,
  extractStreamErrorCode,
  toFriendlyError,
  isUserRejection,
  STREAM_ERROR_CODES,
} from './errors'

const VALID_G = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const OTHER_G = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ'
const VALID_C = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

describe('toStroops / fromStroops round-trips', () => {
  const cases = ['0', '1', '12.5', '0.0000001', '9999999.9999999', '100', '0.1']
  for (const c of cases) {
    it(`round-trips ${c}`, () => {
      const stroops = toStroops(c, 7)
      expect(fromStroops(stroops, 7)).toBe(c === '0' ? '0' : normalize(c))
    })
  }

  it('handles 7-decimal precision exactly without float error', () => {
    expect(toStroops('1', 7)).toBe(10_000_000n)
    expect(toStroops('0.0000001', 7)).toBe(1n)
    expect(toStroops('123.4567891', 7)).toBe(1_234_567_891n)
  })

  it('respects a custom decimals parameter', () => {
    expect(toStroops('1', 2)).toBe(100n)
    expect(fromStroops(100n, 2)).toBe('1')
    expect(toStroops('1.23', 2)).toBe(123n)
  })

  it('throws on too many decimal places', () => {
    expect(() => toStroops('1.12345678', 7)).toThrow()
  })

  it('throws on empty / malformed input', () => {
    expect(() => toStroops('', 7)).toThrow()
    expect(() => toStroops('abc', 7)).toThrow()
    expect(() => toStroops('1.2.3', 7)).toThrow()
  })

  it('handles negative amounts symmetrically', () => {
    expect(toStroops('-5', 7)).toBe(-50_000_000n)
    expect(fromStroops(-50_000_000n, 7)).toBe('-5')
  })
})

function normalize(s: string): string {
  // fromStroops trims trailing zeros; mirror that for expectation.
  if (!s.includes('.')) return s
  const trimmed = s.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed
}

describe('formatAmount', () => {
  it('adds thousands separators and a symbol', () => {
    expect(formatAmount(12_345_678_900_000n, 7, { symbol: 'XLM' })).toBe('1,234,567.89 XLM')
  })
  it('groups whole numbers', () => {
    expect(formatAmount(1_000_000_0000000n, 7)).toBe('1,000,000')
  })
})

describe('truncateAddress', () => {
  it('truncates a long address', () => {
    expect(truncateAddress(VALID_G)).toBe('GBZX…MADI')
  })
  it('leaves short strings intact', () => {
    expect(truncateAddress('GABC')).toBe('GABC')
  })
})

describe('explorer URLs', () => {
  it('builds tx and account URLs for testnet', () => {
    expect(explorerTxUrl('abc123')).toBe('https://stellar.expert/explorer/testnet/tx/abc123')
    expect(explorerAccountUrl(VALID_G)).toBe(
      `https://stellar.expert/explorer/testnet/account/${VALID_G}`,
    )
  })
})

describe('datetime helpers', () => {
  it('round-trips unix <-> datetime-local at minute precision', () => {
    const unix = 1_700_000_000
    const local = unixToDatetimeLocal(unix)
    const back = datetimeLocalToUnix(local)
    // minute precision: difference < 60s and aligned to the minute
    expect(Math.abs(back - unix)).toBeLessThan(60)
    expect(back % 60).toBe(0)
  })
  it('returns NaN for empty input', () => {
    expect(Number.isNaN(datetimeLocalToUnix(''))).toBe(true)
  })
})

describe('formatRatePerSecond / formatDuration', () => {
  it('renders rate per day from a per-second stroops rate', () => {
    // 1 token/day = 10_000_000 / 86400 stroops/sec, integer-floored
    const perSec = 10_000_000n / 86400n
    const out = formatRatePerSecond(perSec, 7, 'TKN')
    expect(out).toContain('/ day')
    expect(out).toContain('TKN')
  })
  it('formats durations compactly', () => {
    expect(formatDuration(90061)).toBe('1d 1h 1m')
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45)).toBe('45s')
  })
})

describe('isValidStellarAddress', () => {
  it('accepts a valid G address', () => {
    expect(isValidStellarAddress(VALID_G)).toBe(true)
  })
  it('rejects junk and contract ids', () => {
    expect(isValidStellarAddress('not-an-address')).toBe(false)
    expect(isValidStellarAddress(VALID_C)).toBe(false)
    expect(isValidStellarAddress('')).toBe(false)
  })
})

describe('validateCreateStream', () => {
  const base = {
    sender: VALID_G,
    recipient: OTHER_G,
    token: VALID_C,
    amount: '100',
    startUnix: 2_000_000_000,
    endUnix: 2_000_086_400,
    decimals: 7,
    nowUnix: 1_999_999_000,
  }

  it('passes a fully valid input', () => {
    const r = validateCreateStream(base)
    expect(r.errors).toHaveLength(0)
    expect(r.amountStroops).toBe(1_000_000_000n)
  })

  it('rejects an invalid recipient', () => {
    const r = validateCreateStream({ ...base, recipient: 'bad' })
    expect(r.errors.some((e) => e.field === 'recipient')).toBe(true)
  })

  it('rejects recipient equal to sender', () => {
    const r = validateCreateStream({ ...base, recipient: VALID_G })
    expect(r.errors.some((e) => e.field === 'recipient')).toBe(true)
  })

  it('rejects an invalid token id', () => {
    const r = validateCreateStream({ ...base, token: VALID_G })
    expect(r.errors.some((e) => e.field === 'token')).toBe(true)
  })

  it('rejects non-positive / over-precise amounts', () => {
    expect(validateCreateStream({ ...base, amount: '0' }).errors.some((e) => e.field === 'amount')).toBe(
      true,
    )
    expect(
      validateCreateStream({ ...base, amount: '1.123456789' }).errors.some((e) => e.field === 'amount'),
    ).toBe(true)
  })

  it('rejects end <= start', () => {
    const r = validateCreateStream({ ...base, endUnix: base.startUnix })
    expect(r.errors.some((e) => e.field === 'endTime')).toBe(true)
  })

  it('warns (not errors) on a past start time', () => {
    const r = validateCreateStream({ ...base, startUnix: 1_000, endUnix: 2_000, nowUnix: 1_500 })
    expect(r.warnings.some((w) => w.field === 'startTime')).toBe(true)
    expect(r.errors.some((e) => e.field === 'startTime')).toBe(false)
  })

  it('flags insufficient balance', () => {
    const r = validateCreateStream({ ...base, balanceStroops: 1n })
    expect(r.errors.some((e) => e.field === 'amount')).toBe(true)
  })

  it('passes when balance is sufficient', () => {
    const r = validateCreateStream({ ...base, balanceStroops: 1_000_000_000n })
    expect(r.errors).toHaveLength(0)
  })
})

describe('computeRatePerSecond', () => {
  it('mirrors integer division total / duration', () => {
    expect(computeRatePerSecond(1_000_000_000n, 100)).toBe(10_000_000n)
    expect(computeRatePerSecond(1_000n, 3)).toBe(333n)
  })
  it('returns 0 for non-positive duration', () => {
    expect(computeRatePerSecond(1_000n, 0)).toBe(0n)
    expect(computeRatePerSecond(1_000n, -5)).toBe(0n)
  })
})

describe('computeCancelSettlement', () => {
  const total = 1_000_000_000n // 100 tokens @ 7 decimals

  it('returns full refund before start', () => {
    const r = computeCancelSettlement({
      totalAmount: total,
      claimedAmount: 0n,
      startTime: 1000,
      endTime: 2000,
      nowUnix: 500,
    })
    expect(r.claimable).toBe(0n)
    expect(r.refund).toBe(total)
  })

  it('splits exactly at the midpoint', () => {
    const r = computeCancelSettlement({
      totalAmount: total,
      claimedAmount: 0n,
      startTime: 1000,
      endTime: 2000,
      nowUnix: 1500,
    })
    expect(r.claimable).toBe(total / 2n)
    expect(r.refund).toBe(total / 2n)
    // settlement + refund + already-claimed must equal total
    expect(r.claimable + r.refund + 0n).toBe(total)
  })

  it('accounts for already-claimed amounts', () => {
    const claimed = 200_000_000n // 20 tokens already claimed
    const r = computeCancelSettlement({
      totalAmount: total,
      claimedAmount: claimed,
      startTime: 1000,
      endTime: 2000,
      nowUnix: 1500,
    })
    // accrued at midpoint = 50 tokens; claimable = 50 - 20 = 30 tokens
    expect(r.claimable).toBe(300_000_000n)
    expect(r.refund).toBe(total - claimed - r.claimable)
    expect(r.claimable + r.refund + claimed).toBe(total)
  })

  it('caps accrual at the end time (full settlement, no refund)', () => {
    const r = computeCancelSettlement({
      totalAmount: total,
      claimedAmount: 0n,
      startTime: 1000,
      endTime: 2000,
      nowUnix: 5000,
    })
    expect(r.claimable).toBe(total)
    expect(r.refund).toBe(0n)
  })

  it('never lets the three parts exceed the total (invariant)', () => {
    for (const now of [1000, 1100, 1333, 1750, 2000, 9000]) {
      const r = computeCancelSettlement({
        totalAmount: total,
        claimedAmount: 100_000_000n,
        startTime: 1000,
        endTime: 2000,
        nowUnix: now,
      })
      expect(r.claimable + r.refund + 100_000_000n).toBe(total)
      expect(r.claimable >= 0n).toBe(true)
      expect(r.refund >= 0n).toBe(true)
    }
  })
})

describe('error mapper', () => {
  it('maps each known code to a non-empty message', () => {
    for (const code of Object.values(STREAM_ERROR_CODES)) {
      expect(messageForStreamErrorCode(code).length).toBeGreaterThan(0)
    }
  })

  it('maps specific codes to expected wording', () => {
    expect(messageForStreamErrorCode(STREAM_ERROR_CODES.NothingToClaim)).toMatch(/nothing to claim/i)
    expect(messageForStreamErrorCode(STREAM_ERROR_CODES.StreamCompleted)).toMatch(/completed/i)
    expect(messageForStreamErrorCode(STREAM_ERROR_CODES.InvalidRecipient)).toMatch(/recipient/i)
  })

  it('extracts contract error codes from diagnostic strings', () => {
    expect(extractStreamErrorCode('HostError: Error(Contract, #9)')).toBe(9)
    expect(extractStreamErrorCode('ContractError(7)')).toBe(7)
    expect(extractStreamErrorCode(new Error('failed with contract error 8 here'))).toBe(8)
    expect(extractStreamErrorCode('no code here')).toBeNull()
  })

  it('detects user rejection', () => {
    expect(isUserRejection('User declined access')).toBe(true)
    expect(isUserRejection('The user rejected the request')).toBe(true)
    expect(isUserRejection('network timeout')).toBe(false)
  })

  it('produces friendly messages end-to-end', () => {
    expect(toFriendlyError('Error(Contract, #9)')).toMatch(/nothing to claim/i)
    expect(toFriendlyError('User declined')).toMatch(/rejected/i)
    expect(toFriendlyError('account underfunded')).toMatch(/insufficient/i)
  })
})
