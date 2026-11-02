import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'

export type BalanceChangeRow = {
	coinType: string
	address: string
	amount: string
}

export type PositionHint = {
	tokenA: string
	tokenB: string
	tokenAAddress: string
	tokenBAddress: string
	tokenADecimals: number
	tokenBDecimals: number
	tokenAAmount: number
	tokenBAmount: number
	currentPriceA_USD?: number
	currentPriceB_USD?: number
	unclaimedFeeA?: number
	unclaimedFeeB?: number
	unclaimedFeeUSD?: number
	unclaimedRewardUSD?: number
	unclaimedRewardRows?: Array<{
		token: string
		coinType?: string
		amount: number
		amount_usd: number
	}>
	tickLower?: number
	tickUpper?: number
	currentTick?: number
	currentSqrtPrice?: string
	status?: 'in_range' | 'out_of_range'
}

export type ReceiveLine = {
	coinType: string
	symbol: string
	amount: number
	amountUsd: number | null
}

const SUI_TYPE = normalizeCoinTypeForMatch('0x2::sui::SUI')

function normAddr(a: string): string {
	return a.replace(/^0x/i, '').toLowerCase().replace(/^0+/, '') || '0'
}

/**
 * Sum owner balance changes into positive pre-network asset receives.
 * When signed net gas (`gasNetMist`) is known and the owner has a SUI delta,
 * reconstruct asset flow as `suiDelta + gasNetMist` (gas already embedded in the delta).
 * Does not invent SUI when the owner has no SUI balance-change row.
 */
export function aggregateOwnerReceives(
	changes: BalanceChangeRow[] | undefined,
	owner: string,
	gasNetMist?: string | null,
): { coinType: string; raw: bigint }[] {
	if (!changes?.length || !owner) return []
	const own = normAddr(owner)
	const byType = new Map<string, bigint>()
	let sawSui = false
	for (const c of changes) {
		if (normAddr(c.address) !== own) continue
		if (!/^-?\d+$/.test(c.amount)) continue
		const key = normalizeCoinTypeForMatch(c.coinType)
		if (key === SUI_TYPE) sawSui = true
		byType.set(key, (byType.get(key) ?? 0n) + BigInt(c.amount))
	}

	const gasNet =
		gasNetMist != null && /^-?\d+$/.test(gasNetMist) ? BigInt(gasNetMist) : null

	if (sawSui && gasNet != null) {
		const suiDelta = byType.get(SUI_TYPE) ?? 0n
		const adjusted = suiDelta + gasNet
		if (adjusted > 0n) byType.set(SUI_TYPE, adjusted)
		else byType.delete(SUI_TYPE)
	} else if (sawSui) {
		const suiDelta = byType.get(SUI_TYPE) ?? 0n
		if (suiDelta <= 0n) byType.delete(SUI_TYPE)
	}

	const out: { coinType: string; raw: bigint }[] = []
	for (const [coinType, raw] of byType) {
		if (raw > 0n) out.push({ coinType, raw })
	}
	out.sort((a, b) => (a.coinType < b.coinType ? -1 : 1))
	return out
}

/**
 * Owner outflows from simulation (deposits into LP).
 * SUI: reconstruct asset flow as `suiDelta + gasNetMist` (same as receives).
 * Storage rebate can make the raw delta positive while asset spend is still negative —
 * peel gas first, then classify spend (never drop a deposit because rebate flipped the sign).
 */
export function aggregateOwnerSpends(
	changes: BalanceChangeRow[] | undefined,
	owner: string,
	gasNetMist?: string | null,
): { coinType: string; raw: bigint }[] {
	if (!changes?.length || !owner) return []
	const own = normAddr(owner)
	const byType = new Map<string, bigint>()
	for (const c of changes) {
		if (normAddr(c.address) !== own) continue
		if (!/^-?\d+$/.test(c.amount)) continue
		const key = normalizeCoinTypeForMatch(c.coinType)
		byType.set(key, (byType.get(key) ?? 0n) + BigInt(c.amount))
	}

	const gasNet =
		gasNetMist != null && /^-?\d+$/.test(gasNetMist) ? BigInt(gasNetMist) : null

	const out: { coinType: string; raw: bigint }[] = []
	for (const [coinType, delta] of byType) {
		let assetDelta = delta
		if (coinType === SUI_TYPE && gasNet != null) {
			assetDelta = delta + gasNet
		}
		if (assetDelta >= 0n) continue
		out.push({ coinType, raw: -assetDelta })
	}
	out.sort((a, b) => (a.coinType < b.coinType ? -1 : 1))
	return out
}

/**
 * Convert raw on-chain amount to human units.
 * Invalid decimals → null (caller must show unavailable, not invent precision).
 * `decimals === 0` is integer units — never use `slice(-0)`.
 */
export function rawToHuman(raw: bigint, decimals: number): number | null {
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) return null
	if (raw === 0n) return 0
	if (decimals === 0) {
		if (raw > BigInt(Number.MAX_SAFE_INTEGER) || raw < BigInt(-Number.MAX_SAFE_INTEGER)) {
			return null
		}
		return Number(raw)
	}
	const neg = raw < 0n
	const abs = neg ? -raw : raw
	const s = abs.toString().padStart(decimals + 1, '0')
	const whole = s.slice(0, -decimals) || '0'
	const frac = s.slice(s.length - decimals)
	const n = Number(`${whole}.${frac}`)
	if (!Number.isFinite(n)) return null
	return neg ? -n : n
}

export function symbolFromType(coinType: string): string {
	const parts = coinType.split('::')
	return (parts[parts.length - 1] || 'COIN').toUpperCase()
}

export function removePercentOf(amount: number, pct: number): number {
	if (!(amount > 0) || !(pct > 0)) return 0
	return amount * Math.min(1, pct)
}
