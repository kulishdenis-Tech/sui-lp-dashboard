/**
 * Scallop lending — ObligationKey → Obligation (collateral + debt).
 *
 * Package (initial): 0xefe8…fddf (docs.scallop.io / publish-result.mainnet).
 * Market shared object: PROTOCOL_PACKAGES.SCALLOP_MARKET (`0xa757975…`).
 * WitTable: nested `fields.table.id` (not the WitTable wrapper id).
 * Debt: amount × market.borrow_index / debt.borrow_index
 * (protocol::borrow_dynamics / obligation_debts).
 * HF uses a conservative 80% LT when reserve config is unavailable.
 */
import type {
	BorrowPosition,
	CollateralInfo,
	LendingRewardToClaim,
	LendingSnapshot,
	SupplyPosition,
} from '@/types'
import { suiClient } from '@/services/suiClient'
import { listOwnedMoveObjects, asRpcObjectClient, multiGetObjectsHydrated } from '@/services/objectVersionCache'
import { resolveSpots } from '@/services/spotPrice/resolveSpots'
import { enrichSupplyLiquidationPrices, normalizeLiquidationThresholdFactor } from '@/utils/supplyLiquidationPrice'
import { extractTypeName } from '@/services/turbosService'
import { PROTOCOL_PACKAGES } from '@/utils/constants'
import { normalizeSuiAddress } from '@mysten/sui/utils'

export const SCALLOP_PROTOCOL_PKG =
	'0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf' as const
export const SCALLOP_OBLIGATION_KEY = `${SCALLOP_PROTOCOL_PKG}::obligation::ObligationKey` as const
/** Shared Market object id (not a package). */
export const SCALLOP_MARKET_OBJECT_ID = PROTOCOL_PACKAGES.SCALLOP_MARKET

const DEFAULT_LT = 0.8

export const EMPTY_SCALLOP_SNAP: LendingSnapshot = {
	supplies: [],
	borrows: [],
	totalSuppliedUSD: 0,
	totalBorrowedUSD: 0,
	netValueUSD: 0,
	healthFactor: null,
	rewardsToClaim: [] as LendingRewardToClaim[],
	protocol: 'Scallop',
}

function contentFields(obj: unknown): Record<string, unknown> | null {
	if (!obj || typeof obj !== 'object') return null
	const o = obj as Record<string, unknown>
	const data = (o.data ?? o) as Record<string, unknown>
	const content = data.content as Record<string, unknown> | undefined
	if (!content) return null
	return (content.fields ?? content) as Record<string, unknown>
}

function unwrap(val: unknown): Record<string, unknown> | null {
	if (!val || typeof val !== 'object') return null
	const o = val as Record<string, unknown>
	if (o.fields && typeof o.fields === 'object') return o.fields as Record<string, unknown>
	return o
}

/**
 * WitTable stores the inner Table under `table` / `fields.table`.
 * The wrapper UID must NOT be used for getDynamicFields.
 */
function tableId(wrapper: unknown): string | null {
	const f = unwrap(wrapper)
	if (!f || f.table == null) return null
	const inner = unwrap(f.table)
	if (!inner) {
		if (typeof f.table === 'string' && f.table.startsWith('0x')) return f.table
		return null
	}
	const idNode = inner.id as Record<string, unknown> | string | undefined
	if (typeof idNode === 'string' && idNode.startsWith('0x')) return idNode
	if (idNode && typeof idNode === 'object') {
		const nested = unwrap(idNode)
		const id = (nested?.id ?? (idNode as { id?: unknown }).id) as unknown
		if (typeof id === 'string' && id.startsWith('0x')) return id
		if (id && typeof id === 'object' && typeof (id as { id?: unknown }).id === 'string') {
			const deep = (id as { id: string }).id
			if (deep.startsWith('0x')) return deep
		}
	}
	return null
}

/** Exported for unit tests. */
export function scallopTableIdFromWitTable(wrapper: unknown): string | null {
	return tableId(wrapper)
}

