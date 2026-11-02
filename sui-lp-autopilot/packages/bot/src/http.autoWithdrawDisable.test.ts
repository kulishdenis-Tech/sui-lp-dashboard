import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AutopilotStore } from '@autopilot/db'
import { normalizeAutoWithdrawRule, type AutoWithdrawRule } from '@autopilot/engine'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { startApi } from './http.js'
import { _resetAuthForTests } from './walletAuth.js'
import { evaluateAutoWithdrawRules } from './autoWithdrawMonitor.js'

function rule(owner: string, partial: Partial<AutoWithdrawRule> = {}): AutoWithdrawRule {
	return normalizeAutoWithdrawRule({
		id: 'aw-1',
		owner,
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
		observationSource: 't',
		observationFetchedAtMs: 1,
		lastTriggerReason: null,
		activeAttempt: {
			id: 'att-preview',
			startedAtMs: 1,
			digest: null,
			phase: 'preview',
			payloadSha256: 'h',
			acceptNonce: 'n1',
		},
		uiNote: null,
		...partial,
	})
}

async function sessionFor(kp: Ed25519Keypair, base: string): Promise<string> {
	const owner = kp.toSuiAddress()
	const nonceRes = await fetch(`${base}/api/auth/nonce?address=${encodeURIComponent(owner)}`)
	const issued = (await nonceRes.json()) as { nonce: string; message: string }
	const { signature } = await kp.signPersonalMessage(new TextEncoder().encode(issued.message))
	const verify = await fetch(`${base}/api/auth/verify`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ address: owner, nonce: issued.nonce, signature }),
	})
	const session = (await verify.json()) as { token: string }
	return session.token
}

describe('auto-withdraw PUT disable', () => {
	const dir = mkdtempSync(join(tmpdir(), 'aw-disable-'))
	const store = new AutopilotStore(join(dir, 'db.json'))
	let server: ReturnType<typeof startApi>
	let base = ''
	let chainCalls = 0

	beforeAll(async () => {
		_resetAuthForTests()
		server = startApi({
			store,
			pools: [],
			port: 0,
			assertAwPositionOwned: async () => {
				chainCalls += 1
				throw new Error('chain reader unavailable (injected)')
			},
		})
		await new Promise<void>((resolve, reject) => {
			server.once('listening', () => resolve())
			server.once('error', reject)
		})
		const addr = server.address()
		if (!addr || typeof addr === 'string') throw new Error('no port')
		base = `http://127.0.0.1:${addr.port}`
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()))
		})
		_resetAuthForTests()
	})

	beforeEach(() => {
		chainCalls = 0
		_resetAuthForTests()
		for (const r of store.listAutoWithdrawRules()) {
			store.upsertAutoWithdrawRule({ ...r, enabled: false, status: 'disabled' })
		}
	})

	it('disable success without chain read — bumps revision and clears unsent attempt', async () => {
		const kp = Ed25519Keypair.generate()
		const owner = kp.toSuiAddress()
		const token = await sessionFor(kp, base)
		const seeded = store.upsertAutoWithdrawRule(rule(owner))
		const revBefore = seeded.revision

		const put = await fetch(`${base}/api/auto-withdraw`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ rule: { ...seeded, enabled: false, status: 'disabled' } }),
		})
		expect(put.ok).toBe(true)
		expect(chainCalls).toBe(0)
		const body = (await put.json()) as {
			rule: AutoWithdrawRule
			disabledWithoutChainRead?: boolean
		}
		expect(body.disabledWithoutChainRead).toBe(true)
		expect(body.rule.enabled).toBe(false)
		expect(body.rule.status).toBe('disabled')
		expect(body.rule.revision).toBeGreaterThan(revBefore)
		expect(body.rule.activeAttempt).toBeNull()
		expect(store.getAutoWithdrawRule(seeded.positionId)?.enabled).toBe(false)
	})

	it('disable returns 401 without auth', async () => {
		const kp = Ed25519Keypair.generate()
		store.upsertAutoWithdrawRule(rule(kp.toSuiAddress()))
		const put = await fetch(`${base}/api/auto-withdraw`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				rule: { ...rule(kp.toSuiAddress()), enabled: false },
			}),
		})
		expect(put.status).toBe(401)
		expect(store.getAutoWithdrawRule(rule(kp.toSuiAddress()).positionId)?.enabled).toBe(true)
	})

	it('enable still requires chain ownership (failure blocks)', async () => {
		const kp = Ed25519Keypair.generate()
		const owner = kp.toSuiAddress()
		const token = await sessionFor(kp, base)
		store.upsertAutoWithdrawRule(rule(owner, { enabled: false, status: 'disabled', revision: 5 }))

		const put = await fetch(`${base}/api/auto-withdraw`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				rule: { ...rule(owner), enabled: true, status: 'watching', revision: 5 },
			}),
		})
		expect(put.status).toBe(400)
		expect(chainCalls).toBe(1)
		expect(store.getAutoWithdrawRule(rule(owner).positionId)?.enabled).toBe(false)
	})

	it('monitor tick cannot overwrite a disable (revision/enabled CAS)', async () => {
		const kp = Ed25519Keypair.generate()
		const owner = kp.toSuiAddress()
		const token = await sessionFor(kp, base)
		const pos = rule(owner)
		store.upsertAutoWithdrawRule(pos)

		const before = store.getAutoWithdrawRule(pos.positionId)!
		await fetch(`${base}/api/auto-withdraw`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ rule: { ...before, enabled: false } }),
		})
		const disabled = store.getAutoWithdrawRule(pos.positionId)!
		expect(disabled.enabled).toBe(false)

		await evaluateAutoWithdrawRules({
			store,
			listPositions: async () => [
				{
					protocol: 'clmm',
					positionId: pos.positionId,
					poolId: pos.poolId,
					owner,
					markUsdcPerSui: 1,
					lowerPriceUsdcPerSui: 0.5,
					upperPriceUsdcPerSui: 2,
					principalSui: 1,
					principalUsdc: 1,
					liquidityRaw: '1',
					pairIsSuiUsdc: true,
					fetchedAtMs: Date.now(),
					source: 'test',
				},
			],
			now: () => Date.now(),
		})

		const afterTick = store.getAutoWithdrawRule(pos.positionId)!
		expect(afterTick.enabled).toBe(false)
		expect(afterTick.status).toBe('disabled')
		expect(afterTick.revision).toBe(disabled.revision)
	})
})
