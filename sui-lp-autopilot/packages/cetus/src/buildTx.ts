import { StrategyType } from '@cetusprotocol/dlmm-sdk'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import type { StrategySlot } from '@autopilot/engine'
import { assertOneSidedDeposit, assertRangeHardLimit, binIdsFromPrices, binPriceUsdcPerSui, type BinPrice } from './binGuard.js'
import { isSui, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'
import { getDlmmSdk } from './sdk.js'
import {
	buildFillPreview,
	plannedOpenAverageUsdcPerSui,
	selectConvertedBins,
	type FillPreview,
	type PricedBin,
} from './conversionPreview.js'
import { interpretSim, interpretSimTransportError, logSimDiagnostics } from './simResult.js'
import { packageAllowed, verifyUnsignedTx, type MoveCallPreview } from './txPolicy.js'

export type GasPreview = {
	computationCost: string
	storageCost: string
	storageRebate: string
	nonRefundableStorageFee: string
}

export type BalancePreview = {
	coinType: string
	address: string
	amount: string
}

export type UnsignedTx = {
	kind: 'open' | 'add' | 'remove' | 'close' | 'collect_fee'
	slot: StrategySlot | null
	/** BCS bytes. OWNER wallet signs these. This process never signs. */
	txBytesBase64: string
	payloadSha256: string
	moveCalls: MoveCallPreview[]
	recipients: string[]
	gas: GasPreview | null
	balanceChanges: BalancePreview[]
	policyOk: true
	dryRunOk: boolean
	dryRunError: string | null
	binsChecked: BinPrice[]
	activeBinNote: string | null
	fill: FillPreview
	note: string
}

const NOTE =
	'Unsigned transaction bytes. dryRunOk is a simulation result, not an execution. Sign in the OWNER wallet. This service has no private key and will not submit.'

function humanToRaw(amount: number, decimals: number): string {
	if (!(amount > 0)) throw new Error('amount must be > 0')
	const [whole, frac = ''] = amount.toFixed(decimals).split('.')
	const digits = `${whole}${frac.padEnd(decimals, '0').slice(0, decimals)}`.replace(/^0+(?=\d)/, '')
	return BigInt(digits || '0').toString()
}

function assertOwner(owner: string): void {
	if (!/^0x[0-9a-fA-F]{64}$/.test(owner)) throw new Error('owner must be a 32-byte Sui address, not a key')
}

function assertSdkOnAllowlist(): void {
	const sdk = getDlmmSdk()
	const ids = [
		sdk.sdkOptions.dlmm_pool.package_id,
		sdk.sdkOptions.dlmm_pool.published_at,
		sdk.sdkOptions.dlmm_router.package_id,
		sdk.sdkOptions.dlmm_router.published_at,
	]
	for (const id of ids) {
		if (!packageAllowed(id)) throw new Error(`SDK package ${id} is not in the manual-sign allowlist`)
	}
}

/** BUY converts into SUI. SELL converts into USDC. `is_only_a` selects that coin's bins. */
export function convertedSideIsCoinA(slot: StrategySlot, coinTypeA: string): boolean {
	const convertedIsSui = slot === 'BUY'
	return convertedIsSui === isSui(coinTypeA)
}

function percentOf(raw: bigint, percent: number): bigint {
	if (!(percent > 0) || percent > 1) throw new Error('percent must be in (0, 1]')
	const bps = BigInt(Math.round(percent * 10_000))
	if (bps <= 0n || bps > 10_000n) throw new Error('percent must be in (0, 1]')
	const taken = (raw * bps) / 10_000n
	if (taken <= 0n) throw new Error('percent rounds to zero raw units')
	return taken
}

async function seal(
	tx: Transaction,
	owner: string,
	kind: UnsignedTx['kind'],
	bins: BinPrice[],
	extra: {
		slot: StrategySlot | null
		activeBinNote: string | null
		conversionBins?: PricedBin[]
		expectedAverageUsdcPerSui?: number | null
	},
): Promise<UnsignedTx> {
	assertOwner(owner)
	assertSdkOnAllowlist()
	const sdk = getDlmmSdk()
	sdk.setSenderAddress(owner)
	tx.setSender(owner)
	const bytes = await tx.build({ client: sdk.FullClient as never })
	const txBytesBase64 = toBase64(bytes)
	const report = await verifyUnsignedTx(txBytesBase64, owner)
	let dryRunOk = false
	let dryRunError: string | null = null
	let gas: GasPreview | null = null
	let balanceChanges: BalancePreview[] = []
	try {
		const sim = await sdk.FullClient.sendSimulationTransaction(Transaction.from(txBytesBase64), owner, true)
		const parsed = interpretSim(sim)
		logSimDiagnostics(parsed, {
			method: 'FullClient.sendSimulationTransaction',
			protocol: 'dlmm',
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
			protocol: 'dlmm',
			kind,
		})
		dryRunOk = false
		dryRunError = parsed.error
	}
	const again = await verifyUnsignedTx(txBytesBase64, owner)
	if (again.payloadSha256 !== report.payloadSha256) throw new Error('payload changed after the dry-run check')
	return {
		kind,
		slot: extra.slot,
		txBytesBase64,
		payloadSha256: report.payloadSha256,
		moveCalls: report.moveCalls,
		recipients: report.recipients,
		gas,
		balanceChanges,
		policyOk: true,
		dryRunOk,
		dryRunError,
		binsChecked: bins,
		activeBinNote: extra.activeBinNote,
		fill: buildFillPreview({
			slot: extra.slot,
			kind,
			gas,
			balanceChanges,
			bins: extra.conversionBins ?? [],
			expectedAverageUsdcPerSui: extra.expectedAverageUsdcPerSui ?? null,
		}),
		note: NOTE,
	}
}

export type DlmmBinStrategy = 'spot' | 'curve' | 'bidask'

export type DlmmOpenLeg = {
	id?: string
	lowerPrice: number
	upperPrice: number
	budgetHuman: number
	/** Cetus DLMM StrategyType. Defaults to Spot when omitted. */
	binStrategy?: DlmmBinStrategy
}

/** Exported for contract tests — maps constructor shape → Cetus StrategyType. */
export function toStrategyType(strategy: DlmmBinStrategy | undefined): StrategyType {
	if (strategy === 'curve') return StrategyType.Curve
	if (strategy === 'bidask') return StrategyType.BidAsk
	return StrategyType.Spot
}

/**
 * One or more DLMM opens in a single PTB → one OWNER signature.
 * Chains `addLiquidityPayload(opts, tx)`.
 */
export async function buildOpenTx(input: {
	owner: string
	poolId: string
	slot: StrategySlot
	hardPrice: number
	lowerPrice?: number
	upperPrice?: number
	budgetHuman?: number
	legs?: DlmmOpenLeg[]
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	const legs: DlmmOpenLeg[] =
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

	const sdk = getDlmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	const spendSui = input.slot === 'SELL'
	const fixA = isSui(pool.coin_type_a) ? spendSui : !spendSui
	const decimals = fixA
		? isSui(pool.coin_type_a)
			? SUI_DECIMALS
			: USDC_DECIMALS
		: isSui(pool.coin_type_a)
			? USDC_DECIMALS
			: SUI_DECIMALS

	let tx: Transaction | undefined
	const allBins: BinPrice[] = []
	for (const leg of legs) {
		const ids = binIdsFromPrices(leg.lowerPrice, leg.upperPrice, pool.bin_step, pool.coin_type_a)
		const bins = assertRangeHardLimit({
			slot: input.slot,
			...ids,
			binStep: pool.bin_step,
			coinTypeA: pool.coin_type_a,
			hardPrice: input.hardPrice,
		})
		allBins.push(...bins)
		const strategyType = toStrategyType(leg.binStrategy)
		const binInfos = await sdk.Position.calculateAddLiquidityInfo({
			pool_id: pool.id,
			active_id: pool.active_id,
			bin_step: pool.bin_step,
			lower_bin_id: ids.lowerBinId,
			upper_bin_id: ids.upperBinId,
			strategy_type: strategyType,
			coin_amount: humanToRaw(leg.budgetHuman, decimals),
			fix_amount_a: fixA,
		})
		const depositSui = BigInt(isSui(pool.coin_type_a) ? binInfos.amount_a : binInfos.amount_b)
		const depositUsdc = BigInt(isSui(pool.coin_type_a) ? binInfos.amount_b : binInfos.amount_a)
		assertOneSidedDeposit(input.slot, depositSui, depositUsdc)
		tx = sdk.Position.addLiquidityPayload(
			{
				pool_id: pool.id,
				coin_type_a: pool.coin_type_a,
				coin_type_b: pool.coin_type_b,
				lower_bin_id: ids.lowerBinId,
				upper_bin_id: ids.upperBinId,
				active_id: pool.active_id,
				bin_step: pool.bin_step,
				max_price_slippage: 0.01,
				bin_infos: binInfos,
				strategy_type: strategyType,
			},
			tx,
		)
	}
	if (!tx) throw new Error('no DLMM open legs')
	const spotUsdcPerSui = binPriceUsdcPerSui(pool.active_id, pool.bin_step, pool.coin_type_a)
	const plannedLegs = legs.map((leg) => {
		const ids = binIdsFromPrices(leg.lowerPrice, leg.upperPrice, pool.bin_step, pool.coin_type_a)
		return {
			lowerPrice: leg.lowerPrice,
			upperPrice: leg.upperPrice,
			budgetHuman: leg.budgetHuman,
			binStrategy: leg.binStrategy,
			lowerBinId: ids.lowerBinId,
			upperBinId: ids.upperBinId,
		}
	})
	return seal(tx, input.owner, 'open', allBins, {
		slot: input.slot,
		activeBinNote: legs.length > 1 ? `DLMM cascade ${legs.length} LP in one PTB` : null,
		expectedAverageUsdcPerSui: plannedOpenAverageUsdcPerSui(input.slot, plannedLegs, {
			protocol: 'dlmm',
			pool: {
				activeId: pool.active_id,
				spotUsdcPerSui,
				binStep: pool.bin_step,
				priceRisesWithBinId: isSui(pool.coin_type_a),
			},
		}),
	})
}

export async function buildCloseTx(input: {
	owner: string
	poolId: string
	positionId: string
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	const sdk = getDlmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	const tx = sdk.Position.closePositionPayload({
		pool_id: pool.id,
		position_id: input.positionId,
		coin_type_a: pool.coin_type_a,
		coin_type_b: pool.coin_type_b,
		reward_coins: pool.reward_manager.rewards.map((r) => r.reward_coin),
	})
	return seal(tx, input.owner, 'close', [], {
		slot: null,
		activeBinNote:
			'Close collects fees and rewards, removes the whole position including the active bin, and deletes it. This is one OWNER signature, separate from collect or partial remove.',
	})
}

export async function buildRemoveTx(input: {
	owner: string
	poolId: string
	positionId: string
	removePercent?: number
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	const sdk = getDlmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	const position = await sdk.Position.getPosition(input.positionId)
	const binInfos = await sdk.Position.getPositionAmounts(position, pool)
	const tx = sdk.Position.removeLiquidityPayload({
		pool_id: pool.id,
		position_id: position.id,
		coin_type_a: pool.coin_type_a,
		coin_type_b: pool.coin_type_b,
		active_id: pool.active_id,
		bin_step: pool.bin_step,
		bin_infos: binInfos,
		slippage: 0.01,
		collect_fee: false,
		reward_coins: [],
		remove_percent: input.removePercent ?? 1,
	})
	return seal(tx, input.owner, 'remove', [], {
		slot: null,
		activeBinNote:
			'Full remove uses remove_liquidity_by_percent across the position span, so the active bin is included. Fees stay on the position until a separate collect.',
	})
}

/**
 * Withdraw part of the liquidity that has already converted, on bins other than the active bin.
 * Cetus `calculateRemoveLiquidityInfo({ is_only_a })` drops `bin_id === active_id`.
 * `remove_percent` is omitted so the payload uses per-bin shares instead of the whole span.
 */
export async function buildConvertedRemoveTx(input: {
	owner: string
	poolId: string
	positionId: string
	slot: StrategySlot
	percent: number
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	const sdk = getDlmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	const position = await sdk.Position.getPosition(input.positionId)
	const amounts = await sdk.Position.getPositionAmounts(position, pool)
	const onlyA = convertedSideIsCoinA(input.slot, pool.coin_type_a)
	const side = selectConvertedBins(
		amounts.bins.map((bin) => ({
			binId: bin.bin_id,
			amountA: BigInt(bin.amount_a),
			amountB: BigInt(bin.amount_b),
		})),
		pool.active_id,
		onlyA,
	)
	if (side.some((bin) => bin.binId === pool.active_id)) {
		throw new Error('Cetus one-sided remove cannot include the active bin.')
	}
	const raw = side.reduce((sum, bin) => sum + (onlyA ? bin.amountA : bin.amountB), 0n)
	if (raw === 0n) {
		throw new Error(
			'Cetus one-sided remove cannot withdraw the active bin, and this position has no converted liquidity outside it.',
		)
	}
	const coinAmount = percentOf(raw, input.percent)
	const binInfos = sdk.Position.calculateRemoveLiquidityInfo({
		bins: amounts.bins,
		active_id: pool.active_id,
		is_only_a: onlyA,
		coin_amount: coinAmount.toString(),
	})
	const tx = sdk.Position.removeLiquidityPayload({
		pool_id: pool.id,
		position_id: position.id,
		coin_type_a: pool.coin_type_a,
		coin_type_b: pool.coin_type_b,
		active_id: pool.active_id,
		bin_step: pool.bin_step,
		bin_infos: binInfos,
		slippage: 0.01,
		collect_fee: false,
		reward_coins: [],
	})
	const bins = binInfos.bins
		.filter((bin) => bin.bin_id !== pool.active_id)
		.map((bin) => ({
			binId: bin.bin_id,
			priceUsdcPerSui: binPriceUsdcPerSui(bin.bin_id, pool.bin_step, pool.coin_type_a),
			amountSui: Number(formatUnits(isSui(pool.coin_type_a) ? bin.amount_a : bin.amount_b, SUI_DECIMALS)),
			amountUsdc: Number(formatUnits(isSui(pool.coin_type_a) ? bin.amount_b : bin.amount_a, USDC_DECIMALS)),
		}))
	return seal(tx, input.owner, 'remove', bins, {
		slot: input.slot,
		activeBinNote:
			'Partial remove takes only bins strictly on the converted side of the active bin. The active bin stays. Fees are not collected in this transaction.',
		conversionBins: bins,
	})
}

function formatUnits(raw: string, decimals: number): string {
	if (!/^\d+$/.test(raw)) return '0'
	const padded = raw.padStart(decimals + 1, '0')
	const whole = padded.slice(0, padded.length - decimals)
	const frac = padded.slice(padded.length - decimals).replace(/0+$/, '')
	return frac ? `${whole}.${frac}` : whole
}

export async function buildCollectFeeTx(input: {
	owner: string
	poolId: string
	positionId: string
}): Promise<UnsignedTx> {
	assertOwner(input.owner)
	const sdk = getDlmmSdk()
	sdk.setSenderAddress(input.owner)
	const pool = await sdk.Pool.getPool(input.poolId)
	const tx = sdk.Position.collectFeePayload({
		pool_id: pool.id,
		position_id: input.positionId,
		coin_type_a: pool.coin_type_a,
		coin_type_b: pool.coin_type_b,
	})
	return seal(tx, input.owner, 'collect_fee', [], {
		slot: null,
		activeBinNote: 'Collects position fees only. Liquidity, including the active bin, stays in the position.',
	})
}
