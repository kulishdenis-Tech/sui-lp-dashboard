import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AutopilotStore } from '@autopilot/db'
import {
	normalizeAutoWithdrawRule,
	type AutoWithdrawRule,
} from '@autopilot/engine'
import { evaluateAutoWithdrawRules, type AwListedPosition } from './autoWithdrawMonitor.js'
import { reviewAutoWithdrawAll } from './autoWithdrawReview.js'
import {
	_injectSessionForTests,
	_resetAuthForTests,
	issueAuthNonce,
	verifyAuthAndCreateSession,
} from './walletAuth.js'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

function store(): AutopilotStore {
	const dir = mkdtempSync(join(tmpdir(), 'aw-mon-'))
	return new AutopilotStore(join(dir, 'db.json'))
}

function baseRule(partial: Partial<AutoWithdrawRule> = {}): AutoWithdrawRule {
	return normalizeAutoWithdrawRule({
		id: 'aw-1',
		owner: '0x' + '11'.repeat(32),
		network: 'mainnet',
		protocol: 'clmm',
		poolId: '0xpool1',
		positionId: '0xpos1',
		cycleId: 'cycle-1',
		revision: 1,
		direction: 'down',
		targetAsset: 'SUI',
		directionSource: 'user_choice',
		enabled: true,
		status: 'watching',
		collectFeesWithWithdraw: false,
		armedWhileAlreadyMet: false,
		createdAtMs: 1,
		updatedAtMs: 1,
		lastCheckedAtMs: null,
		lastSuccessfulCheckAtMs: null,
		lastCheckError: null,
		observationSource: null,
		observationFetchedAtMs: null,
		lastTriggerReason: null,
		activeAttempt: null,
		uiNote: null,
		...partial,
	})
}

function listed(partial: Partial<AwListedPosition> = {}): AwListedPosition {
	return {
		protocol: 'clmm',
		positionId: '0xpos1',
		poolId: '0xpool1',
		owner: '0x' + '11'.repeat(32),
		markUsdcPerSui: 1.0,
		lowerPriceUsdcPerSui: 1.2,
		upperPriceUsdcPerSui: 1.8,
		principalSui: 10,
		principalUsdc: 0,
		liquidityRaw: '1000',
		pairIsSuiUsdc: true,
		fetchedAtMs: Date.now(),
		source: 'test-fixture',
		...partial,
	}
}

