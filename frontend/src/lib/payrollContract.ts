/**
 * Typed client layer for the `payroll_stream` Soroban contract.
 *
 * Wraps @stellar/stellar-sdk v12: builds invocation transactions, simulates
 * them, optionally signs with Freighter and submits, then polls for inclusion.
 * Read-only queries are answered purely from simulation (no signing/fees).
 *
 * scval <-> native mapping is handled explicitly:
 *   - Address  -> `new Address(g).toScVal()` / `Address.fromScVal`
 *   - i128     -> bigint   (type: 'i128')
 *   - u64      -> bigint   (type: 'u64')
 *   - u32      -> number   (type: 'u32')
 *   - status   -> soroban unit enum, decoded by `scValToNative` to ["Active"]
 */

import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { NETWORK, getPayrollStreamContractId, getSorobanServer } from './network'
import { signTransaction } from './wallet'

export type StreamStatus = 'Active' | 'Paused' | 'Cancelled' | 'Completed'

export interface PayrollStreamData {
  id: number
  sender: string
  recipient: string
  token: string
  totalAmount: bigint
  claimedAmount: bigint
  startTime: number
  endTime: number
  lastClaimTime: number
  status: StreamStatus
  ratePerSecond: bigint
}

export interface StreamPage {
  streamIds: number[]
  nextCursor: number
}

const TX_TIMEOUT_SECONDS = 60
const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 30

/** Lifecycle callbacks so callers (the hook) can drive a tx state machine. */
export interface InvokeHandlers {
  onSimulating?: () => void
  onAwaitingSignature?: () => void
  onSubmitting?: () => void
  onConfirming?: (hash: string) => void
}

function requireContractId(): string {
  const id = getPayrollStreamContractId()
  if (!id) {
    throw new Error(
      'Payroll contract id is not configured. Set NEXT_PUBLIC_PAYROLL_STREAM_CONTRACT_ID.',
    )
  }
  return id
}

function addressScVal(g: string): xdr.ScVal {
  return new Address(g).toScVal()
}

/** Decode a soroban enum scval-native value into our union type. */
function decodeStatus(value: unknown): StreamStatus {
  let tag: string | undefined
  if (Array.isArray(value)) {
    tag = String(value[0])
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    tag = typeof obj.tag === 'string' ? obj.tag : undefined
  } else if (typeof value === 'string') {
    tag = value
  }
  switch (tag) {
    case 'Active':
    case 'Paused':
    case 'Cancelled':
    case 'Completed':
      return tag
    default:
      return 'Active'
  }
}

/** Map a decoded PayrollStream struct (scValToNative output) to our type. */
function decodeStream(raw: Record<string, unknown>): PayrollStreamData {
  return {
    id: Number(raw.id),
    sender: String(raw.sender),
    recipient: String(raw.recipient),
    token: String(raw.token),
    totalAmount: BigInt(raw.total_amount as bigint | number | string),
    claimedAmount: BigInt(raw.claimed_amount as bigint | number | string),
    startTime: Number(raw.start_time),
    endTime: Number(raw.end_time),
    lastClaimTime: Number(raw.last_claim_time),
    status: decodeStatus(raw.status),
    ratePerSecond: BigInt(raw.rate_per_second as bigint | number | string),
  }
}

async function buildInvocation(
  sourceAccount: string,
  method: string,
  args: xdr.ScVal[],
): Promise<ReturnType<TransactionBuilder['build']>> {
  const server = getSorobanServer()
  const account = await server.getAccount(sourceAccount)
  const contract = new Contract(requireContractId())
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build()
}

/**
 * Read-only contract call. Simulates the invocation and returns the decoded
 * return value. Never signs, submits, or costs fees.
 *
 * Requires a `sourceAccount` only to construct a valid transaction envelope;
 * for queries this can be any funded/valid account (we use the caller's).
 */
export async function simulateRead<T = unknown>(
  sourceAccount: string,
  method: string,
  args: xdr.ScVal[],
): Promise<T> {
  const tx = await buildInvocation(sourceAccount, method, args)
  const server = getSorobanServer()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error)
  }
  const retval = sim.result?.retval
  if (!retval) {
    return undefined as T
  }
  return scValToNative(retval) as T
}

export interface InvokeResult<T = unknown> {
  hash: string
  returnValue: T
}

/**
 * Full state-changing invocation: simulate -> assemble -> sign -> submit ->
 * poll. Each phase fires the matching handler so the UI can render distinct
 * states. Throws on simulation/submission/contract failure (callers map to a
 * friendly message); a thrown error here means no success should be shown.
 */
