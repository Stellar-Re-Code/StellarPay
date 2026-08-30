/**
 * Typed client layer for the `vesting` Soroban contract.
 *
 * Follows the same shape as `payrollContract.ts`: builds invocation
 * transactions, simulates them, optionally signs with Freighter and submits,
 * then polls for inclusion. Read-only queries are answered purely from
 * simulation (no signing/fees).
 *
 * There is no shared invoke/tx-lifecycle module in this codebase yet, so the
 * build/simulate/sign/submit/poll logic below is duplicated from
 * payrollContract.ts rather than extracted — consistent with how that file
 * is itself a self-contained, single-contract client today.
 *
 * scval <-> native mapping:
 *   - Address  -> `new Address(g).toScVal()` / `Address.fromScVal`
 *   - i128     -> bigint   (type: 'i128')
 *   - u64      -> bigint   (type: 'u64')
 *   - u32      -> number   (type: 'u32')
 *   - Symbol   -> string   (type: 'symbol'), e.g. the schedule `label`
 *   - status   -> soroban unit enum (3 variants: Active/Revoked/FullyClaimed)
 */

import {
  Address,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { NETWORK, getVestingContractId, getSorobanServer } from './network'
import { signTransaction } from './wallet'
import type { InvokeHandlers, InvokeResult } from './payrollContract'

export type VestingStatus = 'Active' | 'Revoked' | 'FullyClaimed'

export interface VestingScheduleData {
  id: number
  grantor: string
  beneficiary: string
  token: string
  totalAmount: bigint
  claimedAmount: bigint
  startTime: number
  cliffDuration: number
  cliffAmount: bigint
  totalDuration: number
  label: string
  status: VestingStatus
  revocable: boolean
}

export interface VestingProgressData {
  totalAmount: bigint
  vestedAmount: bigint
  claimedAmount: bigint
  claimableAmount: bigint
  status: VestingStatus
}

export interface SchedulePage {
  scheduleIds: number[]
  nextCursor: number
}

const TX_TIMEOUT_SECONDS = 60
const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 30

function requireVestingContractId(): string {
  const id = getVestingContractId()
  if (!id) {
    throw new Error('Vesting contract id is not configured. Set NEXT_PUBLIC_VESTING_CONTRACT_ID.')
  }
  return id
}

function addressScVal(g: string): xdr.ScVal {
  return new Address(g).toScVal()
}

/** Decode a soroban enum scval-native value into our union type. */
function decodeVestingStatus(value: unknown): VestingStatus {
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
    case 'Revoked':
    case 'FullyClaimed':
      return tag
    default:
      return 'Active'
  }
}

/** Map a decoded VestingSchedule struct (scValToNative output) to our type. */
function decodeSchedule(raw: Record<string, unknown>): VestingScheduleData {
  return {
    id: Number(raw.id),
    grantor: String(raw.grantor),
    beneficiary: String(raw.beneficiary),
    token: String(raw.token),
    totalAmount: BigInt(raw.total_amount as bigint | number | string),
    claimedAmount: BigInt(raw.claimed_amount as bigint | number | string),
    startTime: Number(raw.start_time),
    cliffDuration: Number(raw.cliff_duration),
    cliffAmount: BigInt(raw.cliff_amount as bigint | number | string),
    totalDuration: Number(raw.total_duration),
    label: String(raw.label),
    status: decodeVestingStatus(raw.status),
    revocable: Boolean(raw.revocable),
  }
}

/** Map a decoded VestingProgress struct (scValToNative output) to our type. */
function decodeProgress(raw: Record<string, unknown>): VestingProgressData {
  return {
    totalAmount: BigInt(raw.total_amount as bigint | number | string),
    vestedAmount: BigInt(raw.vested_amount as bigint | number | string),
    claimedAmount: BigInt(raw.claimed_amount as bigint | number | string),
    claimableAmount: BigInt(raw.claimable_amount as bigint | number | string),
    status: decodeVestingStatus(raw.status),
  }
}