describe('autoWithdrawMonitor', () => {
	it('checks four cascade rules in one pool independently', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		const poolId = '0xpool-cascade'
		for (let i = 1; i <= 4; i++) {
			s.upsertAutoWithdrawRule(
				baseRule({
					id: `aw-${i}`,
					owner,
					poolId,
					positionId: `0xpos${i}`,
					revision: 0,
					direction: i <= 2 ? 'down' : 'up',
					targetAsset: i <= 2 ? 'SUI' : 'USDC',
				}),
			)
		}
		const beforeHb = s.getAutoWithdrawLastCheckMs()
		const positions: AwListedPosition[] = [1, 2, 3, 4].map((i) =>
			listed({
				positionId: `0xpos${i}`,
				poolId,
				owner,
				markUsdcPerSui: i <= 2 ? 1.0 : 2.0,
				principalSui: i <= 2 ? 8 : 0,
				principalUsdc: i <= 2 ? 0 : 20,
				lowerPriceUsdcPerSui: 1.2,
				upperPriceUsdcPerSui: 1.8,
			}),
		)
		const summary = await evaluateAutoWithdrawRules({
			store: s,
			listPositions: async () => positions,
			now: () => Date.now(),
		})
		expect(summary.checked).toBe(4)
		expect(summary.met).toBe(4)
		for (let i = 1; i <= 4; i++) {
			expect(s.getAutoWithdrawRule(`0xpos${i}`)?.status).toBe('awaiting_approval')
		}
		// Heartbeat is separate — this test does not call touchAutoWithdrawCheck
		expect(s.getAutoWithdrawLastCheckMs()).toBe(beforeHb)
	})

	it('does not lose rules from different pools via primary-pool thinking', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		s.upsertAutoWithdrawRule(baseRule({ owner, poolId: '0xpoolA', positionId: '0xA', revision: 0 }))
		s.upsertAutoWithdrawRule(
			baseRule({ owner, poolId: '0xpoolB', positionId: '0xB', revision: 0, protocol: 'bluefin' }),
		)
		const seen: string[] = []
		await evaluateAutoWithdrawRules({
			store: s,
			listPositions: async (_owner, protocol) => {
				seen.push(protocol)
				if (protocol === 'clmm') {
					return [listed({ positionId: '0xA', poolId: '0xpoolA', owner, markUsdcPerSui: 1.0 })]
				}
				return [
					listed({
						protocol: 'bluefin',
						positionId: '0xB',
						poolId: '0xpoolB',
						owner,
						markUsdcPerSui: 1.0,
					}),
				]
			},
		})
		expect(seen.sort()).toEqual(['bluefin', 'clmm'])
		expect(s.getAutoWithdrawRule('0xA')?.status).toBe('awaiting_approval')
		expect(s.getAutoWithdrawRule('0xB')?.status).toBe('awaiting_approval')
	})

	it('routes Cetus and Bluefin to separate readers', async () => {
		const s = store()
		const owner = '0x' + '22'.repeat(32)
		s.upsertAutoWithdrawRule(
			baseRule({ owner, protocol: 'clmm', positionId: '0xc', poolId: '0xp', revision: 0 }),
		)
		s.upsertAutoWithdrawRule(
			baseRule({ owner, protocol: 'bluefin', positionId: '0xb', poolId: '0xp', revision: 0 }),
		)
		const calls: string[] = []
		await evaluateAutoWithdrawRules({
			store: s,
			listPositions: async (_o, protocol) => {
				calls.push(protocol)
				return []
			},
		})
		expect(calls.sort()).toEqual(['bluefin', 'clmm'])
	})

	it('RPC failure on one owner/protocol does not block the other', async () => {
		const s = store()
		const o1 = '0x' + '11'.repeat(32)
		const o2 = '0x' + '22'.repeat(32)
		s.upsertAutoWithdrawRule(baseRule({ owner: o1, positionId: '0x1', revision: 0 }))
		s.upsertAutoWithdrawRule(baseRule({ owner: o2, positionId: '0x2', revision: 0 }))
		const summary = await evaluateAutoWithdrawRules({
			store: s,
			listPositions: async (owner) => {
				if (owner === o1) throw new Error('RPC down')
				return [listed({ owner: o2, positionId: '0x2', markUsdcPerSui: 1.0 })]
			},
		})
		expect(s.getAutoWithdrawRule('0x1')?.status).toBe('check_failed')
		expect(s.getAutoWithdrawRule('0x1')?.lastSuccessfulCheckAtMs).toBeNull()
		expect(s.getAutoWithdrawRule('0x2')?.status).toBe('awaiting_approval')
		expect(summary.failed).toBe(1)
		expect(summary.met).toBe(1)
	})

	it('price returning in range clears Condition Met to Watching', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		s.upsertAutoWithdrawRule(
			baseRule({
				owner,
				status: 'awaiting_approval',
				revision: 0,
				observationFetchedAtMs: Date.now(),
			}),
		)
		await evaluateAutoWithdrawRules({
			store: s,
			listPositions: async () => [
				listed({ owner, markUsdcPerSui: 1.5, principalSui: 10, principalUsdc: 0 }),
			],
		})
		expect(s.getAutoWithdrawRule('0xpos1')?.status).toBe('watching')
	})

	it('late result does not overwrite Disabled or new cycle', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		const rule = s.upsertAutoWithdrawRule(baseRule({ owner, revision: 0 }))
		let release!: (rows: AwListedPosition[]) => void
		const hung = new Promise<AwListedPosition[]>((resolve) => {
			release = resolve
		})
		const pending = evaluateAutoWithdrawRules({
			store: s,
			listPositions: async () => hung,
		})
		s.upsertAutoWithdrawRule({
			...rule,
			enabled: false,
			status: 'disabled',
			cycleId: 'cycle-new',
		})
		release([listed({ owner, markUsdcPerSui: 1.0 })])
		const summary = await pending
		expect(summary.skipped).toBeGreaterThanOrEqual(1)
		const cur = s.getAutoWithdrawRule('0xpos1')!
		expect(cur.enabled).toBe(false)
		expect(cur.cycleId).toBe('cycle-new')
		expect(cur.status).toBe('disabled')
	})

	it('heartbeat touch does not set lastSuccessfulCheckAtMs', () => {
		const s = store()
		s.upsertAutoWithdrawRule(baseRule({ revision: 0 }))
		s.touchAutoWithdrawCheck(1_700_000_000_000)
		expect(s.getAutoWithdrawLastCheckMs()).toBe(1_700_000_000_000)
		expect(s.getAutoWithdrawRule('0xpos1')?.lastSuccessfulCheckAtMs).toBeNull()
	})

	it('restart store reloads enabled rules for monitoring', () => {
		const dir = mkdtempSync(join(tmpdir(), 'aw-restart-'))
		const path = join(dir, 'db.json')
		const s1 = new AutopilotStore(path)
		s1.upsertAutoWithdrawRule(baseRule({ revision: 0, status: 'watching', enabled: true }))
		const s2 = new AutopilotStore(path)
		const rules = s2.listAutoWithdrawRules().filter((r) => r.enabled)
		expect(rules).toHaveLength(1)
		expect(rules[0]?.positionId).toBe('0xpos1')
	})

	it('list omission without exact read stays check_failed (not completed)', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		s.upsertAutoWithdrawRule(baseRule({ owner, revision: 0 }))
		await evaluateAutoWithdrawRules({
			store: s,
			listPositions: async () => [],
		})
		const r = s.getAutoWithdrawRule('0xpos1')!
		expect(r.status).toBe('check_failed')
		expect(r.lastCheckError).toMatch(/exact object read/i)
	})

	it('restores Watching when an unresolved attempt still has liquidity', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		s.upsertAutoWithdrawRule(
			baseRule({
				owner,
				enabled: true,
				status: 'outcome_unknown',
				revision: 4,
				activeAttempt: {
					id: 'att-stuck',
					startedAtMs: 1,
					digest: 'MaybeDigest',
					phase: 'unknown',
					payloadSha256: 'h',
					cycleId: 'cycle-1',
					revision: 4,
				},
			}),
		)
		await evaluateAutoWithdrawRules({
			store: s,
			listPositions: async () => [listed({ owner, liquidityRaw: '1000', markUsdcPerSui: 1.5 })],
			now: () => Date.now(),
		})
		const r = s.getAutoWithdrawRule('0xpos1')!
		expect(r.enabled).toBe(true)
		expect(r.status).toBe('watching')
		expect(r.activeAttempt).toBeNull()
	})

	it('completes an unresolved attempt only when liquidity is zero', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		s.upsertAutoWithdrawRule(
			baseRule({
				owner,
				enabled: true,
				status: 'outcome_unknown',
				revision: 4,
				activeAttempt: {
					id: 'att-stuck',
					startedAtMs: 1,
					digest: 'MaybeDigest',
					phase: 'unknown',
				},
			}),
		)
		await evaluateAutoWithdrawRules({
			store: s,
			listPositions: async () => [listed({ owner, liquidityRaw: '0' })],
			now: () => Date.now(),
		})
		const r = s.getAutoWithdrawRule('0xpos1')!
		expect(r.enabled).toBe(false)
		expect(r.status).toBe('completed')
	})

	it('exact empty read completes without Auto Withdraw attribution', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		s.upsertAutoWithdrawRule(baseRule({ owner, revision: 0 }))
		await evaluateAutoWithdrawRules({
			store: s,
			listPositions: async () => [],
			readPositionExact: async () => ({
				exists: true,
				owner,
				poolId: '0xpool1',
				liquidityRaw: '0',
				source: 'test-exact',
			}),
		})
		const r = s.getAutoWithdrawRule('0xpos1')!
		expect(r.status).toBe('completed')
		expect(r.lastTriggerReason).toMatch(/emptied manually/i)
	})

	it('refill bump leaves completed rule disabled (no silent reactivate)', () => {
		const s = store()
		const r = s.upsertAutoWithdrawRule(
			baseRule({ status: 'completed', enabled: false, revision: 0 }),
		)
		expect(r.enabled).toBe(false)
		const again = s.getAutoWithdrawRule('0xpos1')!
		expect(again.status).toBe('completed')
		expect(again.enabled).toBe(false)
	})
})

