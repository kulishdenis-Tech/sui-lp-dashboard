/**
 * Scallop lending — ObligationKey → Obligation (collateral + debt).
 *
 * Package (initial): 0xefe8…fddf (docs.scallop.io mainnet addresses).
 * WitTable collateral/debt entries are dynamic fields; we page them and price via resolveSpots.
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
import { normalizeSuiAddress } from '@mysten/sui/utils'

export const SCALLOP_PROTOCOL_PKG =
	'0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf' as const
export const SCALLOP_OBLIGATION_KEY = `${SCALLOP_PROTOCOL_PKG}::obligation::ObligationKey` as const

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

function tableId(wrapper: unknown): string | null {
	const f = unwrap(wrapper)
	if (!f) return null
	const idW = f.id as Record<string, unknown> | undefined
	const id = idW?.id ?? f.id
	return typeof id === 'string' && id.startsWith('0x') ? id : null
}

function readU64(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v
	if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
	return 0
}

async function readWitTableEntries(
	parentId: string,
): Promise<Array<{ coinType: string; amountRaw: number }>> {
	const out: Array<{ coinType: string; amountRaw: number }> = []
	let cursor: string | null | undefined
	for (let page = 0; page < 20; page++) {
		const res = await suiClient.getDynamicFields({
			parentId,
			cursor: cursor ?? undefined,
			limit: 50,
		})
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
				if (coinType && amount > 0) out.push({ coinType, amountRaw: amount })
			}
		}
		if (!res.hasNextPage || !res.nextCursor) break
		cursor = res.nextCursor as string
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

	const keys = await listOwnedMoveObjects(asRpcObjectClient(suiClient), {
		owner,
		filter: { StructType: SCALLOP_OBLIGATION_KEY },
	})
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
	if (!obligationIds.length) return EMPTY_SCALLOP_SNAP

	const oblObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), obligationIds)

	const supplies: SupplyPosition[] = []
	const borrows: BorrowPosition[] = []
	let totalSuppliedUSD = 0
	let totalBorrowedUSD = 0
	const obligationHfs: number[] = []
	const allCoinTypes = new Set<string>()

	type Pending = {
		oblId: string
		collaterals: Array<{ coinType: string; amountRaw: number }>
		debts: Array<{ coinType: string; amountRaw: number }>
	}
	const pending: Pending[] = []

	for (let i = 0; i < oblObjs.length; i++) {
		const f = contentFields(oblObjs[i])
		if (!f) continue
		const oblId = obligationIds[i]!
		const colTable = tableId(f.collaterals)
		const debtTable = tableId(f.debts)
		const collaterals = colTable ? await readWitTableEntries(colTable) : []
		const debts = debtTable ? await readWitTableEntries(debtTable) : []
		for (const c of collaterals) allCoinTypes.add(c.coinType)
		for (const d of debts) allCoinTypes.add(d.coinType)
		pending.push({ oblId, collaterals, debts })
	}

	if (!pending.some((p) => p.collaterals.length || p.debts.length)) {
		// Keys found but tables empty / unreadable → surface partial empty book
		return { ...EMPTY_SCALLOP_SNAP }
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
			const amount = d.amountRaw / 10 ** m.decimals
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
