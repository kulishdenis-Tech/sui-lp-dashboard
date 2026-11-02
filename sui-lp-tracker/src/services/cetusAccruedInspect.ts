/**
 * Cetus CLMM unclaimed fees + rewards via devInspect.
 *
 * `fee_owned_a/b` in the PositionInfo dynamic field only holds *materialized*
 * (already-checkpointed) fee tokens. The real unclaimed amount requires computing
 * fee-growth deltas across tick ranges — identical math to Uniswap V3.
 *
 * Cetus exposes two view scripts in its `fetcher_script` module that do this
 * calculation on-chain and emit events with the result:
 *
 *   • `fetch_position_fees`   → `FetchPositionFeesEvent { position_id, fee_owned_a, fee_owned_b }`
 *   • `fetch_position_rewards`→ `FetchPositionRewardsEvent { data: vector<u64>, position_id }`
 *
 * We call both in a single devInspect TX and parse the emitted events.
 *
 * Constants sourced from `@cetusprotocol/sui-clmm-sdk` 1.4.9
 * `CetusClmmSDK.createSDK({ env: 'mainnet' }).sdkOptions`:
 *   integrate.published_at = 0x9ee0534b… (version 17)
 *   clmm_pool.global_config_id = 0xdaa46292…
 *
 * Stale integrate.published_at aborts with checked_package_version (code 10)
 * and drops both fees and rewards from fetch_position_* views.
 */
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag, normalizeSuiAddress, SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cetus integrate package `published_at` (mainnet).
 * Keep in sync with `@cetusprotocol/sui-clmm-sdk` mainnet sdkOptions.integrate.
 */
const CETUS_INTEGRATE_AT =
	'0x9ee0534b703b14457aee7698ea3a07a5080f954ed2b7e9910fbb7a55506824fa' as const

/**
 * Cetus CLMM global config object ID.
 * Passed as first arg to all fetcher_script view functions.
 */
const CETUS_GLOBAL_CONFIG =
	'0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f' as const

const FETCHER_MODULE = 'fetcher_script' as const

const DEVINSPECT_SENDER =
	'0x0000000000000000000000000000000000000000000000000000000000000000' as const

const DEVINSPECT_TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normType(ct: string): string {
	if (!ct) return ''
	try {
		return normalizeStructTag(ct)
	} catch {
		return ct
	}
}