function readU64(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v
	if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
	return 0
}

type WitEntry = { coinType: string; amountRaw: number; borrowIndex: number | null }

async function readWitTableEntries(parentId: string): Promise<WitEntry[]> {
	const out: WitEntry[] = []
	let cursor: string | null | undefined
	for (let page = 0; page < 20; page++) {
		let res: Awaited<ReturnType<typeof suiClient.getDynamicFields>>
		try {
			res = await suiClient.getDynamicFields({
				parentId,
				cursor: cursor ?? undefined,
				limit: 50,
			})
		} catch (e) {
			console.warn('[scallop] getDynamicFields failed', parentId.slice(0, 12), e)
			break
		}
		const ids = res.data.map((d) => d.objectId).filter(Boolean)
		if (ids.length) {
			const objs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), ids)
			for (const obj of objs) {
				const f = contentFields(obj)
				if (!f) continue
				const name = f.name
				const coinType =
					extractTypeName(name) ??
					(typeof name === 'string' ? name : null) ??
					extractTypeName((f.value as Record<string, unknown>)?.name)
				const value = unwrap(f.value) ?? f
				const amount =
					readU64(value.amount) ||
					readU64(value.value) ||
					readU64(value.debt) ||
					readU64(value.borrow_amount)
				const borrowIndex =
					readU64(value.borrow_index) ||
					readU64(value.borrowIndex) ||
					null
				if (coinType && amount > 0) {
					out.push({
						coinType,
						amountRaw: amount,
						borrowIndex: borrowIndex && borrowIndex > 0 ? borrowIndex : null,
					})
				}
			}
		}
		if (!res.hasNextPage || !res.nextCursor) break
		cursor = res.nextCursor as string
	}
	return out
}

/**
 * Load market.borrow_dynamics WitTable → coinType → borrow_index.
 * Source: protocol::market::Market.borrow_dynamics (docs / borrow_dynamics.move).
 */
async function loadMarketBorrowIndexes(): Promise<Map<string, number>> {
	const out = new Map<string, number>()
	try {
		const objs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), [
			SCALLOP_MARKET_OBJECT_ID,
		])
		const f = contentFields(objs[0])
		if (!f) return out
		const dynamicsTable = tableId(f.borrow_dynamics)
		if (!dynamicsTable) return out
		const entries = await readWitTableEntries(dynamicsTable)
		// BorrowDynamic entries use borrow_index as the primary u64 field we stored in amountRaw
		// when `amount` is absent — re-read carefully via dedicated path below.
		const res = await suiClient.getDynamicFields({ parentId: dynamicsTable, limit: 50 })
		const ids = res.data.map((d) => d.objectId).filter(Boolean)
		if (!ids.length) return out
		const dynObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), ids)
		for (const obj of dynObjs) {
			const cf = contentFields(obj)
			if (!cf) continue
			const name = cf.name
			const coinType =
				extractTypeName(name) ??
				(typeof name === 'string' ? name : null) ??
				extractTypeName((cf.value as Record<string, unknown>)?.name)
			const value = unwrap(cf.value) ?? cf
			const idx = readU64(value.borrow_index) || readU64(value.borrowIndex)
			if (coinType && idx > 0) out.set(coinType.toLowerCase(), idx)
		}
		void entries
	} catch (e) {
		console.warn('[scallop] loadMarketBorrowIndexes failed', e)
	}
	return out
}

function obligationIdFromKey(fields: Record<string, unknown>): string | null {
	const ownership = unwrap(fields.ownership)
	if (!ownership) return null
	const of = ownership.of ?? ownership.of_id ?? ownership.id
	if (typeof of === 'string' && of.startsWith('0x')) return of
	const nested = unwrap(of)
	const id = nested?.id
	if (typeof id === 'string' && id.startsWith('0x')) return id
	return null
}