async function buildInvocation(
  sourceAccount: string,
  method: string,
  args: xdr.ScVal[],
): Promise<ReturnType<TransactionBuilder['build']>> {
  const server = getSorobanServer()
  const account = await server.getAccount(sourceAccount)
  const contract = new Contract(requireVestingContractId())
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
 */
async function simulateRead<T = unknown>(
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

/**
 * Full state-changing invocation: simulate -> assemble -> sign -> submit ->
 * poll. Each phase fires the matching handler so the UI can render distinct
 * states.
 */
async function invokeContract<T = unknown>(
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

/** create_schedule -> returns the new schedule id (u32). */
export async function createSchedule(
  grantor: string,
  params: {
    beneficiary: string
    token: string
    totalAmount: bigint
    startTime: number
    cliffDuration: number
    cliffAmount: bigint
    totalDuration: number
    label: string
    revocable: boolean
  },
  handlers?: InvokeHandlers,
): Promise<InvokeResult<number>> {
  const args = [
    addressScVal(grantor),
    addressScVal(params.beneficiary),
    addressScVal(params.token),
    nativeToScVal(params.totalAmount, { type: 'i128' }),
    nativeToScVal(BigInt(params.startTime), { type: 'u64' }),
    nativeToScVal(BigInt(params.cliffDuration), { type: 'u64' }),
    nativeToScVal(params.cliffAmount, { type: 'i128' }),
    nativeToScVal(BigInt(params.totalDuration), { type: 'u64' }),
    nativeToScVal(params.label, { type: 'symbol' }),
    nativeToScVal(params.revocable, { type: 'bool' }),
  ]
  const result = await invokeContract<number | bigint>(grantor, 'create_schedule', args, handlers)
  return { hash: result.hash, returnValue: Number(result.returnValue) }
}

/** claim -> returns the amount claimed (i128). */
export async function claim(
  beneficiary: string,
  scheduleId: number,
  handlers?: InvokeHandlers,
): Promise<InvokeResult<bigint>> {
  const args = [addressScVal(beneficiary), nativeToScVal(scheduleId, { type: 'u32' })]
  const result = await invokeContract<bigint>(beneficiary, 'claim', args, handlers)
  return { hash: result.hash, returnValue: BigInt(result.returnValue ?? 0) }
}

/** revoke -> returns the unvested amount returned to the grantor (i128). */
export async function revoke(
  grantor: string,
  scheduleId: number,
  handlers?: InvokeHandlers,
): Promise<InvokeResult<bigint>> {
  const args = [addressScVal(grantor), nativeToScVal(scheduleId, { type: 'u32' })]
  const result = await invokeContract<bigint>(grantor, 'revoke', args, handlers)
  return { hash: result.hash, returnValue: BigInt(result.returnValue ?? 0) }
}

/** get_schedule -> full VestingSchedule. */
export async function getSchedule(
  sourceAccount: string,
  scheduleId: number,
): Promise<VestingScheduleData> {
  const raw = await simulateRead<Record<string, unknown>>(sourceAccount, 'get_schedule', [
    nativeToScVal(scheduleId, { type: 'u32' }),
  ])
  return decodeSchedule(raw)
}

/** get_progress -> VestingProgress. */
export async function getProgress(
  sourceAccount: string,
  scheduleId: number,
): Promise<VestingProgressData> {
  const raw = await simulateRead<Record<string, unknown>>(sourceAccount, 'get_progress', [
    nativeToScVal(scheduleId, { type: 'u32' }),
  ])
  return decodeProgress(raw)
}

function decodeSchedulePage(raw: Record<string, unknown>): SchedulePage {
  return {
    scheduleIds: ((raw.schedule_ids as Array<number | bigint>) ?? []).map((id) => Number(id)),
    nextCursor: Number(raw.next_cursor ?? 0),
  }
}

/** get_schedules_by_grantor_page -> capped page of schedule IDs. */
export async function getSchedulesByGrantorPage(
  sourceAccount: string,
  grantor: string,
  cursor: number,
  limit: number,
): Promise<SchedulePage> {
  const raw = await simulateRead<Record<string, unknown>>(
    sourceAccount,
    'get_schedules_by_grantor_page',
    [addressScVal(grantor), nativeToScVal(cursor, { type: 'u32' }), nativeToScVal(limit, { type: 'u32' })],
  )
  return decodeSchedulePage(raw)
}

/** get_schedules_by_beneficiary_page -> capped page of schedule IDs. */
export async function getSchedulesByBeneficiaryPage(
  sourceAccount: string,
  beneficiary: string,
  cursor: number,
  limit: number,
): Promise<SchedulePage> {
  const raw = await simulateRead<Record<string, unknown>>(
    sourceAccount,
    'get_schedules_by_beneficiary_page',
    [addressScVal(beneficiary), nativeToScVal(cursor, { type: 'u32' }), nativeToScVal(limit, { type: 'u32' })],
  )
  return decodeSchedulePage(raw)
}