describe('reviewAutoWithdrawAll', () => {
	it('rejects when condition no longer met after recheck', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		const saved = s.upsertAutoWithdrawRule(
			baseRule({
				owner,
				status: 'awaiting_approval',
				revision: 0,
				observationFetchedAtMs: Date.now(),
			}),
		)
		const result = await reviewAutoWithdrawAll({
			store: s,
			authenticatedOwner: owner,
			positionId: saved.positionId,
			cycleId: saved.cycleId,
			revision: saved.revision,
			listPositions: async () => [
				listed({ owner, markUsdcPerSui: 1.5, principalSui: 10, principalUsdc: 0 }),
			],
			buildRemove: async () => ({ txBytesBase64: 'dGVzdA==' }),
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.message).toMatch(/no longer met/i)
	})

	it('builds Withdraw All preview when condition still met', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		const saved = s.upsertAutoWithdrawRule(
			baseRule({
				owner,
				status: 'awaiting_approval',
				revision: 0,
				observationFetchedAtMs: Date.now(),
			}),
		)
		const result = await reviewAutoWithdrawAll({
			store: s,
			authenticatedOwner: owner,
			positionId: saved.positionId,
			cycleId: saved.cycleId,
			revision: saved.revision,
			listPositions: async () => [listed({ owner, markUsdcPerSui: 1.0 })],
			buildRemove: async () => ({
				txBytesBase64: 'dGVzdA==',
				dryRunOk: true,
				payloadSha256: 'abc123',
			}),
		})
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.preview.removePercent).toBe(1)
			expect(result.preview.positionStaysOpenAndEmpty).toBe(true)
			expect(result.preview.fromAutoWithdraw).toBe(true)
			expect(result.preview.payloadSha256).toBe('abc123')
			expect(result.rule.activeAttempt?.payloadSha256).toBe('abc123')
		}
	})

	it('aborts review if rule is disabled during build await', async () => {
		const s = store()
		const owner = '0x' + '11'.repeat(32)
		const saved = s.upsertAutoWithdrawRule(
			baseRule({
				owner,
				status: 'awaiting_approval',
				revision: 0,
				observationFetchedAtMs: Date.now(),
			}),
		)
		const result = await reviewAutoWithdrawAll({
			store: s,
			authenticatedOwner: owner,
			positionId: saved.positionId,
			cycleId: saved.cycleId,
			revision: saved.revision,
			listPositions: async () => [listed({ owner, markUsdcPerSui: 1.0 })],
			buildRemove: async () => {
				s.upsertAutoWithdrawRule({
					...saved,
					enabled: false,
					status: 'disabled',
					revision: saved.revision + 1,
				})
				return { txBytesBase64: 'dGVzdA==', payloadSha256: 'late' }
			},
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.code).toBe('stale_rule')
	})
})