export async function getScallopPositions(walletAddress: string): Promise<LendingSnapshot> {
	let owner: string
	try {
		owner = normalizeSuiAddress(walletAddress.trim())
	} catch {
		owner = walletAddress.trim()
	}

	let keys: Awaited<ReturnType<typeof listOwnedMoveObjects>>
	try {
		keys = await listOwnedMoveObjects(asRpcObjectClient(suiClient), {
			owner,
			filter: { StructType: SCALLOP_OBLIGATION_KEY },
		})
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		console.warn('[scallop] listOwnedMoveObjects failed', e)
		return {
			...EMPTY_SCALLOP_SNAP,
			incomplete: true,
			error: `owned: ${msg}`,
			metricsLive: false,
		}
	}
	if (!keys.length) return EMPTY_SCALLOP_SNAP

	const obligationIds: string[] = []
	for (const k of keys) {
		const f = contentFields(k)
		if (!f) continue
		const oid = obligationIdFromKey(f)
		if (oid) {
			try {
				obligationIds.push(normalizeSuiAddress(oid))
			} catch {
				obligationIds.push(oid)
			}
		}
	}
	if (!obligationIds.length) {
		return {
			...EMPTY_SCALLOP_SNAP,
			incomplete: true,
			error: 'obligation keys unreadable',
			metricsLive: false,
		}
	}

	const oblObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), obligationIds)
	const marketBorrowIndex = await loadMarketBorrowIndexes()

	const supplies: SupplyPosition[] = []
	const borrows: BorrowPosition[] = []
	let totalSuppliedUSD = 0
	let totalBorrowedUSD = 0
	const obligationHfs: number[] = []
	const allCoinTypes = new Set<string>()
	let tablesUnreadable = false

	type Pending = {
		oblId: string
		collaterals: WitEntry[]
		debts: WitEntry[]
	}
	const pending: Pending[] = []

	for (let i = 0; i < oblObjs.length; i++) {
		const f = contentFields(oblObjs[i])
		if (!f) continue
		const oblId = obligationIds[i]!
		const colTable = tableId(f.collaterals)
		const debtTable = tableId(f.debts)
		if (!colTable && !debtTable) tablesUnreadable = true
		const collaterals = colTable ? await readWitTableEntries(colTable) : []
		const debts = debtTable ? await readWitTableEntries(debtTable) : []
		for (const c of collaterals) allCoinTypes.add(c.coinType)
		for (const d of debts) allCoinTypes.add(d.coinType)
		pending.push({ oblId, collaterals, debts })
	}

	if (!pending.some((p) => p.collaterals.length || p.debts.length)) {
		return {
			...EMPTY_SCALLOP_SNAP,
			incomplete: true,
			error: tablesUnreadable
				? 'wit_table.id missing (wrapper id used?)'
				: 'tables empty / unreadable',
			metricsLive: false,
		}
	}

	const meta = new Map<string, { symbol: string; decimals: number }>()
	await Promise.all(
		[...allCoinTypes].map(async (ct) => {
			try {
				const m = await suiClient.getCoinMetadata({ coinType: ct })
				meta.set(ct, {
					symbol: m?.symbol ?? ct.split('::').pop() ?? '?',
					decimals: m?.decimals ?? 9,
				})
			} catch {
				meta.set(ct, { symbol: ct.split('::').pop() ?? '?', decimals: 9 })
			}
		}),
	)

	let spots = new Map<string, { price: number }>()
	try {
		spots = (await resolveSpots([...allCoinTypes], (ct) => meta.get(ct)?.symbol ?? ct)) as Map<
			string,
			{ price: number }
		>
	} catch {
		/* */
	}

	const px = (ct: string): number => {
		const hit = spots.get(ct)?.price
		if (hit != null && hit > 0) return hit
		for (const [k, v] of spots) {
			if (k.toLowerCase() === ct.toLowerCase() && v.price > 0) return v.price
		}
		return Number.NaN
	}

	const ltFactor = normalizeLiquidationThresholdFactor(DEFAULT_LT)
	let liquidationUSD = 0

	for (const p of pending) {
		let oblBorrow = 0
		let oblLiq = 0

		for (const c of p.collaterals) {
			const m = meta.get(c.coinType) ?? { symbol: '?', decimals: 9 }
			const amount = c.amountRaw / 10 ** m.decimals
			const price = px(c.coinType)
			const valueUSD = Number.isFinite(price) ? amount * price : Number.NaN
			if (Number.isFinite(valueUSD)) {
				totalSuppliedUSD += valueUSD
				oblLiq += valueUSD * ltFactor
				liquidationUSD += valueUSD * ltFactor
			}
			supplies.push({
				id: `scallop-supply-${p.oblId.slice(2, 10)}-${m.symbol}`,
				asset: m.symbol,
				coinType: c.coinType,
				sCoinType: '',
				suppliedAmount: amount,
				currentAmount: amount,
				earnedInterest: 0,
				earnedInterestUSD: 0,
				supplyAPR: 0,
				currentValueUSD: valueUSD,
				liquidationThresholdFactor: ltFactor,
				startedAt: 0,
				daysActive: 0,
				events: [],
				protocol: 'Scallop',
				iconUrl: null,
			})
		}

		for (const d of p.debts) {
			const m = meta.get(d.coinType) ?? { symbol: '?', decimals: 9 }
			const marketIdx =
				marketBorrowIndex.get(d.coinType.toLowerCase()) ??
				[...marketBorrowIndex.entries()].find(([k]) =>
					k.endsWith(d.coinType.split('::').slice(-2).join('::').toLowerCase()),
				)?.[1]
			const debtIdx = d.borrowIndex
			let amountRaw = d.amountRaw
			if (marketIdx && debtIdx && debtIdx > 0) {
				amountRaw = (d.amountRaw * marketIdx) / debtIdx
			}
			const amount = amountRaw / 10 ** m.decimals
			const price = px(d.coinType)
			const debtUSD = Number.isFinite(price) ? amount * price : Number.NaN
			if (Number.isFinite(debtUSD)) {
				oblBorrow += debtUSD
				totalBorrowedUSD += debtUSD
			}
			borrows.push({
				id: `scallop-borrow-${p.oblId.slice(2, 10)}-${m.symbol}`,
				obligationId: p.oblId,
				asset: m.symbol,
				coinType: d.coinType,
				borrowedAmount: amount,
				currentDebt: amount,
				accruedInterest: 0,
				accruedInterestUSD: 0,
				borrowAPR: 0,
				netBorrowCost: 0,
				currentDebtUSD: debtUSD,
				collateral: [],
				healthFactor: 0,
				liquidationThreshold: 0,
				startedAt: 0,
				daysActive: 0,
				events: [],
				protocol: 'Scallop',
				iconUrl: null,
			})
		}

		if (oblBorrow > 0 && oblLiq > 0) obligationHfs.push(oblLiq / oblBorrow)
	}

	const suppliesWithLiq = enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD)
	const collateral: CollateralInfo[] = suppliesWithLiq.map((s) => ({
		asset: s.asset,
		amount: s.currentAmount,
		valueUSD: Number.isFinite(s.currentValueUSD) ? s.currentValueUSD : 0,
		collateralWeight: 0,
		effectiveValueUSD: Number.isFinite(s.currentValueUSD) ? s.currentValueUSD : 0,
	}))
	const healthFactor =
		obligationHfs.length > 0
			? Math.min(...obligationHfs)
			: totalBorrowedUSD > 0 && liquidationUSD > 0
				? liquidationUSD / totalBorrowedUSD
				: null

	for (const b of borrows) {
		b.healthFactor = healthFactor ?? 0
		b.liquidationThreshold = liquidationUSD
		b.collateral = collateral
	}

	return {
		supplies: suppliesWithLiq,
		borrows,
		totalSuppliedUSD,
		totalBorrowedUSD,
		netValueUSD: totalSuppliedUSD - totalBorrowedUSD,
		healthFactor,
		rewardsToClaim: [],
		protocol: 'Scallop',
	}
}
