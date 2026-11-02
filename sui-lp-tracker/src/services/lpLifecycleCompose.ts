import type { LpAction, LpPositionLifecycle } from '@/types/lpLifecycle'

function lifecycleSortKey(a: LpAction, b: LpAction): number {
	const at = Number.isFinite(a.timestampMs) ? a.timestampMs : 0
	const bt = Number.isFinite(b.timestampMs) ? b.timestampMs : 0
	if (at !== bt) return at - bt
	const dq = `${a.txDigest}`.localeCompare(`${b.txDigest}`)
	if (dq !== 0) return dq
	return `${a.eventSeq ?? ''}`.localeCompare(`${b.eventSeq ?? ''}`)
}

/** Групування `dex + positionId` → lifecycle (експортовано для тестів / подальших метрик). */
export function buildLpPositionLifecycles(actions: LpAction[]): LpPositionLifecycle[] {
	const byKey = new Map<string, LpAction[]>()
	for (const a of actions) {
		const k = `${a.dex}:${a.positionId}`
		const arr = byKey.get(k) ?? []
		arr.push(a)
		byKey.set(k, arr)
	}

	const out: LpPositionLifecycle[] = []
	for (const [k, listRaw] of byKey) {
		const actionsSorted = [...listRaw].sort(lifecycleSortKey)
		const sep = k.indexOf(':')
		const dexPart = sep >= 0 ? k.slice(0, sep) : k
		const positionId = sep >= 0 ? k.slice(sep + 1) : ''

		let poolId: string | null = null
		for (const ra of actionsSorted) {
			if (ra.poolId) {
				poolId = ra.poolId
				break
			}
		}

		let openedAtMs = 0
		const openGuess = actionsSorted.find((ra) => ra.actionType === 'OPEN_POSITION')
		const addGuess = actionsSorted.find((ra) => ra.actionType === 'ADD_LIQUIDITY')
		const firstGuess = actionsSorted[0]
		if (openGuess?.timestampMs) openedAtMs = openGuess.timestampMs
		else if (addGuess?.timestampMs) openedAtMs = addGuess.timestampMs
		else if (firstGuess?.timestampMs) openedAtMs = firstGuess.timestampMs

		const closeEv = [...actionsSorted].reverse().find((ra) => ra.actionType === 'CLOSE_POSITION')
		const closed = closeEv != null
		const closedAtMs =
			closeEv?.timestampMs ??
			(actionsSorted.length ? actionsSorted[actionsSorted.length - 1]!.timestampMs || 0 : 0)

		out.push({
			dex: dexPart as LpPositionLifecycle['dex'],
			positionId,
			poolId,
			actions: actionsSorted,
			openedAtMs,
			closedAtMs,
			isClosed: closed,
		})
	}
	return out.sort((a, b) => b.closedAtMs - a.closedAtMs)
}
