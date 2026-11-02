import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	cascadeBatchKey,
	clearCascadeBatchJournal,
	createCascadeBatchJournal,
	digestsFromJournal,
	journalHasUnknown,
	loadCascadeBatchJournal,
	markJournalStep,
} from './cascadeBatchJournal'

function installMemoryLocalStorage(): void {
	const store = new Map<string, string>()
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => {
			store.set(k, String(v))
		},
		removeItem: (k: string) => {
			store.delete(k)
		},
		clear: () => store.clear(),
		key: (i: number) => [...store.keys()][i] ?? null,
		get length() {
			return store.size
		},
	})
}

describe('cascadeBatchJournal', () => {
	beforeEach(() => {
		installMemoryLocalStorage()
		clearCascadeBatchJournal()
	})

	it('persists success digests across load', () => {
		const j = createCascadeBatchJournal({
			cascadeId: 'casc-1',
			actionKind: 'remove',
			owner: '0xOwner',
			network: 'mainnet',
			memberPositionIds: ['0xa', '0xb'],
		})
		markJournalStep(j, 0, { digest: 'DigestOne', outcome: 'success' })
		const key = cascadeBatchKey({
			cascadeId: 'casc-1',
			actionKind: 'remove',
			owner: '0xOwner',
			network: 'mainnet',
			memberPositionIds: ['0xa', '0xb'],
		})
		const loaded = loadCascadeBatchJournal(key)
		expect(digestsFromJournal(loaded)).toEqual({ 0: 'DigestOne' })
		expect(journalHasUnknown(loaded)).toBe(false)
	})

	it('blocks continuation when a step is unknown', () => {
		const j = createCascadeBatchJournal({
			cascadeId: 'casc-1',
			actionKind: 'close',
			owner: '0xowner',
			network: 'mainnet',
			memberPositionIds: ['0xa'],
		})
		const next = markJournalStep(j, 0, { digest: 'D', outcome: 'unknown' })
		expect(journalHasUnknown(next)).toBe(true)
	})

	it('does not reuse journal for a different action or member set', () => {
		createCascadeBatchJournal({
			cascadeId: 'casc-1',
			actionKind: 'remove',
			owner: '0xowner',
			network: 'mainnet',
			memberPositionIds: ['0xa', '0xb'],
		})
		const otherKey = cascadeBatchKey({
			cascadeId: 'casc-1',
			actionKind: 'close',
			owner: '0xowner',
			network: 'mainnet',
			memberPositionIds: ['0xa', '0xb'],
		})
		expect(loadCascadeBatchJournal(otherKey)).toBeNull()
	})
})
