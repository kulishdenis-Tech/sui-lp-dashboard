/** Pure sync decisions so a stale address response or a paused backfill cannot commit. */

export function isCurrentGeneration(requested: number, current: number): boolean {
	return requested === current
}

export type BackfillCursor = {
	before: string | null
	hasOlder: boolean
	pages: number
	paused: boolean
}

export function canBackfill(state: BackfillCursor, cap: number): boolean {
	return !state.paused && state.pages < cap && state.hasOlder && !!state.before
}

export type SyncProgress = {
	olderCursor: string | null
	hasOlder: boolean
	newestMs: number | null
	oldestMs: number | null
	seenCursors: string[]
}

export type PageCommit = {
	mode: 'refresh' | 'older'
	requestedCursor: string | null
	olderCursor: string | null
	hasOlder: boolean
	count: number
	timestamps: number[]
}

/** Refresh keeps the saved older cursor. An empty or repeated cursor does not advance. */
export function commitPageProgress(
	prev: SyncProgress,
	page: PageCommit,
): { progress: SyncProgress; advanced: boolean; stopReason: 'empty' | 'cursor_repeat' | null } {
	const newest = maxTime(prev.newestMs, ...page.timestamps)
	const oldest = minTime(prev.oldestMs, ...page.timestamps)
	if (page.mode === 'refresh') {
		return {
			advanced: page.count > 0,
			stopReason: null,
			progress: {
				olderCursor: prev.olderCursor ?? page.olderCursor,
				hasOlder: prev.olderCursor ? prev.hasOlder : page.hasOlder,
				newestMs: newest,
				oldestMs: prev.oldestMs ?? oldest,
				seenCursors: prev.seenCursors,
			},
		}
	}
	if (page.count === 0) {
		return { progress: { ...prev, newestMs: newest, oldestMs: oldest }, advanced: false, stopReason: 'empty' }
	}
	const nextCursor = page.olderCursor
	if (!nextCursor || nextCursor === page.requestedCursor || prev.seenCursors.includes(nextCursor)) {
		return {
			progress: { ...prev, hasOlder: false, newestMs: newest, oldestMs: oldest },
			advanced: false,
			stopReason: 'cursor_repeat',
		}
	}
	return {
		advanced: true,
		stopReason: null,
		progress: {
			olderCursor: nextCursor,
			hasOlder: page.hasOlder,
			newestMs: newest,
			oldestMs: oldest,
			seenCursors: [...prev.seenCursors, page.requestedCursor ?? ''].filter(Boolean),
		},
	}
}

function minTime(...values: Array<number | null>): number | null {
	const nums = values.filter((v): v is number => v != null)
	return nums.length ? Math.min(...nums) : null
}

function maxTime(...values: Array<number | null>): number | null {
	const nums = values.filter((v): v is number => v != null)
	return nums.length ? Math.max(...nums) : null
}

/** At most three attempts. Only HTTP 429 and 503 wait. */
export function retryDelayMs(attempt: number, status: number | null): number | null {
	if (attempt >= 3) return null
	if (status !== 429 && status !== 503) return null
	return Math.min(400 * 2 ** attempt, 4000)
}

export function createSingleFlight() {
	let current: Promise<unknown> | null = null
	return async function run<T>(fn: () => Promise<T>, mode: 'exclusive' | 'replace' = 'exclusive'): Promise<T | 'busy'> {
		if (current && mode !== 'replace') return 'busy'
		const task = fn().finally(() => {
			if (current === task) current = null
		})
		current = task
		return task
	}
}

/** A null page means the in-flight request was discarded (address change or failure). */
export function advanceBackfill(
	state: BackfillCursor,
	page: { olderCursor: string | null; hasOlder: boolean; advanced?: boolean } | null,
): BackfillCursor {
	if (page == null || page.advanced === false) return { ...state, paused: true }
	return {
		before: page.olderCursor,
		hasOlder: page.hasOlder,
		pages: state.pages + 1,
		paused: state.paused,
	}
}
