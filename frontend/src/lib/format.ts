/**
 * BigInt-safe formatting helpers for Stellar token amounts.
 *
 * Token amounts on Stellar/Soroban are integers expressed in "stroops" — the
 * smallest indivisible unit. With 7 decimals (the Stellar default) 1 token =
 * 10_000_000 stroops. We NEVER use floating-point math on amounts: all
 * conversions go through BigInt. Display strings are produced by manual digit
 * manipulation so we never lose precision.
 */

/** Default number of decimals for Stellar classic assets / SAC tokens. */
export const STELLAR_DECIMALS = 7

/**
 * Convert a human-entered decimal string (e.g. "12.5") into stroops (BigInt)
 * for the given number of decimals. Throws on malformed input or excess
 * precision so callers can surface a validation error before signing.
 */
export function toStroops(decimalStr: string, decimals = STELLAR_DECIMALS): bigint {
  const trimmed = decimalStr.trim()
  if (trimmed === '') {
    throw new Error('Amount is required')
  }

  // Allow an optional leading sign, digits, optional single decimal point.
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed)
  if (!match) {
    throw new Error('Invalid amount format')
  }

  const sign = match[1] === '-' ? -1n : 1n
  const whole = match[2] ?? ''
  const frac = match[3] ?? ''

  if (whole === '' && frac === '') {
    throw new Error('Invalid amount format')
  }
  if (frac.length > decimals) {
    throw new Error(`Too many decimal places (max ${decimals})`)
  }

  const paddedFrac = frac.padEnd(decimals, '0')
  const combined = `${whole === '' ? '0' : whole}${paddedFrac}`
  // Strip any leading zeros to keep BigInt() happy, but keep at least one digit.
  const normalized = combined.replace(/^0+(?=\d)/, '')
  return sign * BigInt(normalized)
}

/**
 * Convert a stroops BigInt into a plain decimal string, trimming trailing
 * zeros in the fractional part. Pure string math — no Number() involved.
 */
export function fromStroops(stroops: bigint, decimals = STELLAR_DECIMALS): string {
  const negative = stroops < 0n
  const abs = negative ? -stroops : stroops
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = abs % base

  let result: string
  if (decimals === 0) {
    result = whole.toString()
  } else {
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
    result = fracStr === '' ? whole.toString() : `${whole.toString()}.${fracStr}`
  }
  return negative ? `-${result}` : result
}

/**
 * Format a stroops amount for display, optionally with thousands separators
 * and a token symbol suffix.
 */
export function formatAmount(
  stroops: bigint,
  decimals = STELLAR_DECIMALS,
  options: { symbol?: string; grouping?: boolean } = {},
): string {
  const { symbol, grouping = true } = options
  const raw = fromStroops(stroops, decimals)
  let display = raw
  if (grouping) {
    const negative = raw.startsWith('-')
    const unsigned = negative ? raw.slice(1) : raw
    const [whole, frac] = unsigned.split('.')
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    display = `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
  }
  return symbol ? `${display} ${symbol}` : display
}

/** Truncate a Stellar address to the form `GABC…WXYZ`. */
export function truncateAddress(address: string, head = 4, tail = 4): string {
  if (!address) return ''
  if (address.length <= head + tail + 1) return address
  return `${address.slice(0, head)}…${address.slice(-tail)}`
}

const EXPLORER_BASE = 'https://stellar.expert/explorer/testnet'

/** Build a stellar.expert (testnet) explorer URL for a transaction hash. */
export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`
}

/** Build a stellar.expert (testnet) explorer URL for an account. */
export function explorerAccountUrl(address: string): string {
  return `${EXPLORER_BASE}/account/${address}`
}

/** Build a stellar.expert (testnet) explorer URL for a contract / asset. */
export function explorerContractUrl(contractId: string): string {
  return `${EXPLORER_BASE}/contract/${contractId}`
}

/**
 * Convert a unix timestamp (seconds) into the value expected by an
 * `<input type="datetime-local">` (local time, no seconds/zone suffix).
 */
export function unixToDatetimeLocal(unixSeconds: number | bigint): string {
  const ms = Number(unixSeconds) * 1000
  const d = new Date(ms)
  // Adjust to local time then format as YYYY-MM-DDTHH:mm.
  const pad = (n: number) => n.toString().padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/**
 * Convert a `datetime-local` input value into a unix timestamp (seconds).
 * Returns NaN for empty/invalid input so callers can validate.
 */
export function datetimeLocalToUnix(value: string): number {
  if (!value) return NaN
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms)) return NaN
  return Math.floor(ms / 1000)
}

/** Format a duration given in seconds as a compact human string. */
export function formatDuration(seconds: number | bigint): string {
  let total = Number(seconds)
  if (!Number.isFinite(total) || total < 0) return '—'
  const days = Math.floor(total / 86400)
  total -= days * 86400
  const hours = Math.floor(total / 3600)
  total -= hours * 3600
  const minutes = Math.floor(total / 60)
  const secs = total - minutes * 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (secs && parts.length === 0) parts.push(`${secs}s`)
  return parts.length ? parts.join(' ') : '0s'
}

/**
 * Format a per-second streaming rate (stroops/sec) into a friendly
 * "per day" string, since per-second figures are tiny and hard to read.
 */
export function formatRatePerSecond(
  ratePerSecond: bigint,
  decimals = STELLAR_DECIMALS,
  symbol?: string,
): string {
  const perDay = ratePerSecond * 86400n
  return `${formatAmount(perDay, decimals, { symbol })} / day`
}

/** Format a unix timestamp (seconds) as a readable local date-time string. */
export function formatTimestamp(unixSeconds: number | bigint): string {
  const ms = Number(unixSeconds) * 1000
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
