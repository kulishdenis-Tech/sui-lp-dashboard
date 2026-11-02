import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AW_DEFAULT_EXECUTION_PERMISSION,
	normalizeAutoWithdrawRule,
	type AutoWithdrawRule,
} from '@autopilot/engine'
import {
	_resetAwWriteGuardsForTests,
	applyServerRules,
	getAutoWithdrawRule,
	persistAutoWithdrawRule,
} from './autoWithdrawStore'

function memoryStore() {
	const map = new Map<string, string>()
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => {
			map.set(k, String(v))
		},
		removeItem: (k: string) => {
			map.delete(k)
		},
		clear: () => map.clear(),
	}
}

function rule(partial: Partial<AutoWithdrawRule> = {}): AutoWithdrawRule {
	return normalizeAutoWithdrawRule({
		id: 'aw-1',
		owner: '0x' + '11'.repeat(32),
		network: 'mainnet',
		protocol: 'clmm',
		poolId: '0x' + 'aa'.repeat(32),
		positionId: '0x' + 'bb'.repeat(32),
		cycleId: 'cycle-1',
		revision: 2,
		direction: 'down',
		targetAsset: 'SUI',
		directionSource: 'user_choice',
		enabled: true,
		status: 'watching',
		collectFeesWithWithdraw: false,
		armedWhileAlreadyMet: false,
		createdAtMs: 1,
		updatedAtMs: 1,
		lastCheckedAtMs: 1,
		lastSuccessfulCheckAtMs: 1,
		lastCheckError: null,
		observationSource: null,
		observationFetchedAtMs: null,
		lastTriggerReason: null,
		activeAttempt: {
			id: 'a1',
			startedAtMs: 1,
			digest: null,
			phase: 'preview',
			acceptNonce: 'n',
		},
		uiNote: null,
		executionPermission: { ...AW_DEFAULT_EXECUTION_PERMISSION },
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
		...partial,
	})
}

describe('persistAutoWithdrawRule', () => {
	beforeEach(() => {
		_resetAwWriteGuardsForTests()
		const ls = memoryStore()
		const ss = memoryStore()
		vi.stubGlobal('localStorage', ls)
		vi.stubGlobal('sessionStorage', ss)
		ss.setItem(
			'sui-lp-autopilot.aw-auth.v1',
			JSON.stringify({
				token: 'tok',
				address: rule().owner,
				expiresAtMs: Date.now() + 60_000,
			}),
		)
		ls.setItem('sui-lp-autopilot.auto-withdraw.v1', JSON.stringify({ rules: [rule()] }))
		vi.stubGlobal('fetch', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		_resetAwWriteGuardsForTests()
	})

	it('disable success applies server rule and awaits confirmation', async () => {
		const serverRule = rule({
			enabled: false,
			status: 'disabled',
			revision: 3,
			activeAttempt: null,
		})
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ rule: serverRule }),
		} as Response)

		const result = await persistAutoWithdrawRule(rule({ enabled: false, status: 'disabled' }))
		expect(result.ok).toBe(true)
		expect(result.serverSynced).toBe(true)
		expect(result.rule?.enabled).toBe(false)
		expect(result.rule?.revision).toBe(3)
		expect(getAutoWithdrawRule(serverRule.positionId)?.enabled).toBe(false)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('401 expired auth reverts local disable and surfaces error', async () => {
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: async () => ({ error: 'expired', code: 'AUTH_REQUIRED' }),
		} as Response)

		const result = await persistAutoWithdrawRule(rule({ enabled: false }))
		expect(result.ok).toBe(false)
		expect(result.code).toBe('AUTH_EXPIRED')
		expect(result.error).toMatch(/Session expired/i)
		expect(getAutoWithdrawRule(rule().positionId)?.enabled).toBe(true)
		expect(sessionStorage.getItem('sui-lp-autopilot.aw-auth.v1')).toBeNull()
	})

	it('network failure reverts and does not claim success', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('Failed to fetch'))
		const result = await persistAutoWithdrawRule(rule({ enabled: false }))
		expect(result.ok).toBe(false)
		expect(result.code).toBe('NETWORK')
		expect(getAutoWithdrawRule(rule().positionId)?.enabled).toBe(true)
	})

	it('late GET cannot overwrite an in-flight disable', async () => {
		let resolvePut!: (v: unknown) => void
		const putPromise = new Promise((r) => {
			resolvePut = r
		})
		vi.mocked(fetch).mockImplementationOnce(() => putPromise as Promise<Response>)

		const persistP = persistAutoWithdrawRule(rule({ enabled: false }))
		/* While PUT pending, a GET merge must not restore enabled:true */
		applyServerRules([rule({ enabled: true, revision: 2 })])
		expect(getAutoWithdrawRule(rule().positionId)?.enabled).toBe(false)

		resolvePut({
			ok: true,
			status: 200,
			json: async () => ({
				rule: rule({ enabled: false, status: 'disabled', revision: 4, activeAttempt: null }),
			}),
		})
		const result = await persistP
		expect(result.ok).toBe(true)
		expect(getAutoWithdrawRule(rule().positionId)?.enabled).toBe(false)
		expect(getAutoWithdrawRule(rule().positionId)?.revision).toBe(4)
	})
})
