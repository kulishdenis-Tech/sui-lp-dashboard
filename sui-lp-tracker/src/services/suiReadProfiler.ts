/**
 * Optional RPC read profiling for advisor / snapshot tuning.
 * Enable: SUI_LP_ADVISOR_PROFILE=1
 */

export type SuiReadProfileSnapshot = {
	enabled: boolean
	getObject: number
	multiGetObjects: number
	getOwnedObjects: number
	queryEvents: number
	devInspect: number
	graphql: number
	other: number
	elapsedMs: number
}

let t0 = 0
const counts = {
	getObject: 0,
	multiGetObjects: 0,
	getOwnedObjects: 0,
	queryEvents: 0,
	devInspect: 0,
	graphql: 0,
	other: 0,
}

export function isSuiReadProfilingEnabled(): boolean {
	const v =
		(typeof process !== 'undefined' && process.env?.SUI_LP_ADVISOR_PROFILE) ||
		(typeof import.meta !== 'undefined' &&
			(import.meta as { env?: Record<string, string> }).env?.SUI_LP_ADVISOR_PROFILE)
	return v === '1' || v === 'true'
}

export function resetSuiReadProfile(): void {
	t0 = performance.now()
	counts.getObject = 0
	counts.multiGetObjects = 0
	counts.getOwnedObjects = 0
	counts.queryEvents = 0
	counts.devInspect = 0
	counts.graphql = 0
	counts.other = 0
}

export function recordSuiRead(method: string, batchSize = 1): void {
	if (!isSuiReadProfilingEnabled()) return
	const n = Math.max(1, batchSize)
	switch (method) {
		case 'getObject':
			counts.getObject += n
			break
		case 'multiGetObjects':
			counts.multiGetObjects += n
			break
		case 'getOwnedObjects':
			counts.getOwnedObjects += n
			break
		case 'queryEvents':
			counts.queryEvents += n
			break
		case 'devInspectTransactionBlock':
			counts.devInspect += n
			break
		case 'graphql':
			counts.graphql += n
			break
		default:
			counts.other += n
	}
}

export function snapshotSuiReadProfile(): SuiReadProfileSnapshot {
	return {
		enabled: isSuiReadProfilingEnabled(),
		...counts,
		elapsedMs: t0 > 0 ? performance.now() - t0 : 0,
	}
}

export function logSuiReadProfile(label: string): SuiReadProfileSnapshot {
	const snap = snapshotSuiReadProfile()
	if (!snap.enabled) return snap
	console.log(
		`[sui-read-profile] ${label}: ` +
			JSON.stringify({
				getObject: snap.getObject,
				multiGetObjects: snap.multiGetObjects,
				getOwnedObjects: snap.getOwnedObjects,
				queryEvents: snap.queryEvents,
				devInspect: snap.devInspect,
				graphql: snap.graphql,
				other: snap.other,
				elapsedMs: Math.round(snap.elapsedMs),
			}),
	)
	return snap
}

export function _resetSuiReadProfileForTests(): void {
	t0 = 0
	resetSuiReadProfile()
}
