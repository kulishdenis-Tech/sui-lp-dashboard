import BN from 'bn.js'
import {
	ClmmPoolUtil,
	Percentage,
	TickMath,
	adjustForCoinSlippage,
	d,
} from '@cetusprotocol/common-sdk'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import {
	clmmAllowsOneSidedBuy,
	clmmAllowsOneSidedSell,
	type StrategySlot,
} from '@autopilot/engine'
import { assertOneSidedDeposit } from './binGuard.js'
import { isSui, isSuiUsdcPair, isUsdc, normCoinType, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'
import { resolveCoinDecimals } from './coinTypeParse.js'
import { clmmPackageAllowed, verifyClmmUnsignedTx } from './clmmTxPolicy.js'
import { tickToUsdcPerSui } from './readClmmPools.js'
import { getClmmSdk } from './sdkClmm.js'
import {
	CETUS_CLOSE_LOCKED_MESSAGE,
	isCetusCompensationLockedPosition,
} from './compensationLock.js'
import { buildFillPreview, plannedOpenAverageUsdcPerSui, type FillPreview } from './conversionPreview.js'
import type { GasPreview, BalancePreview, UnsignedTx } from './buildTx.js'
import { interpretSim, interpretSimTransportError, logSimDiagnostics } from './simResult.js'
import type { MoveCallPreview } from './txPolicy.js'

const NOTE =
	'Unsigned CLMM transaction bytes. dryRunOk is a simulation result, not an execution. Sign in the OWNER wallet. This service has no private key and will not submit.'

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

function assertClmmSdkOnAllowlist(): void {
	const sdk = getClmmSdk()
	const ids = [
		sdk.sdkOptions.clmm_pool.package_id,
		sdk.sdkOptions.clmm_pool.published_at,
		sdk.sdkOptions.integrate.package_id,
		sdk.sdkOptions.integrate.published_at,
	]
	for (const id of ids) {
		if (!clmmPackageAllowed(id)) throw new Error(`CLMM SDK package ${id} is not in the manual-sign allowlist`)
	}
}

/** Convert human USDC/SUI prices → snapped tick bounds for the pool orientation. */
export function ticksFromUsdcPerSuiRange(
	lowerPrice: number,
	upperPrice: number,
	coinTypeA: string,
	tickSpacing: number,
): { tickLower: number; tickUpper: number } {
	if (!(lowerPrice > 0) || !(upperPrice > 0)) throw new Error('price bounds must be > 0')
	const lo = Math.min(lowerPrice, upperPrice)
	const hi = Math.max(lowerPrice, upperPrice)
	const decimalsA = isSui(coinTypeA) ? SUI_DECIMALS : USDC_DECIMALS
	const decimalsB = isSui(coinTypeA) ? USDC_DECIMALS : SUI_DECIMALS
	const toPair = (usdcPerSui: number) => (isSui(coinTypeA) ? usdcPerSui : 1 / usdcPerSui)
	const tLo = TickMath.priceToInitializeTickIndex(d(String(toPair(lo))), decimalsA, decimalsB, tickSpacing)
	const tHi = TickMath.priceToInitializeTickIndex(d(String(toPair(hi))), decimalsA, decimalsB, tickSpacing)
	let tickLower = Math.min(tLo, tHi)
	let tickUpper = Math.max(tLo, tHi)
	if (tickLower >= tickUpper) tickUpper = tickLower + tickSpacing
	return { tickLower, tickUpper }
}

function assertClmmHardLimit(
	slot: StrategySlot,
	tickLower: number,
	tickUpper: number,
	coinTypeA: string,
	hardPrice: number,
): void {
	const prices = [tickToUsdcPerSui(tickLower, coinTypeA), tickToUsdcPerSui(tickUpper, coinTypeA)]
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

async function sealClmm(
	tx: Transaction,
	owner: string,
	kind: UnsignedTx['kind'],
	extra: {
		slot: StrategySlot | null
		activeBinNote: string | null
		expectedAverageUsdcPerSui?: number | null
	},
): Promise<UnsignedTx> {
	assertOwner(owner)
	assertClmmSdkOnAllowlist()
	const sdk = getClmmSdk()
	sdk.setSenderAddress(owner)
	tx.setSender(owner)
	const bytes = await tx.build({ client: sdk.FullClient as never })
	const txBytesBase64 = toBase64(bytes)
	const report = await verifyClmmUnsignedTx(txBytesBase64, owner)
	let dryRunOk = false
	let dryRunError: string | null = null
	let gas: GasPreview | null = null
	let balanceChanges: BalancePreview[] = []
	try {
		const sim = await sdk.FullClient.sendSimulationTransaction(Transaction.from(txBytesBase64), owner, true)
		const parsed = interpretSim(sim)
		logSimDiagnostics(parsed, {
			method: 'FullClient.sendSimulationTransaction',
			protocol: 'clmm',
			kind,
		})
		dryRunOk = parsed.ok
		dryRunError = parsed.error
		gas = parsed.gas
		balanceChanges = parsed.balanceChanges
	} catch (e) {
		const parsed = interpretSimTransportError(e)
		logSimDiagnostics(parsed, {
			method: 'FullClient.sendSimulationTransaction',
			protocol: 'clmm',
			kind,
		})
		dryRunOk = false
		dryRunError = parsed.error
	}
	const again = await verifyClmmUnsignedTx(txBytesBase64, owner)
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

export type ClmmOpenLeg = {
	id?: string
	lowerPrice: number
	upperPrice: number
	budgetHuman: number
}

/**
 * One or more CLMM opens in a single PTB → one OWNER signature.
 * Uses Cetus SDK `createAddLiquidityFixTokenPayload(..., tx)` chaining
 * (integrate open settles Position NFT to sender on-chain).
 */
export async function buildClmmOpenTx(input: {
	owner: string
	poolId: string
	slot: StrategySlot
	hardPrice: number
	/** Single-leg shorthand (legacy). Ignored when `legs` is non-empty. */
	lowerPrice?: number
	upperPrice?: number
	budgetHuman?: number
	legs?: ClmmOpenLeg[]
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	const legs: ClmmOpenLeg[] =
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

	const sdk = getClmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	if (!isSuiUsdcPair(pool.coin_type_a, pool.coin_type_b)) {
		throw new Error(`pool ${input.poolId} is not a SUI/USDC CLMM pair`)
	}
	const tickSpacing = Number(pool.tick_spacing)
	const spot = tickToUsdcPerSui(pool.current_tick_index, pool.coin_type_a)
	const spendSui = input.slot === 'SELL'
	const fixAmountA = isSui(pool.coin_type_a) ? spendSui : !spendSui
	const decimals = spendSui ? SUI_DECIMALS : USDC_DECIMALS
	const curSqrt = new BN(pool.current_sqrt_price)

	let tx: Transaction | undefined
	const tickNotes: string[] = []
	for (const [i, leg] of legs.entries()) {
		const { tickLower, tickUpper } = ticksFromUsdcPerSuiRange(
			leg.lowerPrice,
			leg.upperPrice,
			pool.coin_type_a,
			tickSpacing,
		)
		assertClmmHardLimit(input.slot, tickLower, tickUpper, pool.coin_type_a, input.hardPrice)
		const upperPx = tickToUsdcPerSui(tickUpper, pool.coin_type_a)
		const lowerPx = tickToUsdcPerSui(tickLower, pool.coin_type_a)
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
		const liquidityInput = ClmmPoolUtil.estLiquidityAndCoinAmountFromOneAmounts(
			tickLower,
			tickUpper,
			coinAmount,
			fixAmountA,
			true,
			SLIPPAGE,
			curSqrt,
		)
		const amountA = fixAmountA ? coinAmount.toString() : String(liquidityInput.coin_amount_limit_a)
		const amountB = fixAmountA ? String(liquidityInput.coin_amount_limit_b) : coinAmount.toString()
		const depositSui = BigInt(isSui(pool.coin_type_a) ? amountA : amountB)
		const depositUsdc = BigInt(isSui(pool.coin_type_a) ? amountB : amountA)
		assertOneSidedDeposit(input.slot, depositSui, depositUsdc)
		tx = await sdk.Position.createAddLiquidityFixTokenPayload(
			{
				coin_type_a: pool.coin_type_a,
				coin_type_b: pool.coin_type_b,
				pool_id: pool.id,
				tick_lower: String(tickLower),
				tick_upper: String(tickUpper),
				fix_amount_a: fixAmountA,
				amount_a: amountA,
				amount_b: amountB,
				slippage: SLIPPAGE,
				is_open: true,
				pos_id: '',
				rewarder_coin_types: [],
				collect_fee: false,
			},
			tx,
		)
		tickNotes.push(`${leg.id ?? `LP${i + 1}`}:${tickLower}…${tickUpper}`)
	}
	if (!tx) throw new Error('no CLMM open legs')
	return sealClmm(tx, input.owner, 'open', {
		slot: input.slot,
		activeBinNote:
			legs.length === 1
				? `CLMM ticks ${tickNotes[0]} (spacing ${tickSpacing})`
				: `CLMM cascade ${legs.length} LP in one PTB · ${tickNotes.join(' · ')}`,
		expectedAverageUsdcPerSui: plannedOpenAverageUsdcPerSui(input.slot, legs, { protocol: 'clmm' }),
	})
}

/**
 * Add liquidity into an **existing** CLMM position NFT (is_open: false).
 * Uses the position's own tick bounds — never opens a new range/NFT.
 * Works for any CLMM pair (not limited to SUI/USDC strategy opens).
 *
 * @see https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk-v2/sdk-modules/cetusprotocol-sui-clmm-sdk/add-liquidity
 */
export async function buildClmmAddTx(input: {
	owner: string
	poolId: string
	positionId: string
	/** Human units of the fixed coin. */
	amountHuman: number
	/**
	 * Which pool coin is fixed: `A` | `B` (pool order), or a coin type string
	 * matching pool.coin_type_a / coin_type_b.
	 */
	fixSide: 'A' | 'B' | string
	/**
	 * Pool-native A/B when the dashboard display order was swapped (crypto/stable).
	 * Takes precedence over letter interpretation of fixSide.
	 */
	poolFixSide?: 'A' | 'B' | string
	slippage?: number
	/**
	 * Collect fees/rewards in the same PTB as add.
	 * Default false — refill Empty / top-up must not sweep fees; use Collect separately.
	 */
	collectFee?: boolean
	/** Optional decimals by coin type (from dashboard positionHint) when metadata is missing. */
	coinDecimals?: Record<string, number>
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	if (!(input.amountHuman > 0) || !Number.isFinite(input.amountHuman)) {
		throw new Error('amountHuman must be a finite number > 0')
	}
	const sdk = getClmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	const position = await sdk.Position.getPositionById(input.positionId)
	const posId = position.pos_object_id ?? input.positionId
	const tickLower = Number(position.tick_lower_index)
	const tickUpper = Number(position.tick_upper_index)
	if (!(tickLower < tickUpper)) throw new Error('position tick range is invalid')

	const sideRaw = String(input.fixSide ?? 'A').trim()
	const poolFix = String(input.poolFixSide ?? '')
		.trim()
		.toUpperCase()
	let fixAmountA: boolean
	if (poolFix === 'A' || poolFix === 'B') {
		fixAmountA = poolFix === 'A'
	} else if (sideRaw === 'A' || sideRaw === 'a') fixAmountA = true
	else if (sideRaw === 'B' || sideRaw === 'b') fixAmountA = false
	else if (normCoinType(sideRaw) === normCoinType(pool.coin_type_a)) fixAmountA = true
	else if (normCoinType(sideRaw) === normCoinType(pool.coin_type_b)) fixAmountA = false
	else if (isSui(sideRaw) && isSui(pool.coin_type_a)) fixAmountA = true
	else if (isSui(sideRaw) && isSui(pool.coin_type_b)) fixAmountA = false
	else if (isUsdc(sideRaw) && isUsdc(pool.coin_type_a)) fixAmountA = true
	else if (isUsdc(sideRaw) && isUsdc(pool.coin_type_b)) fixAmountA = false
	else {
		throw new Error(
			`fixSide must be A, B, or a pool coin type (got ${sideRaw.slice(0, 48)}; pool A=${pool.coin_type_a.slice(0, 24)}… B=${pool.coin_type_b.slice(0, 24)}…)`,
		)
	}

	// Prefer on-chain coin metadata; never invent decimals for unknown coins.
	const metaA = (await sdk.FullClient.getCoinMetadata({ coinType: pool.coin_type_a }).catch(
		() => null,
	)) as { decimals?: number } | null
	const metaB = (await sdk.FullClient.getCoinMetadata({ coinType: pool.coin_type_b }).catch(
		() => null,
	)) as { decimals?: number } | null
	const knownDecimals = (ct: string): number | null => {
		if (isSui(ct)) return SUI_DECIMALS
		if (isUsdc(ct)) return USDC_DECIMALS
		return null
	}
	const decA = resolveCoinDecimals({
		coinType: pool.coin_type_a,
		metaDecimals: metaA?.decimals,
		knownDecimals,
		byCoinType: input.coinDecimals,
	})
	const decB = resolveCoinDecimals({
		coinType: pool.coin_type_b,
		metaDecimals: metaB?.decimals,
		knownDecimals,
		byCoinType: input.coinDecimals,
	})
	if (decA == null || decB == null) {
		throw new Error('coin decimals unavailable — refusing to guess amounts')
	}

	const fixDecimals = fixAmountA ? decA : decB
	const coinAmount = new BN(humanToRaw(input.amountHuman, fixDecimals))
	const curSqrt = new BN(pool.current_sqrt_price)
	const slippage = input.slippage != null && input.slippage > 0 ? input.slippage : SLIPPAGE
	const liquidityInput = ClmmPoolUtil.estLiquidityAndCoinAmountFromOneAmounts(
		tickLower,
		tickUpper,
		coinAmount,
		fixAmountA,
		true,
		slippage,
		curSqrt,
	)
	const amountA = fixAmountA ? coinAmount.toString() : String(liquidityInput.coin_amount_limit_a)
	const amountB = fixAmountA ? String(liquidityInput.coin_amount_limit_b) : coinAmount.toString()

	const currentTick = Number(pool.current_tick_index)
	// Half-open [lower, upper) — same band as Cetus SDK / position status.
	const inRange = currentTick >= tickLower && currentTick < tickUpper
	// Out of range: one-sided deposit is expected; in range both sides must be > 0.
	if (inRange) {
		if (BigInt(amountA) <= 0n || BigInt(amountB) <= 0n) {
			throw new Error('in-range add requires both token amounts > 0 at current pool price')
		}
	} else {
		const onlyA = currentTick < tickLower
		const onlyB = currentTick >= tickUpper
		// Pool coin order may be USDC/SUI while the UI shows SUI/USDC — tell the user which side.
		const labelA = isSui(pool.coin_type_a) ? 'SUI' : isUsdc(pool.coin_type_a) ? 'USDC' : 'coin A'
		const labelB = isSui(pool.coin_type_b) ? 'SUI' : isUsdc(pool.coin_type_b) ? 'USDC' : 'coin B'
		if (onlyA && !fixAmountA) {
			throw new Error(
				`Price is below this range — deposit ${labelA} only (Fix ${labelA}). Fix ${labelB} cannot add liquidity here.`,
			)
		}
		if (onlyB && fixAmountA) {
			throw new Error(
				`Price is above this range — deposit ${labelB} only (Fix ${labelB}). Fix ${labelA} cannot add liquidity here.`,
			)
		}
		if (onlyA && BigInt(amountA) <= 0n) throw new Error(`below range: deposit requires ${labelA}`)
		if (onlyB && BigInt(amountB) <= 0n) throw new Error(`above range: deposit requires ${labelB}`)
	}

	const collectFee = input.collectFee === true
	const rewardCoinTypes = collectFee
		? (pool.rewarder_infos ?? []).map((r) => r.coin_type)
		: []

	const tx = await sdk.Position.createAddLiquidityFixTokenPayload({
		coin_type_a: pool.coin_type_a,
		coin_type_b: pool.coin_type_b,
		pool_id: pool.id,
		tick_lower: String(tickLower),
		tick_upper: String(tickUpper),
		fix_amount_a: fixAmountA,
		amount_a: amountA,
		amount_b: amountB,
		slippage,
		is_open: false,
		pos_id: posId,
		rewarder_coin_types: rewardCoinTypes,
		collect_fee: collectFee,
	})
	return sealClmm(tx, input.owner, 'add', {
		slot: null,
		activeBinNote: inRange
			? `CLMM add to ${posId.slice(0, 10)}… (in range ${tickLower}…${tickUpper}). Fees stay on NFT — Collect separately.`
			: `CLMM one-sided add to ${posId.slice(0, 10)}… (out of range ${tickLower}…${tickUpper}). Fees stay on NFT — Collect separately.`,
	})
}

export async function buildClmmCloseTx(input: {
	owner: string
	poolId: string
	positionId: string
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	if (await isCetusCompensationLockedPosition(input.poolId, input.positionId)) {
		throw new Error(CETUS_CLOSE_LOCKED_MESSAGE)
	}
	const sdk = getClmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	const position = await sdk.Position.getPositionById(input.positionId)
	const lowerTick = Number(position.tick_lower_index)
	const upperTick = Number(position.tick_upper_index)
	const liquidity = new BN(position.liquidity)
	const curSqrt = new BN(pool.current_sqrt_price)
	const lowerSqrt = TickMath.tickIndexToSqrtPriceX64(lowerTick)
	const upperSqrt = TickMath.tickIndexToSqrtPriceX64(upperTick)
	const coinAmounts = ClmmPoolUtil.getCoinAmountFromLiquidity(liquidity, curSqrt, lowerSqrt, upperSqrt, false)
	const { coin_amount_limit_a, coin_amount_limit_b } = adjustForCoinSlippage(
		coinAmounts,
		Percentage.fromFraction(1, 100),
		false,
	)
	const rewardCoinTypes = (pool.rewarder_infos ?? []).map((r) => r.coin_type)
	const tx = await sdk.Position.closePositionPayload({
		coin_type_a: pool.coin_type_a,
		coin_type_b: pool.coin_type_b,
		min_amount_a: coin_amount_limit_a.toString(),
		min_amount_b: coin_amount_limit_b.toString(),
		rewarder_coin_types: rewardCoinTypes,
		pool_id: pool.id,
		pos_id: position.pos_object_id ?? input.positionId,
		collect_fee: true,
	})
	return sealClmm(tx, input.owner, 'close', {
		slot: null,
		activeBinNote:
			'CLMM close withdraws residual liquidity, fees and rewards, then burns the position NFT. Refilling this object afterward is impossible. One OWNER signature.',
	})
}

export async function buildClmmRemoveTx(input: {
	owner: string
	poolId: string
	positionId: string
	removePercent?: number
	/** When true, collect fees (+ rewarders) in the same remove PTB. Still does not burn the NFT. */
	collectFee?: boolean
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	const pct = input.removePercent ?? 1
	if (!(pct > 0) || pct > 1) throw new Error('removePercent must be in (0, 1]')
	const collectFee = input.collectFee === true
	const sdk = getClmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	const position = await sdk.Position.getPositionById(input.positionId)
	const lowerTick = Number(position.tick_lower_index)
	const upperTick = Number(position.tick_upper_index)
	const fullLiq = BigInt(position.liquidity)
	const delta = (fullLiq * BigInt(Math.round(pct * 10_000))) / 10_000n
	if (delta <= 0n) throw new Error('remove percent rounds to zero liquidity')
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
	const rewardCoinTypes = collectFee ? (pool.rewarder_infos ?? []).map((r) => r.coin_type) : []
	const built = await sdk.Position.removeLiquidityPayload({
		coin_type_a: pool.coin_type_a,
		coin_type_b: pool.coin_type_b,
		delta_liquidity: delta.toString(),
		min_amount_a: coin_amount_limit_a.toString(),
		min_amount_b: coin_amount_limit_b.toString(),
		pool_id: pool.id,
		pos_id: position.pos_object_id ?? input.positionId,
		rewarder_coin_types: rewardCoinTypes,
		collect_fee: collectFee,
	})
	if (!built || typeof built !== 'object' || !('setSender' in built)) {
		throw new Error('removeLiquidityPayload did not return a Transaction')
	}
	const tx = built as Transaction
	return sealClmm(tx, input.owner, 'remove', {
		slot: null,
		activeBinNote: collectFee
			? `CLMM remove ${Math.round(pct * 100)}% liquidity with fees/rewards. NFT stays Empty — not Close.`
			: `CLMM remove ${Math.round(pct * 100)}% liquidity. Fees stay until a separate collect.`,
	})
}

export async function buildClmmCollectFeeTx(input: {
	owner: string
	poolId: string
	positionId: string
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	const sdk = getClmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	const position = await sdk.Position.getPositionById(input.positionId)
	const rewardCoinTypes = (pool.rewarder_infos ?? []).map((r) => r.coin_type)
	const tx =
		rewardCoinTypes.length > 0
			? await sdk.Rewarder.collectRewarderPayload({
					pool_id: pool.id,
					pos_id: position.pos_object_id ?? input.positionId,
					rewarder_coin_types: rewardCoinTypes,
					coin_type_a: pool.coin_type_a,
					coin_type_b: pool.coin_type_b,
					collect_fee: true,
				})
			: await sdk.Position.collectFeePayload({
					pool_id: pool.id,
					pos_id: position.pos_object_id ?? input.positionId,
					coin_type_a: pool.coin_type_a,
					coin_type_b: pool.coin_type_b,
				})
	return sealClmm(tx, input.owner, 'collect_fee', {
		slot: null,
		activeBinNote: 'CLMM collect fee (+ rewards if configured). Liquidity stays in the position.',
	})
}
