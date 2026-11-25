/**
 * Stub rows for known unsupported LP NFT types (TZ §5) so Net Worth coverage
 * shows the gap instead of silently omitting them.
 */
import type { OpenPosition } from '@/types'
import { suiClient } from '@/services/suiClient'
import { listOwnedMoveObjects, asRpcObjectClient } from '@/services/objectVersionCache'
import { normalizeSuiAddress } from '@mysten/sui/utils'

/** Named stubs from TZ §5 (struct name tail). */
const STRUCT_FILTERS = [
	'AlphaFiReceipt',
	'WrappedPositionNFT',
	'CetusVaultVester',
	'LBPosition',
	'PyPosition',
	'MarketPosition',
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
		liquidity: '0',
		lifecycleStatus: 'unknown',
		status: 'out_of_range',
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
 * Best-effort: page Package-owned objects is too broad; we probe known struct names
 * via getOwnedObjects with StructType containing the suffix when the full package is unknown.
 * Falls back to empty when RPC cannot filter by partial type.
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

	// Probe by scanning a limited page of all owned objects for matching type tails.
	// Cap pages to keep this cheap — stubs are coverage signals, not a full inventory.
	let cursor: string | null | undefined
	for (let page = 0; page < 8; page++) {
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
				// Only flag the named stubs from TZ — avoid marking every foreign Position.
				if (!STRUCT_FILTERS.some((s) => tail === s)) continue
				seen.add(id)
				out.push(stubRow(id, tail))
			}
			if (!res.hasNextPage || !res.nextCursor) break
			cursor = res.nextCursor
		} catch {
			break
		}
	}

	void listOwnedMoveObjects
	void asRpcObjectClient
	return out
}