function readU64(v: unknown): string {
	if (typeof v === 'string' && /^\d+$/.test(v)) return v
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return String(Math.trunc(v))
	return '0'
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CetusAccruedResult =
	| {
			ok: true
			/** Raw u64 string: accrued (but unclaimed) token A fees */
			feeOwedA: string
			/** Raw u64 string: accrued (but unclaimed) token B fees */
			feeOwedB: string
			/** Raw u64 strings per rewarder index (may be empty if pool has no rewarders) */
			rewardOweds: string[]
	  }
	| { ok: false; error: string }

export type CetusAccruedInput = {
	positionId: string
	poolId: string
	coinTypeA: string
	coinTypeB: string
	/**
	 * Optional wallet sender — improves reliability on some RPC nodes.
	 * Defaults to zero address (works for most cases).
	 */
	sender?: string
}

// ---------------------------------------------------------------------------
// Core devInspect call
// ---------------------------------------------------------------------------

async function devInspectCetusOnce(
	client: SuiJsonRpcClient,
	input: { positionId: string; poolId: string; coinTypeA: string; coinTypeB: string },
	sender: string,
): Promise<CetusAccruedResult> {
	const tx = new Transaction()
	const cfg = tx.object(CETUS_GLOBAL_CONFIG)
	const pool = tx.object(input.poolId)
	// position_id is passed as `pure.address`, not as an object ref — matches Cetus SDK
	const posRef = tx.pure.address(input.positionId)
	const clock = tx.object(SUI_CLOCK_OBJECT_ID)
	const tA = input.coinTypeA
	const tB = input.coinTypeB

	// move call 1: fetch_position_fees → emits FetchPositionFeesEvent
	tx.moveCall({
		target: `${CETUS_INTEGRATE_AT}::${FETCHER_MODULE}::fetch_position_fees`,
		typeArguments: [tA, tB],
		arguments: [cfg, pool, posRef],
	})

	// move call 2: fetch_position_rewards → emits FetchPositionRewardsEvent
	tx.moveCall({
		target: `${CETUS_INTEGRATE_AT}::${FETCHER_MODULE}::fetch_position_rewards`,
		typeArguments: [tA, tB],
		arguments: [cfg, pool, posRef, clock],
	})

	let res: Awaited<ReturnType<typeof client.devInspectTransactionBlock>>
	try {
		const timeout = new Promise<never>((_, rej) =>
			setTimeout(
				() => rej(new Error(`devInspect timeout after ${DEVINSPECT_TIMEOUT_MS}ms`)),
				DEVINSPECT_TIMEOUT_MS,
			),
		)
		res = await Promise.race([
			client.devInspectTransactionBlock({ transactionBlock: tx, sender }),
			timeout,
		])
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}

	if (res.error) return { ok: false, error: String(res.error) }

	// Parse emitted events — Cetus view scripts emit events, not return values
	const events = Array.isArray(res.events) ? res.events : []

	let feeOwedA = '0'
	let feeOwedB = '0'
	let rewardOweds: string[] = []
	let feeEventFound = false

	for (const ev of events) {
		const evObj = ev as Record<string, unknown>
		const type = typeof evObj.type === 'string' ? evObj.type : ''
		const pj =
			evObj.parsedJson && typeof evObj.parsedJson === 'object'
				? (evObj.parsedJson as Record<string, unknown>)
				: null
		if (!pj) continue

		if (type.includes('FetchPositionFeesEvent')) {
			feeOwedA = readU64(pj.fee_owned_a)
			feeOwedB = readU64(pj.fee_owned_b)
			feeEventFound = true
		} else if (type.includes('FetchPositionRewardsEvent')) {
			const data = Array.isArray(pj.data) ? (pj.data as unknown[]) : []
			rewardOweds = data.map(readU64)
		}
	}

	if (!feeEventFound) {
		return {
			ok: false,
			error: `FetchPositionFeesEvent not found in devInspect events (total events: ${events.length})`,
		}
	}

	return { ok: true, feeOwedA, feeOwedB, rewardOweds }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Fetch real-time unclaimed fees + rewards for a Cetus CLMM position
 * via `devInspect` → `fetcher_script::fetch_position_fees/rewards`.
 *
 * Retries with zero sender if wallet sender fails.
 */
export async function fetchCetusAccruedFees(
	client: SuiJsonRpcClient,
	input: CetusAccruedInput,
): Promise<CetusAccruedResult> {
	const tA = normType(input.coinTypeA)
	const tB = normType(input.coinTypeB)
	if (!tA || !tB) {
		return { ok: false, error: 'Missing coin type args' }
	}

	let walletSender: string = DEVINSPECT_SENDER
	if (input.sender) {
		try {
			walletSender = normalizeSuiAddress(input.sender)
		} catch {
			walletSender = DEVINSPECT_SENDER
		}
	}

	const core = {
		positionId: input.positionId,
		poolId: input.poolId,
		coinTypeA: tA,
		coinTypeB: tB,
	}

	// Try wallet sender first, fall back to zero address
	const attempts = [walletSender]
	if (walletSender !== DEVINSPECT_SENDER) attempts.push(DEVINSPECT_SENDER)

	let lastErr = 'all devInspect attempts failed'
	for (const sender of attempts) {
		const r = await devInspectCetusOnce(client, core, sender)
		if (r.ok) return r
		lastErr = r.error
	}
	return { ok: false, error: lastErr }
}
