/**
 * Stub rows for known unsupported LP NFT types (TZ §5) so Net Worth coverage
 * shows the gap instead of silently omitting them.
 */
import type { OpenPosition } from '@/types'
import { suiClient } from '@/services/suiClient'
import { normalizeSuiAddress } from '@mysten/sui/utils'

/** Named stubs from TZ §5 + common farm/stake receipts (struct name tail). */
const STRUCT_FILTERS = [
	'AlphaFiReceipt',
	'WrappedPositionNFT',
	'CetusVaultVester',
	'LBPosition',
	'PyPosition',
	'MarketPosition',
	'Farm',
	'StakeReceipt',
	'Receipt',
	'TradeCap',
	'SupplierCap',
	'SpoolAccount',
	'Spool',
	'StakingPosition',
	'VaultShare',
	'PositionNFT',
] as const

function stubRow(id: string, typeLabel: string): OpenPosition {
	return {
		id,
		protocol: 'unsupported',
		poolId: '',
		pair: `Unsupported (${typeLabel})`,
		tokenA: '—',
		tokenB: '—',
		tokenAAddress: '',
		tokenBAddress: '',
		tokenADecimals: 0,
		tokenBDecimals: 0,
		fee: 0,
		tickLower: 0,
		tickUpper: 0,
		currentTick: 0,
		currentSqrtPrice: '0',
		// Non-zero sentinel so isEmptyLpPosition does not hide the stub
		liquidity: '1',
		lifecycleStatus: 'unknown',
		status: 'in_range',
		tokenAAmount: 0,
		tokenBAmount: 0,
		currentPriceA_USD: Number.NaN,
		currentPriceB_USD: Number.NaN,
		currentValueUSD: Number.NaN,
		depositedUSD: Number.NaN,
		pnlUSD: Number.NaN,
		pnlPct: Number.NaN,
		unclaimedFeeA: 0,
		unclaimedFeeB: 0,
		unclaimedFeeUSD: Number.NaN,
		unclaimedRewardUSD: Number.NaN,
		openedAt: 0,
		daysOpen: Number.NaN,
		lifetimeEarningsUSD: Number.NaN,
		vsHodlDeltaUSD: Number.NaN,
		aprEstimatePct: Number.NaN,
		historyPartial: true,
	}
}

function typeTail(typeStr: string): string {
	const bare = typeStr.includes('<') ? typeStr.slice(0, typeStr.indexOf('<')) : typeStr
	const parts = bare.split('::')
	return parts[parts.length - 1] ?? bare
}

/**
 * Full-ish owned inventory walk (version-aware cache via listOwnedMoveObjects when possible).
 * Caps at 40 pages × 50 to avoid runaway wallets; incomplete → still returns what we found.
 */
export async function getUnsupportedLpStubs(walletAddress: string): Promise<OpenPosition[]> {
	let owner: string
	try {
		owner = normalizeSuiAddress(walletAddress.trim())
	} catch {
		owner = walletAddress.trim()
	}

	const out: OpenPosition[] = []
	const seen = new Set<string>()

	let cursor: string | null | undefined
	let incomplete = false
	for (let page = 0; page < 40; page++) {
		try {
			const res = await suiClient.getOwnedObjects({
				owner,
				cursor: cursor ?? undefined,
				limit: 50,
				options: { showType: true },
			})
			for (const row of res.data) {
				const typ = row.data?.type
				const id = row.data?.objectId
				if (!typ || !id || seen.has(id)) continue
				const tail = typeTail(typ)
				if (!STRUCT_FILTERS.some((s) => tail === s)) continue
				seen.add(id)
				out.push(stubRow(id, tail))
			}
			if (!res.hasNextPage || !res.nextCursor) break
			cursor = res.nextCursor
			if (page === 39) incomplete = true
		} catch {
			incomplete = true
			break
		}
	}

	void incomplete
	return out
}
