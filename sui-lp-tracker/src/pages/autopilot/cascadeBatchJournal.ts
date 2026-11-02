/**
 * Durable cascade manage batch progress (survives reload / reopening the drawer).
 * Unknown steps block continuation until reconciled — never auto-rebroadcast.
 */

export type CascadeBatchStepOutcome = 'pending' | 'success' | 'failed' | 'unknown'

export type CascadeBatchStepRecord = {
	positionId: string
	digest: string | null
	outcome: CascadeBatchStepOutcome
	payloadSha256: string | null
	updatedAtMs: number
}

export type CascadeBatchJournal = {
	batchKey: string
	cascadeId: string
	actionKind: string
	owner: string
	network: 'mainnet' | 'testnet'
	memberPositionIds: string[]
	steps: CascadeBatchStepRecord[]
	updatedAtMs: number
}

const KEY = 'sui-lp-autopilot.cascade-batch-journal.v1'

export function cascadeBatchKey(input: {
	cascadeId: string
	actionKind: string
	owner: string
	network: string
	memberPositionIds: string[]
}): string {
	const members = input.memberPositionIds.map((id) => id.toLowerCase()).join(',')
	return [
		input.cascadeId.toLowerCase(),
		input.actionKind,
		input.owner.toLowerCase(),
		input.network,
		members,
	].join('|')
}

export function loadCascadeBatchJournal(batchKey: string): CascadeBatchJournal | null {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw) as CascadeBatchJournal
		if (!parsed || parsed.batchKey !== batchKey) return null
		if (!Array.isArray(parsed.steps)) return null
		return parsed
	} catch {
		return null
	}
}

export function saveCascadeBatchJournal(journal: CascadeBatchJournal): void {
	localStorage.setItem(KEY, JSON.stringify({ ...journal, updatedAtMs: Date.now() }))
}

export function clearCascadeBatchJournal(batchKey?: string): void {
	try {
		if (typeof localStorage === 'undefined') return
		if (!batchKey) {
			localStorage.removeItem(KEY)
			return
		}
		const raw = localStorage.getItem(KEY)
		if (!raw) return
		const parsed = JSON.parse(raw) as CascadeBatchJournal
		if (parsed?.batchKey === batchKey) localStorage.removeItem(KEY)
	} catch {
		try {
			if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY)
		} catch {
			/* ignore */
		}
	}
}

/** Digests that completed successfully — skip on resume. */
export function digestsFromJournal(journal: CascadeBatchJournal | null): Record<number, string> {
	if (!journal) return {}
	const out: Record<number, string> = {}
	for (let i = 0; i < journal.steps.length; i++) {
		const s = journal.steps[i]
		if (s?.outcome === 'success' && s.digest) out[i] = s.digest
	}
	return out
}

/** True when any step is unknown — must reconcile before continuing. */
export function journalHasUnknown(journal: CascadeBatchJournal | null): boolean {
	return !!journal?.steps.some((s) => s.outcome === 'unknown')
}

export function markJournalStep(
	journal: CascadeBatchJournal,
	stepIndex: number,
	patch: Partial<CascadeBatchStepRecord>,
): CascadeBatchJournal {
	const steps = journal.steps.map((s, i) =>
		i === stepIndex
			? {
					...s,
					...patch,
					updatedAtMs: Date.now(),
				}
			: s,
	)
	const next: CascadeBatchJournal = {
		...journal,
		steps,
		updatedAtMs: Date.now(),
	}
	saveCascadeBatchJournal(next)
	return next
}

export function createCascadeBatchJournal(input: {
	cascadeId: string
	actionKind: string
	owner: string
	network: 'mainnet' | 'testnet'
	memberPositionIds: string[]
}): CascadeBatchJournal {
	const batchKey = cascadeBatchKey(input)
	const existing = loadCascadeBatchJournal(batchKey)
	if (existing) return existing
	const journal: CascadeBatchJournal = {
		batchKey,
		cascadeId: input.cascadeId,
		actionKind: input.actionKind,
		owner: input.owner.toLowerCase(),
		network: input.network,
		memberPositionIds: input.memberPositionIds.map((id) => id.toLowerCase()),
		steps: input.memberPositionIds.map((positionId) => ({
			positionId: positionId.toLowerCase(),
			digest: null,
			outcome: 'pending',
			payloadSha256: null,
			updatedAtMs: Date.now(),
		})),
		updatedAtMs: Date.now(),
	}
	saveCascadeBatchJournal(journal)
	return journal
}
