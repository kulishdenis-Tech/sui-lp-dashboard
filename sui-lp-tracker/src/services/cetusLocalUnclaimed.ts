/**
 * Cetus unclaimed fees from pool + 2 boundary ticks + PositionInfo DF (no devInspect).
 * Falls back to null when ticks / growth fields are missing.
 */

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { PROTOCOL_PACKAGES } from '@/utils/constants'
import { computeFeeGrowthInside, computeTotalOwed } from '@/clmm/feeGrowth'

const I32_TYPES = [
	'0x714a63a0dba6da4fce08a1ec21d39416e734f29654e45d37d1d2023922fca2d0::i32::I32',
	`${PROTOCOL_PACKAGES.CETUS_CLMM}::i32::I32`,
] as const

function unwrap(val: unknown): Record<string, unknown> | null {
	if (!val || typeof val !== 'object') return null
	const o = val as Record<string, unknown>
	if (o.fields && typeof o.fields === 'object') return o.fields as Record<string, unknown>
	return o
}

function readU(v: unknown): bigint {
	const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '0'
	try {
		return BigInt(s)
	} catch {
		return 0n
	}
}

function tickBits(tick: number): number {
	return tick >>> 0
}

async function readTickOutside(
	client: SuiJsonRpcClient,
	ticksHandle: string,
	tick: number,
): Promise<{ a: bigint; b: bigint } | null> {
	for (const type of I32_TYPES) {
		try {
			const obj = await client.getDynamicFieldObject({
				parentId: ticksHandle,
				name: { type, value: { bits: tickBits(tick) } },
			})
			const content = obj.data?.content as { fields?: unknown } | undefined
			const fields = unwrap(content?.fields ?? content)
			const tickFields = unwrap(fields?.value ?? fields)
			if (!tickFields) continue
			const a = readU(tickFields.fee_growth_outside_a)
			const b = readU(tickFields.fee_growth_outside_b)
			return { a, b }
		} catch {
			/* try next type */
		}
	}
	return null
}

export type CetusLocalAccrued = {
	ok: true
	feeOwedA: string
	feeOwedB: string
	source: 'local_fee_growth'
}

export async function fetchCetusLocalAccrued(
	client: SuiJsonRpcClient,
	args: {
		positionId: string
		positionsHandle: string
		ticksHandle?: string
		feeGrowthGlobalA?: string
		feeGrowthGlobalB?: string
		currentTick: number
		lowerTick: number
		upperTick: number
		liquidity: string
	},
): Promise<CetusLocalAccrued | { ok: false; error: string }> {
	if (!args.ticksHandle || args.feeGrowthGlobalA == null || args.feeGrowthGlobalB == null) {
		return { ok: false, error: 'missing_pool_growth_or_ticks_handle' }
	}
	try {
		const posObj = await client.getDynamicFieldObject({
			parentId: args.positionsHandle,
			name: { type: '0x2::object::ID', value: args.positionId },
		})
		const content = posObj.data?.content as { fields?: unknown } | undefined
		const fields = unwrap(unwrap(content?.fields ?? content)?.value ?? content?.fields)
		if (!fields) return { ok: false, error: 'position_info_missing' }

		const feeOwnedA = String(fields.fee_owned_a ?? '0')
		const feeOwnedB = String(fields.fee_owned_b ?? '0')
		const fgiLastA = readU(fields.fee_growth_inside_a)
		const fgiLastB = readU(fields.fee_growth_inside_b)
		const liq = String(fields.liquidity ?? args.liquidity)

		const [lo, hi] = await Promise.all([
			readTickOutside(client, args.ticksHandle, args.lowerTick),
			readTickOutside(client, args.ticksHandle, args.upperTick),
		])
		if (!lo || !hi) return { ok: false, error: 'boundary_ticks_missing' }

		const nowA = computeFeeGrowthInside(
			readU(args.feeGrowthGlobalA),
			lo.a,
			hi.a,
			args.lowerTick,
			args.upperTick,
			args.currentTick,
		)
		const nowB = computeFeeGrowthInside(
			readU(args.feeGrowthGlobalB),
			lo.b,
			hi.b,
			args.lowerTick,
			args.upperTick,
			args.currentTick,
		)
		return {
			ok: true,
			source: 'local_fee_growth',
			feeOwedA: computeTotalOwed(feeOwnedA, nowA, fgiLastA, liq, 64),
			feeOwedB: computeTotalOwed(feeOwnedB, nowB, fgiLastB, liq, 64),
		}
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}
