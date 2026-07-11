import { normalizeSuiAddress } from '@mysten/sui/utils'

/** Тіло NFT позиції з RPC: канонічний objectId + move fields. */
export type MomentumOwnedBody = { objectId: string; fields: Record<string, unknown> }

/**
 * Витягує 0x-ідентифікатор з Move-значення в Sui JSON: рядок, UID з полем `id`,
 * або `fields.id` (типовий вигляд `0x2::object::UID`).
 */
export function readSuiHexIdFromMoveValue(v: unknown): string | null {
	if (typeof v === 'string') {
		const t = v.trim()
		if (t.startsWith('0x')) return t
		return null
	}
	if (!v || typeof v !== 'object') return null
	const o = v as Record<string, unknown>
	if (typeof o.id === 'string' && o.id.startsWith('0x')) return o.id.trim()
	const f = o.fields
	if (f && typeof f === 'object') {
		const id = (f as Record<string, unknown>).id
		if (typeof id === 'string' && id.startsWith('0x')) return id.trim()
	}
	return null
}

/** Повний struct type з `SuiObjectData` / moveObject content (RPC варіанти). */
export function ownedObjectDataMoveType(data: unknown): string {
	const d = data as {
		type?: unknown
		content?: { dataType?: unknown; type?: unknown }
	} | null
		| undefined
	if (!d) return ''
	if (typeof d.type === 'string' && d.type.length > 0) return d.type.trim()
	const c = d.content
	if (c && typeof c === 'object' && (c as { dataType?: string }).dataType === 'moveObject') {
		const t = (c as { type?: unknown }).type
		if (typeof t === 'string' && t.length > 0) return t.trim()
	}
	return ''
}

export function readMomentumPoolIdFromMoveFields(fields: Record<string, unknown>): string | null {
	for (const key of ['pool_id', 'poolId'] as const) {
		const got = readSuiHexIdFromMoveValue(fields[key])
		if (got) return got
	}
	return null
}

/**
 * Object id NFT позиції: завжди з RPC квитанції (`objectId`), інакше з поля `id` у content.
 */
export function readMomentumPositionNftObjectId(opts: {
	rpcObjectId: string | null | undefined
	fields: Record<string, unknown>
}): string | null {
	const trimmed = opts.rpcObjectId?.trim()
	if (trimmed) {
		try {
			return normalizeSuiAddress(trimmed)
		} catch {
			return trimmed
		}
	}
	const inner = readSuiHexIdFromMoveValue(opts.fields.id)
	if (!inner) return null
	try {
		return normalizeSuiAddress(inner)
	} catch {
		return inner
	}
}

/** SDK `fetchRewards` читає `positionData.id.id` — гарантуємо цей shape (нормалізована адреса). */
export function ensureUidFieldForSdk(idField: unknown, fallbackObjectId: string): { id: string } {
	const inner = readSuiHexIdFromMoveValue(idField)
	const raw = inner?.trim() || fallbackObjectId.trim()
	if (!raw.startsWith('0x')) {
		try {
			return { id: normalizeSuiAddress(fallbackObjectId.trim()) }
		} catch {
			return { id: fallbackObjectId.trim() }
		}
	}
	try {
		return { id: normalizeSuiAddress(raw) }
	} catch {
		return { id: raw }
	}
}

/** Поля позиції для devInspect collect у SDK: нормалізовані `pool_id` та `id`. */
export function fieldsForMomentumSdkFetchRewards(
	fields: Record<string, unknown>,
	rpcObjectId: string,
): Record<string, unknown> {
	const poolStr = readMomentumPoolIdFromMoveFields(fields)
	const idShape = ensureUidFieldForSdk(fields.id, rpcObjectId)
	return {
		...fields,
		id: idShape,
		...(poolStr ? { pool_id: poolStr } : {}),
	}
}
