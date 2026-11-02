import BN from 'bn.js'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import {
	ClmmPoolUtil,
	Percentage,
	TickMath,
	adjustForCoinSlippage,
} from '@cetusprotocol/common-sdk'
import {
	clmmAllowsOneSidedBuy,
	clmmAllowsOneSidedSell,
	type StrategySlot,
} from '@autopilot/engine'
import { assertOneSidedDeposit } from './binGuard.js'
import {
	bluefinPackageAllowed,
	verifyBluefinUnsignedTx,
	type BluefinManageKind,
} from './bluefinTxPolicy.js'
import { assertBluefinPoolAllowed } from './bluefinWhitelist.js'
import { BLUEFIN_SPOT_MAINNET } from './bluefinConfig.js'
import {
	bluefinTicksFromUsdcPerSuiRange,
	bluefinTickToUsdcPerSui,
} from './bluefinTicks.js'
import { isSui, isSuiUsdcPair, isUsdc, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'
import { parseMoveCoinType, resolveCoinDecimals } from './coinTypeParse.js'
import { fetchBluefinPool, fetchBluefinPosition } from './bluefinPoolFetch.js'
import { createBluefinOnChainCalls, getBluefinSuiClient } from './sdkBluefin.js'
import { buildFillPreview, plannedOpenAverageUsdcPerSui, type FillPreview } from './conversionPreview.js'
import type { GasPreview, BalancePreview, UnsignedTx } from './buildTx.js'
import {
	interpretSim,
	interpretSimTransportError,
	logSimDiagnostics,
	SIMULATE_INCLUDE,
} from './simResult.js'
import type { MoveCallPreview } from './txPolicy.js'

/**
 * Unsigned Bluefin Spot open — official path:
 * TickMath + ClmmPoolUtil.estLiquidity… + OnChainCalls.openPositionWithFixedAmount(returnTx).
 * @see https://bluefin-exchange.readme.io/v2.0.1/reference/spot-api-sdk-openposition-with-fixed-amount
 */
const NOTE =
	'Unsigned Bluefin Spot transaction bytes. dryRunOk is a simulation result, not an execution. Sign in the OWNER wallet. This service has no private key and will not submit.'

const SLIPPAGE = 0.01

function humanToRaw(amount: number, decimals: number): string {
	if (!(amount > 0)) throw new Error('amount must be > 0')
	const [whole, frac = ''] = amount.toFixed(decimals).split('.')
	const digits = `${whole}${frac.padEnd(decimals, '0').slice(0, decimals)}`.replace(/^0+(?=\d)/, '')
	return BigInt(digits || '0').toString()
}

function assertOwner(owner: string): void {
	if (!/^0x[0-9a-fA-F]{64}$/.test(owner)) throw new Error('owner must be a 32-byte Sui address, not a key')
}

function assertBluefinPackagesOnAllowlist(): void {
	for (const id of [BLUEFIN_SPOT_MAINNET.BasePackage, BLUEFIN_SPOT_MAINNET.CurrentPackage]) {
		if (!bluefinPackageAllowed(id)) throw new Error(`Bluefin package ${id} is not in the manual-sign allowlist`)
	}
}

export { bluefinTicksFromUsdcPerSuiRange } from './bluefinTicks.js'

function assertBluefinHardLimit(
	slot: StrategySlot,
	tickLower: number,
	tickUpper: number,
	coinTypeA: string,
	decimalsA: number,
	decimalsB: number,
	hardPrice: number,
): void {
	const prices = [
		bluefinTickToUsdcPerSui(tickLower, coinTypeA, decimalsA, decimalsB),
		bluefinTickToUsdcPerSui(tickUpper, coinTypeA, decimalsA, decimalsB),
	]
	if (!Number.isFinite(hardPrice) || !(hardPrice > 0)) {
		throw new Error(`hardPrice must be finite > 0 (got ${String(hardPrice)})`)
	}
	for (const px of prices) {
		if (!(px > 0) || !Number.isFinite(px)) throw new Error('tick price is not finite')
		if (slot === 'BUY' && px > hardPrice + 1e-12) {
			throw new Error(`BUY tick price ${px} exceeds HARD_MAX ${hardPrice}`)
		}
		if (slot === 'SELL' && px < hardPrice - 1e-12) {
			throw new Error(`SELL tick price ${px} below HARD_MIN ${hardPrice}`)
		}
	}
}

const SUI_CLOCK_OBJECT_ID = '0x6'

function normCoinType(ct: string): string {
	return ct.replace(/^0x0+/, '0x').toLowerCase()
}

/**
 * Liquidity delta for Bluefin remove — basis points of full liquidity.
 * Rounds toward zero; callers must reject delta === 0n.
 */
export function bluefinRemoveLiquidityDelta(fullLiq: bigint, removePercent: number): bigint {
	if (fullLiq <= 0n) throw new Error('position has zero liquidity')
	if (!(removePercent > 0) || removePercent > 1) throw new Error('removePercent must be in (0, 1]')
	return (fullLiq * BigInt(Math.round(removePercent * 10_000))) / 10_000n
}

async function sealBluefin(
	tx: Transaction,
	owner: string,
	kind: UnsignedTx['kind'],
	extra: {
		slot: StrategySlot | null
		activeBinNote: string | null
		expectedAverageUsdcPerSui?: number | null
		/** Action-specific policy (principal-only remove, etc.). */
		policyKind?: BluefinManageKind
		poolId?: string
		positionId?: string
	},
): Promise<UnsignedTx> {
	assertOwner(owner)
	assertBluefinPackagesOnAllowlist()
	tx.setSender(owner)
	const client = getBluefinSuiClient()
	const bytes = await tx.build({ client: client as never })
	const txBytesBase64 = toBase64(bytes)
	const policyOpts = {
		kind: extra.policyKind,
		poolId: extra.poolId,
		positionId: extra.positionId,
	}
	const report = await verifyBluefinUnsignedTx(txBytesBase64, owner, policyOpts)
	let dryRunOk = false
	let dryRunError: string | null = null
	let gas: GasPreview | null = null
	let balanceChanges: BalancePreview[] = []
	try {
		// Simulate the exact BCS bytes returned for signing (rebuild from base64).
		// include.effects / balanceChanges are required — without them Mysten leaves gas undefined.
		const sim = await client.core.simulateTransaction({
			transaction: Transaction.from(txBytesBase64),
			include: { ...SIMULATE_INCLUDE },
		})
		const parsed = interpretSim(sim)
		logSimDiagnostics(parsed, {
			method: 'core.simulateTransaction',
			protocol: 'bluefin',
			kind,
		})
		dryRunOk = parsed.ok
		dryRunError = parsed.error
		gas = parsed.gas
		balanceChanges = parsed.balanceChanges
	} catch (e) {
		const parsed = interpretSimTransportError(e)
		logSimDiagnostics(parsed, {
			method: 'core.simulateTransaction',
			protocol: 'bluefin',
			kind,
		})
		dryRunOk = false
		dryRunError = parsed.error
	}
	const again = await verifyBluefinUnsignedTx(txBytesBase64, owner, policyOpts)
	if (again.payloadSha256 !== report.payloadSha256) throw new Error('payload changed after the dry-run check')
	const fill: FillPreview = buildFillPreview({
		slot: extra.slot,
		kind,
		gas,
		balanceChanges,
		bins: [],
		expectedAverageUsdcPerSui: extra.expectedAverageUsdcPerSui ?? null,
	})
	return {
		kind,
		slot: extra.slot,
		txBytesBase64,
		payloadSha256: report.payloadSha256,
		moveCalls: report.moveCalls as MoveCallPreview[],
		recipients: report.recipients,
		gas,
		balanceChanges,
		policyOk: true,
		dryRunOk,
		dryRunError,
		binsChecked: [],
		activeBinNote: extra.activeBinNote,
		fill,
		note: NOTE,
	}
}

export type BluefinOpenLeg = {
	id?: string
	lowerPrice: number
	upperPrice: number
	budgetHuman: number
}

/**
 * One or more Bluefin Spot opens in a single PTB → one OWNER signature.
 * Chains `openPositionWithFixedAmount(..., { returnTx: true, txb })`.
 */
export async function buildBluefinOpenTx(input: {
	owner: string
	poolId: string
	slot: StrategySlot
	hardPrice: number
	lowerPrice?: number
	upperPrice?: number
	budgetHuman?: number
	legs?: BluefinOpenLeg[]
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	assertBluefinPoolAllowed(input.poolId)
	const legs: BluefinOpenLeg[] =
		input.legs && input.legs.length > 0
			? input.legs
			: [
					{
						lowerPrice: Number(input.lowerPrice),
						upperPrice: Number(input.upperPrice),
						budgetHuman: Number(input.budgetHuman),
					},
				]
	if (legs.length > 20) throw new Error('cascade open supports at most 20 LPs in one PTB')

	const pool = await fetchBluefinPool(input.poolId)
	const coinTypeA = pool.coin_a.address
	const coinTypeB = pool.coin_b.address
	if (!isSuiUsdcPair(coinTypeA, coinTypeB)) {
		throw new Error(`pool ${input.poolId} is not a SUI/USDC Bluefin pair`)
	}
	const decimalsA = Number(pool.coin_a.decimals)
	const decimalsB = Number(pool.coin_b.decimals)
	const tickSpacing = Number(pool.ticks_manager.tick_spacing)
	const spot = bluefinTickToUsdcPerSui(Number(pool.current_tick), coinTypeA, decimalsA, decimalsB)
	const spendSui = input.slot === 'SELL'
	const fixAmountA = isSui(coinTypeA) ? spendSui : !spendSui
	const decimals = spendSui ? SUI_DECIMALS : USDC_DECIMALS
	const curSqrt = new BN(pool.current_sqrt_price)

	const oc = createBluefinOnChainCalls(input.owner)
	let txb: Transaction | undefined
	const tickNotes: string[] = []

	for (const [i, leg] of legs.entries()) {
		const { tickLower, tickUpper } = bluefinTicksFromUsdcPerSuiRange(
			leg.lowerPrice,
			leg.upperPrice,
			coinTypeA,
			decimalsA,
			decimalsB,
			tickSpacing,
		)
		assertBluefinHardLimit(
			input.slot,
			tickLower,
			tickUpper,
			coinTypeA,
			decimalsA,
			decimalsB,
			input.hardPrice,
		)
		const upperPx = bluefinTickToUsdcPerSui(tickUpper, coinTypeA, decimalsA, decimalsB)
		const lowerPx = bluefinTickToUsdcPerSui(tickLower, coinTypeA, decimalsA, decimalsB)
		if (input.slot === 'BUY' && !clmmAllowsOneSidedBuy(spot, Math.max(lowerPx, upperPx))) {
			throw new Error(
				`${leg.id ?? `LP${i + 1}`}: BUY one-sided USDC requires spot above the upper tick price`,
			)
		}
		if (input.slot === 'SELL' && !clmmAllowsOneSidedSell(spot, Math.min(lowerPx, upperPx))) {
			throw new Error(
				`${leg.id ?? `LP${i + 1}`}: SELL one-sided SUI requires spot below the lower tick price`,
			)
		}
		const coinAmount = new BN(humanToRaw(leg.budgetHuman, decimals))
		// Cetus common-sdk math (same Q64.64 family); map into Bluefin Spot LiquidityInput shape.
		// @see https://bluefin-exchange.readme.io/v2.0.1/reference/spot-api-sdk-openposition-with-fixed-amount
		const est = ClmmPoolUtil.estLiquidityAndCoinAmountFromOneAmounts(
			tickLower,
			tickUpper,
			coinAmount,
			fixAmountA,
			true,
			SLIPPAGE,
			curSqrt,
		)
		const tokenMaxA = new BN(String(est.coin_amount_limit_a))
		const tokenMaxB = new BN(String(est.coin_amount_limit_b))
		const liq = new BN(String(est.liquidity_amount))
		const liquidityInput = {
			coinAmount,
			coinAmountA: fixAmountA ? coinAmount : tokenMaxA,
			coinAmountB: fixAmountA ? tokenMaxB : coinAmount,
			tokenMaxA,
			tokenMaxB,
			liquidityAmount: liq,
			fix_amount_a: fixAmountA,
		}
		const amountA = fixAmountA ? coinAmount : tokenMaxA
		const amountB = fixAmountA ? tokenMaxB : coinAmount
		const depositSui = BigInt(isSui(coinTypeA) ? amountA.toString() : amountB.toString())
		const depositUsdc = BigInt(isSui(coinTypeA) ? amountB.toString() : amountA.toString())
		assertOneSidedDeposit(input.slot, depositSui, depositUsdc)

		const built = await oc.openPositionWithFixedAmount(pool, tickLower, tickUpper, liquidityInput, {
			txb,
			returnTx: true,
			sender: input.owner,
		})
		if (!built || typeof built !== 'object' || !('setSender' in built)) {
			throw new Error('openPositionWithFixedAmount did not return a Transaction (returnTx)')
		}
		txb = built as Transaction
		tickNotes.push(`${leg.id ?? `LP${i + 1}`}:${tickLower}…${tickUpper}`)
	}
	if (!txb) throw new Error('no Bluefin open legs')
	return sealBluefin(txb, input.owner, 'open', {
		slot: input.slot,
		policyKind: 'open',
		poolId: input.poolId,
		activeBinNote:
			legs.length === 1
				? `Bluefin ticks ${tickNotes[0]} (spacing ${tickSpacing})`
				: `Bluefin cascade ${legs.length} LP in one PTB · ${tickNotes.join(' · ')}`,
		expectedAverageUsdcPerSui: plannedOpenAverageUsdcPerSui(input.slot, legs, { protocol: 'bluefin' }),
	})
}

/**
 * Close Bluefin Spot position — SDK `closePosition` (rewards + fees + full liquidity, burns NFT).
 * @see https://bluefin-exchange.readme.io/v2.0.1/reference/spot-api-sdk-closeposition
 */
export async function buildBluefinCloseTx(input: {
	owner: string
	poolId: string
	positionId: string
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	assertBluefinPoolAllowed(input.poolId)
	const pool = await fetchBluefinPool(input.poolId)
	const oc = createBluefinOnChainCalls(input.owner)
	const built = await oc.closePosition(pool, input.positionId, {
		returnTx: true,
		sender: input.owner,
		transferCoinsTo: input.owner,
	})
	if (!built || typeof built !== 'object' || !('setSender' in built)) {
		throw new Error('closePosition did not return a Transaction (returnTx)')
	}
	return sealBluefin(built as Transaction, input.owner, 'close', {
		slot: null,
		policyKind: 'close',
		poolId: input.poolId,
		positionId: input.positionId,
		activeBinNote:
			'Bluefin close withdraws liquidity, fees and rewards, then deletes the position. One OWNER signature.',
	})
}

/** Bluefin “BLUE” points coin — SDK skips claiming (cannot transfer to users). */
const BLUEFIN_BLUE_COIN =
	'0xdd5c4badc89f08fb2ff3c1827411c9bafbed54c64c17d8ab969f637364ca8b4f::blue::BLUE'

function isBluefinNonClaimableReward(coinType: string): boolean {
	const n = normCoinType(coinType)
	if (n === normCoinType(BLUEFIN_BLUE_COIN)) return true
	const leaf = coinType.split('::').pop()?.toUpperCase()
	return leaf === 'BPOINT' || leaf === 'BLUE'
}

/**
 * Collect Bluefin fees + claimable rewards via SDK `collectFeeAndRewards`.
 *
 * Spot SDK `getRewardCoinsInPool` does `normalizeObjectId(reward_coin_type)` and throws
 * when gRPC returns a TypeName object (common on non–SUI/USDC pools) — aborting fees too.
 * We override that helper with types parsed from `fetchBluefinPool` (string TypeNames).
 *
 * @see https://bluefin-exchange.readme.io/v2.0.1/reference/spot-api-sdk-collectfees-and-rewards
 * @see https://github.com/fireflyprotocol/bluefin-spot-contract-interface/blob/main/sources/gateway.move
 */
export async function buildBluefinCollectFeeTx(input: {
	owner: string
	poolId: string
	positionId: string
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	assertBluefinPoolAllowed(input.poolId)
	const pool = await fetchBluefinPool(input.poolId)
	const rewardCoins = (pool.rewardsInfo ?? [])
		.map((r) => {
			const coinType =
				parseMoveCoinType(r.reward_coin_type) ??
				(typeof r.reward_coin_type === 'string' && r.reward_coin_type.includes('::')
					? r.reward_coin_type
					: '')
			return {
				coinType,
				coinSymbol: String(r.reward_coin_symbol ?? ''),
				coinDecimals: Number(r.reward_coin_decimals ?? 0),
			}
		})
		.filter((r) => r.coinType.includes('::') && !isBluefinNonClaimableReward(r.coinType))

	const oc = createBluefinOnChainCalls(input.owner)
	// Bypass broken TypeName → normalizeObjectId path in the Spot SDK.
	oc.getRewardCoinsInPool = async () => rewardCoins

	const built = await oc.collectFeeAndRewards(pool, input.positionId, {
		returnTx: true,
		sender: input.owner,
	})
	if (!built || typeof built !== 'object' || !('setSender' in built)) {
		throw new Error('collectFeeAndRewards did not return a Transaction (returnTx)')
	}
	return sealBluefin(built as Transaction, input.owner, 'collect_fee', {
		slot: null,
		policyKind: 'collect_fee',
		poolId: input.poolId,
		positionId: input.positionId,
		activeBinNote: 'Bluefin collect fees + rewards. Position stays open.',
	})
}

/**
 * Add liquidity into an **existing** Bluefin Spot position (same NFT / range).
 * Uses SDK `provideLiquidityWithFixedAmount` → `gateway::provide_liquidity_with_fixed_amount`
 * (no collect, no new position, no swap).
 *
 * @see https://github.com/fireflyprotocol/bluefin-spot-contract-interface/blob/main/sources/gateway.move
 */
export async function buildBluefinAddTx(input: {
	owner: string
	poolId: string
	positionId: string
	amountHuman: number
	fixSide: 'A' | 'B' | string
	poolFixSide?: 'A' | 'B' | string
	slippage?: number
	/** Optional decimals by coin type (from dashboard positionHint) when metadata is missing. */
	coinDecimals?: Record<string, number>
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	assertBluefinPoolAllowed(input.poolId)
	if (!(input.amountHuman > 0) || !Number.isFinite(input.amountHuman)) {
		throw new Error('amountHuman must be a finite number > 0')
	}
	const slip = input.slippage ?? SLIPPAGE
	if (!(slip >= 0) || slip > 0.5) throw new Error('slippage must be in [0, 0.5]')

	const pool = await fetchBluefinPool(input.poolId)
	const pos = await fetchBluefinPosition(input.positionId)
	if (pos.pool_id.toLowerCase() !== input.poolId.toLowerCase()) {
		throw new Error(
			`Bluefin position ${input.positionId} belongs to pool ${pos.pool_id}, not ${input.poolId}`,
		)
	}
	const tickLower = pos.lower_tick
	const tickUpper = pos.upper_tick
	if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || !(tickUpper > tickLower)) {
		throw new Error(`Bluefin add: invalid ticks ${tickLower}..${tickUpper}`)
	}

	const coinTypeA = pool.coin_a.address
	const coinTypeB = pool.coin_b.address
	const sideRaw = String(input.fixSide ?? 'A').trim()
	const poolFix = String(input.poolFixSide ?? '')
		.trim()
		.toUpperCase()
	let fixAmountA: boolean
	if (poolFix === 'A' || poolFix === 'B') {
		fixAmountA = poolFix === 'A'
	} else if (sideRaw === 'A' || sideRaw === 'a') fixAmountA = true
	else if (sideRaw === 'B' || sideRaw === 'b') fixAmountA = false
	else if (normCoinType(sideRaw) === normCoinType(coinTypeA)) fixAmountA = true
	else if (normCoinType(sideRaw) === normCoinType(coinTypeB)) fixAmountA = false
	else if (isSui(sideRaw) && isSui(coinTypeA)) fixAmountA = true
	else if (isSui(sideRaw) && isSui(coinTypeB)) fixAmountA = false
	else if (isUsdc(sideRaw) && isUsdc(coinTypeA)) fixAmountA = true
	else if (isUsdc(sideRaw) && isUsdc(coinTypeB)) fixAmountA = false
	else {
		throw new Error(
			`fixSide must be A, B, or a pool coin type (got ${sideRaw.slice(0, 48)})`,
		)
	}

	const knownDecimals = (ct: string): number | null => {
		if (isSui(ct)) return SUI_DECIMALS
		if (isUsdc(ct)) return USDC_DECIMALS
		return null
	}
	// Pool fetch may leave decimals=0 when metadata is missing — treat bare 0 as untrusted.
	const poolDecA = Number(pool.coin_a.decimals)
	const poolDecB = Number(pool.coin_b.decimals)
	const decimalsA = resolveCoinDecimals({
		coinType: coinTypeA,
		metaDecimals: poolDecA > 0 ? poolDecA : null,
		knownDecimals,
		byCoinType: input.coinDecimals,
	})
	const decimalsB = resolveCoinDecimals({
		coinType: coinTypeB,
		metaDecimals: poolDecB > 0 ? poolDecB : null,
		knownDecimals,
		byCoinType: input.coinDecimals,
	})
	if (decimalsA == null || decimalsB == null) {
		throw new Error('coin decimals unavailable — refusing to guess amounts')
	}
	// Keep pool object decimals in sync for any SDK helpers that read them.
	pool.coin_a.decimals = decimalsA
	pool.coin_b.decimals = decimalsB

	const fixDecimals = fixAmountA ? decimalsA : decimalsB
	const coinAmount = new BN(humanToRaw(input.amountHuman, fixDecimals))
	const curSqrt = new BN(pool.current_sqrt_price)
	const est = ClmmPoolUtil.estLiquidityAndCoinAmountFromOneAmounts(
		tickLower,
		tickUpper,
		coinAmount,
		fixAmountA,
		true,
		slip,
		curSqrt,
	)
	const tokenMaxA = new BN(String(est.coin_amount_limit_a))
	const tokenMaxB = new BN(String(est.coin_amount_limit_b))
	const liq = new BN(String(est.liquidity_amount))
	if (liq.lte(new BN(0))) throw new Error('computed liquidity is zero — check amount and range')
	const liquidityInput = {
		coinAmount,
		coinAmountA: fixAmountA ? coinAmount : tokenMaxA,
		coinAmountB: fixAmountA ? tokenMaxB : coinAmount,
		tokenMaxA,
		tokenMaxB,
		liquidityAmount: liq,
		fix_amount_a: fixAmountA,
	}

	const oc = createBluefinOnChainCalls(input.owner)
	const built = await oc.provideLiquidityWithFixedAmount(pool, input.positionId, liquidityInput, {
		returnTx: true,
		sender: input.owner,
	})
	if (!built || typeof built !== 'object' || !('setSender' in built)) {
		throw new Error('provideLiquidityWithFixedAmount did not return a Transaction (returnTx)')
	}
	return sealBluefin(built as Transaction, input.owner, 'add', {
		slot: null,
		policyKind: 'add',
		poolId: input.poolId,
		positionId: input.positionId,
		activeBinNote: `Bluefin add into existing position · ticks ${tickLower}…${tickUpper}. Range unchanged.`,
	})
}

/**
 * Principal-only Bluefin remove (partial or 100%).
 *
 * Does **not** use SDK `removeLiquidity` — that helper always appends
 * `gateway::collect_fee` + `gateway::collect_reward`. Instead we call only
 * `gateway::remove_liquidity` (official interface: liquidity out → destination;
 * fees/rewards stay on the position).
 *
 * @see https://github.com/fireflyprotocol/bluefin-spot-contract-interface/blob/main/sources/gateway.move
 * @see https://github.com/fireflyprotocol/bluefin-spot-contracts-public/blob/main/sources/pool.move (`pool::remove_liquidity`)
 */
export async function buildBluefinRemoveTx(input: {
	owner: string
	poolId: string
	positionId: string
	removePercent?: number
	/** Optional raw liquidity override (avoids float precision from SDK IPosition.liquidity). */
	liquidityRaw?: string
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	assertBluefinPoolAllowed(input.poolId)
	const pct = input.removePercent ?? 1
	if (!(pct > 0) || pct > 1) throw new Error('removePercent must be in (0, 1]')

	const pool = await fetchBluefinPool(input.poolId)
	// gRPC-safe position read — SDK QueryChain.parsePositionObject expects JSON-RPC .fields.bits.
	const pos = await fetchBluefinPosition(input.positionId)
	if (pos.pool_id.toLowerCase() !== input.poolId.toLowerCase()) {
		throw new Error(
			`Bluefin position ${input.positionId} belongs to pool ${pos.pool_id}, not ${input.poolId}`,
		)
	}
	const chainLiq = BigInt(pos.liquidityRaw)
	if (input.liquidityRaw && /^\d+$/.test(input.liquidityRaw)) {
		const clientLiq = BigInt(input.liquidityRaw)
		// Stale UI liquidity must not redefine 50%/100% of a fresher on-chain position.
		if (clientLiq !== chainLiq) {
			throw new Error(
				`Bluefin liquidity changed since preview (UI ${clientLiq.toString()} vs chain ${chainLiq.toString()}). Refresh Estimate.`,
			)
		}
	}
	const fullLiq = chainLiq
	const delta = bluefinRemoveLiquidityDelta(fullLiq, pct)
	if (delta <= 0n) throw new Error('remove percent rounds to zero liquidity')

	const lowerTick = pos.lower_tick
	const upperTick = pos.upper_tick
	if (!Number.isFinite(lowerTick) || !Number.isFinite(upperTick) || !(upperTick > lowerTick)) {
		throw new Error(`Bluefin remove: invalid ticks ${lowerTick}..${upperTick}`)
	}
	const liquidity = new BN(delta.toString())
	const curSqrt = new BN(pool.current_sqrt_price)
	const lowerSqrt = TickMath.tickIndexToSqrtPriceX64(lowerTick)
	const upperSqrt = TickMath.tickIndexToSqrtPriceX64(upperTick)
	const coinAmounts = ClmmPoolUtil.getCoinAmountFromLiquidity(liquidity, curSqrt, lowerSqrt, upperSqrt, false)
	const { coin_amount_limit_a, coin_amount_limit_b } = adjustForCoinSlippage(
		coinAmounts,
		Percentage.fromFraction(1, 100),
		false,
	)

	const tx = new Transaction()
	tx.moveCall({
		target: `${BLUEFIN_SPOT_MAINNET.CurrentPackage}::gateway::remove_liquidity`,
		typeArguments: [pool.coin_a.address, pool.coin_b.address],
		arguments: [
			tx.object(SUI_CLOCK_OBJECT_ID),
			tx.object(BLUEFIN_SPOT_MAINNET.GlobalConfig),
			tx.object(pool.id),
			tx.object(input.positionId),
			tx.pure.u128(delta.toString()),
			tx.pure.u64(coin_amount_limit_a.toString()),
			tx.pure.u64(coin_amount_limit_b.toString()),
			tx.pure.address(input.owner),
		],
	})

	return sealBluefin(tx, input.owner, 'remove', {
		slot: null,
		policyKind: 'remove',
		poolId: input.poolId,
		positionId: input.positionId,
		activeBinNote:
			pct >= 1
				? 'Bluefin withdraw all liquidity (principal only). Fees and rewards stay until Collect or Close. Position stays open and empty.'
				: `Bluefin withdraw ${Math.round(pct * 100)}% liquidity (principal only). Fees stay until Collect.`,
	})
}
