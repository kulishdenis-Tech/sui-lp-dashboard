/**
 * Build Auto Withdraw evaluation snapshot from an OpenPosition (USDC per SUI).
 */
import type { OpenPosition } from '@/types'
import type { AutoWithdrawPositionSnapshot, DepositLeg, StrategySlot } from '@autopilot/engine'
import { inferDirectionFromDeposits, directionFromSlot } from '@autopilot/engine'
import { isNativeSuiCoinType, normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import { clmmRangeFromOpenPosition } from '@/utils/tickPriceRange'
import { loadCascadeRecords } from './cascadeGroups'

const KNOWN_USDC =
	'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

export function isUsdcCoinType(coinType: string): boolean {
	const n = normalizeCoinTypeForMatch(coinType)
	return n === normalizeCoinTypeForMatch(KNOWN_USDC) || n.endsWith('::usdc::USDC')
}

export function pairIsSuiUsdc(p: Pick<OpenPosition, 'tokenAAddress' | 'tokenBAddress'>): boolean {
	const aSui = isNativeSuiCoinType(p.tokenAAddress)
	const bSui = isNativeSuiCoinType(p.tokenBAddress)
	const aUsdc = isUsdcCoinType(p.tokenAAddress)
	const bUsdc = isUsdcCoinType(p.tokenBAddress)
	return (aSui && bUsdc) || (bSui && aUsdc)
}

export function manageProtocolOf(p: OpenPosition): 'clmm' | 'dlmm' | 'bluefin' {
	if (p.protocol === 'bluefin') return 'bluefin'
	if (p.cetusDlmm) return 'dlmm'
	return 'clmm'
}

type PrincipalPick = Pick<
	OpenPosition,
	'tokenAAddress' | 'tokenBAddress' | 'tokenAAmount' | 'tokenBAmount'
>

/** Principal amounts in human SUI / USDC (fees excluded — use token amounts on position). */
export function principalSuiUsdc(p: PrincipalPick): { sui: number; usdc: number } {
	let sui = 0
	let usdc = 0
	if (isNativeSuiCoinType(p.tokenAAddress)) sui += Number(p.tokenAAmount) || 0
	if (isNativeSuiCoinType(p.tokenBAddress)) sui += Number(p.tokenBAmount) || 0
	if (isUsdcCoinType(p.tokenAAddress)) usdc += Number(p.tokenAAmount) || 0
	if (isUsdcCoinType(p.tokenBAddress)) usdc += Number(p.tokenBAmount) || 0
	return { sui, usdc }
}

/**
 * Proposal hint for AW UI: tokens by coinType (never assume SUI=A / USDC=B),
 * principal-only USD (Liquidity, not Value with fees).
 * `asOfMs` is omitted unless caller supplies a real data timestamp — never Date.now() at render.
 */
export function awProposalReceiveHint(
	p: PrincipalPick &
		Pick<OpenPosition, 'tokenA' | 'tokenB' | 'currentValueUSD'>,
	targetAsset: 'SUI' | 'USDC' | null | undefined,
	opts?: { asOfMs?: number | null },
): {
	expectedReceive?: string
	/** Principal liquidity USD only; null when unknown. */
	principalUsd: number | null
	asOfMs?: number
} {
	const { sui, usdc } = principalSuiUsdc(p)
	const receive =
		targetAsset === 'SUI'
			? `${sui} ${isNativeSuiCoinType(p.tokenAAddress) ? p.tokenA : isNativeSuiCoinType(p.tokenBAddress) ? p.tokenB : 'SUI'}`
			: targetAsset === 'USDC'
				? `${usdc} ${isUsdcCoinType(p.tokenAAddress) ? p.tokenA : isUsdcCoinType(p.tokenBAddress) ? p.tokenB : 'USDC'}`
				: undefined
	const principalUsd = Number.isFinite(p.currentValueUSD) ? p.currentValueUSD : null
	const asOf =
		opts?.asOfMs != null && Number.isFinite(opts.asOfMs) && opts.asOfMs > 0
			? opts.asOfMs
			: undefined
	return {
		expectedReceive: receive,
		principalUsd,
		...(asOf != null ? { asOfMs: asOf } : {}),
	}
}

export function buildAutoWithdrawSnapshot(
	p: OpenPosition,
	owner: string,
	opts?: { dataFresh?: boolean },
): AutoWithdrawPositionSnapshot | null {
	if (!pairIsSuiUsdc(p)) return null
	const range = clmmRangeFromOpenPosition({
		tickLower: p.tickLower,
		tickUpper: p.tickUpper,
		currentTick: p.currentTick,
		currentSqrtPrice: p.currentSqrtPrice,
		tokenA: p.tokenA,
		tokenB: p.tokenB,
		tokenADecimals: p.tokenADecimals,
		tokenBDecimals: p.tokenBDecimals,
		status: p.status,
		priceRangeOverride: p.priceRangeOverride,
	})
	if (!range) return null
	// Display pair is normalized to crypto/stable (SUI/USDC) → B per A = USDC per SUI.
	const mark = range.priceCurrent
	const { sui, usdc } = principalSuiUsdc(p)
	return {
		owner,
		network: 'mainnet',
		protocol: manageProtocolOf(p),
		poolId: p.poolId,
		positionId: p.id,
		markUsdcPerSui: mark > 0 ? mark : null,
		rangeLowerUsdcPerSui: range.priceMin,
		rangeUpperUsdcPerSui: range.priceMax,
		principalSui: sui,
		principalUsdc: usdc,
		liquidityRaw: p.liquidity,
		dataFresh: opts?.dataFresh !== false,
		pairIsSuiUsdc: true,
	}
}

/** Prefer cascade remembered slot, else deposit legs, else null → user choice. */
export function resolveAutoWithdrawDirection(input: {
	positionId: string
	poolId: string
	depositLegs?: DepositLeg[]
	cascadeSlot?: StrategySlot | null
}): {
	direction: 'down' | 'up'
	targetAsset: 'SUI' | 'USDC'
	source: 'cascade_slot' | 'deposit_events' | 'unknown'
} | null {
	if (input.cascadeSlot === 'BUY' || input.cascadeSlot === 'SELL') {
		const d = directionFromSlot(input.cascadeSlot)
		return { ...d, source: 'cascade_slot' }
	}
	// Same pool ≠ membership in that cascade — only trust an explicit position binding.
	const rec = loadCascadeRecords().find((r) =>
		r.positionIds.some((id) => id.toLowerCase() === input.positionId.toLowerCase()),
	)
	if (rec?.slot === 'BUY' || rec?.slot === 'SELL') {
		const d = directionFromSlot(rec.slot)
		return { ...d, source: 'cascade_slot' }
	}
	if (input.depositLegs?.length) {
		const inferred = inferDirectionFromDeposits(input.depositLegs)
		if (inferred) {
			return {
				direction: inferred.direction,
				targetAsset: inferred.targetAsset,
				source: 'deposit_events',
			}
		}
	}
	return null
}