export async function invokeContract<T = unknown>(
  sourceAccount: string,
  method: string,
  args: xdr.ScVal[],
  handlers: InvokeHandlers = {},
): Promise<InvokeResult<T>> {
  const server = getSorobanServer()
  const tx = await buildInvocation(sourceAccount, method, args)

  handlers.onSimulating?.()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error)
  }
  // Assemble the transaction with simulation results (sets soroban data + fee).
  const prepared = rpc.assembleTransaction(tx, sim).build()

  handlers.onAwaitingSignature?.()
  const signedXdr = await signTransaction(prepared.toXDR(), NETWORK.networkPassphrase)
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK.networkPassphrase)

  handlers.onSubmitting?.()
  const sendResponse = await server.sendTransaction(signedTx)
  if (sendResponse.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${JSON.stringify(sendResponse.errorResult ?? sendResponse)}`,
    )
  }

  const hash = sendResponse.hash
  handlers.onConfirming?.(hash)

  // Poll until the transaction is included or fails.
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS) {
    const result = await server.getTransaction(hash)
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      let returnValue: T = undefined as T
      if (result.returnValue) {
        returnValue = scValToNative(result.returnValue) as T
      }
      return { hash, returnValue }
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(
        `Transaction failed on-chain (hash ${hash}): ${JSON.stringify(
          result.resultXdr ?? 'unknown',
        )}`,
      )
    }
    await delay(POLL_INTERVAL_MS)
    attempts += 1
  }
  throw new Error(
    `Transaction ${hash} did not confirm within the expected time. ` +
      'It may still complete — check the explorer before retrying.',
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Typed contract methods ──────────────────────────────────────────────

/** create_stream -> returns the new stream id (u32). */
export async function createStream(
  sender: string,
  params: {
    recipient: string
    token: string
    totalAmount: bigint
    startTime: number
    endTime: number
  },
  handlers?: InvokeHandlers,
): Promise<InvokeResult<number>> {
  const args = [
    addressScVal(sender),
    addressScVal(params.recipient),
    addressScVal(params.token),
    nativeToScVal(params.totalAmount, { type: 'i128' }),
    nativeToScVal(BigInt(params.startTime), { type: 'u64' }),
    nativeToScVal(BigInt(params.endTime), { type: 'u64' }),
  ]
  const result = await invokeContract<number | bigint>(sender, 'create_stream', args, handlers)
  return { hash: result.hash, returnValue: Number(result.returnValue) }
}

/** claim -> returns the amount claimed (i128). */
export async function claim(
  recipient: string,
  streamId: number,
  handlers?: InvokeHandlers,
): Promise<InvokeResult<bigint>> {
  const args = [addressScVal(recipient), nativeToScVal(streamId, { type: 'u32' })]
  const result = await invokeContract<bigint>(recipient, 'claim', args, handlers)
  return { hash: result.hash, returnValue: BigInt(result.returnValue ?? 0) }
}

/** cancel_stream -> void (settlement + refund happen on-chain). */
export async function cancelStream(
  sender: string,
  streamId: number,
  handlers?: InvokeHandlers,
): Promise<InvokeResult<void>> {
  const args = [addressScVal(sender), nativeToScVal(streamId, { type: 'u32' })]
  return invokeContract<void>(sender, 'cancel_stream', args, handlers)
}

/** get_stream -> full PayrollStream. */
export async function getStream(
  sourceAccount: string,
  streamId: number,
): Promise<PayrollStreamData> {
  const raw = await simulateRead<Record<string, unknown>>(sourceAccount, 'get_stream', [
    nativeToScVal(streamId, { type: 'u32' }),
  ])
  return decodeStream(raw)
}

/** get_claimable -> i128. */
export async function getClaimable(sourceAccount: string, streamId: number): Promise<bigint> {
  const raw = await simulateRead<bigint | number>(sourceAccount, 'get_claimable', [
    nativeToScVal(streamId, { type: 'u32' }),
  ])
  return BigInt(raw ?? 0)
}

function decodeStreamPage(raw: Record<string, unknown>): StreamPage {
  return {
    streamIds: ((raw.stream_ids as Array<number | bigint>) ?? []).map((id) => Number(id)),
    nextCursor: Number(raw.next_cursor ?? 0),
  }
}

/** get_streams_by_sender_page -> capped page of stream IDs. */
export async function getStreamsBySenderPage(
  sourceAccount: string,
  sender: string,
  cursor: number,
  limit: number,
): Promise<StreamPage> {
  const raw = await simulateRead<Record<string, unknown>>(sourceAccount, 'get_streams_by_sender_page', [
    addressScVal(sender),
    nativeToScVal(cursor, { type: 'u32' }),
    nativeToScVal(limit, { type: 'u32' }),
  ])
  return decodeStreamPage(raw)
}

/** get_streams_by_recipient_page -> capped page of stream IDs. */
export async function getStreamsByRecipientPage(
  sourceAccount: string,
  recipient: string,
  cursor: number,
  limit: number,
): Promise<StreamPage> {
  const raw = await simulateRead<Record<string, unknown>>(
    sourceAccount,
    'get_streams_by_recipient_page',
    [addressScVal(recipient), nativeToScVal(cursor, { type: 'u32' }), nativeToScVal(limit, { type: 'u32' })],
  )
  return decodeStreamPage(raw)
}

/** Re-export for convenience where the testnet passphrase is needed. */
export const TESTNET_PASSPHRASE = Networks.TESTNET