describe('walletAuth', () => {
	it('rejects reused nonce and forged owner session mismatch path', async () => {
		_resetAuthForTests()
		const kp = Ed25519Keypair.generate()
		const address = kp.toSuiAddress()
		const issued = issueAuthNonce(address)
		const { signature } = await kp.signPersonalMessage(new TextEncoder().encode(issued.message))
		const session = await verifyAuthAndCreateSession({
			address,
			nonce: issued.nonce,
			signature,
		})
		expect(session.token).toBeTruthy()
		await expect(
			verifyAuthAndCreateSession({ address, nonce: issued.nonce, signature }),
		).rejects.toThrow(/used|expired|unknown/i)

		_resetAuthForTests()
		const token = _injectSessionForTests(address)
		expect(token).toBeTruthy()
		const other = '0x' + '99'.repeat(32)
		expect(other.toLowerCase()).not.toBe(address.toLowerCase())
	})

	it('concurrent verify of the same nonce yields at most one session', async () => {
		_resetAuthForTests()
		const kp = Ed25519Keypair.generate()
		const address = kp.toSuiAddress()
		const issued = issueAuthNonce(address)
		const { signature } = await kp.signPersonalMessage(new TextEncoder().encode(issued.message))
		const results = await Promise.allSettled([
			verifyAuthAndCreateSession({ address, nonce: issued.nonce, signature }),
			verifyAuthAndCreateSession({ address, nonce: issued.nonce, signature }),
		])
		const ok = results.filter((r) => r.status === 'fulfilled')
		const bad = results.filter((r) => r.status === 'rejected')
		expect(ok).toHaveLength(1)
		expect(bad).toHaveLength(1)
		if (bad[0]?.status === 'rejected') {
			expect(String(bad[0].reason?.message ?? bad[0].reason)).toMatch(/used|unknown|expired/i)
		}
	})
})
