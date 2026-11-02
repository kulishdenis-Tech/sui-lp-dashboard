import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AutopilotStore } from '@autopilot/db'
import { normalizeAutoWithdrawRule, type AutoWithdrawRule } from '@autopilot/engine'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { startApi } from './http.js'
import { _resetAuthForTests } from './walletAuth.js'

function rule(owner: string, partial: Partial<AutoWithdrawRule> = {}): AutoWithdrawRule {
	return normalizeAutoWithdrawRule({
		id: 'aw-1',
		owner,
		network: 'mainnet',
		protocol: 'clmm',
		poolId: '0x' + 'aa'.repeat(32),
		positionId: '0x' + 'bb'.repeat(32),
		cycleId: 'cycle-1',
		revision: 0,
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

describe('auto-withdraw HTTP auth', () => {
	const dir = mkdtempSync(join(tmpdir(), 'aw-http-'))
	const store = new AutopilotStore(join(dir, 'db.json'))
	let server: ReturnType<typeof startApi>
	let base = ''

	beforeAll(async () => {
		_resetAuthForTests()
		server = startApi({
			store,
			pools: [],
			port: 0,
			// Unit test does not hit chain — ownership asserted separately in awChainReads tests.
			assertAwPositionOwned: async () => {},
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

	it('rejects PUT without auth and forged owner string', async () => {
		const kp = Ed25519Keypair.generate()
		const owner = kp.toSuiAddress()
		const forged = '0x' + '99'.repeat(32)
		const noAuth = await fetch(`${base}/api/auto-withdraw`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ rule: rule(forged) }),
		})
		expect(noAuth.status).toBe(401)

		const nonceRes = await fetch(`${base}/api/auth/nonce?address=${encodeURIComponent(owner)}`)
		expect(nonceRes.ok).toBe(true)
		const issued = (await nonceRes.json()) as { nonce: string; message: string }
		const { signature } = await kp.signPersonalMessage(new TextEncoder().encode(issued.message))
		const verify = await fetch(`${base}/api/auth/verify`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ address: owner, nonce: issued.nonce, signature }),
		})
		expect(verify.ok).toBe(true)
		const session = (await verify.json()) as { token: string }

		const forgedPut = await fetch(`${base}/api/auto-withdraw`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${session.token}`,
			},
			body: JSON.stringify({ rule: rule(forged) }),
		})
		expect(forgedPut.status).toBe(403)

		const okPut = await fetch(`${base}/api/auto-withdraw`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${session.token}`,
			},
			body: JSON.stringify({ rule: rule(owner) }),
		})
		expect(okPut.ok).toBe(true)

		// Nonce reuse
		const reuse = await fetch(`${base}/api/auth/verify`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ address: owner, nonce: issued.nonce, signature }),
		})
		expect(reuse.status).toBe(401)
	})

	it('foreign session cannot change another owner rule', async () => {
		_resetAuthForTests()
		const ownerKp = Ed25519Keypair.generate()
		const otherKp = Ed25519Keypair.generate()
		const owner = ownerKp.toSuiAddress()
		const other = otherKp.toSuiAddress()
		store.upsertAutoWithdrawRule(rule(owner, { enabled: true, status: 'watching' }))

		const nonceRes = await fetch(`${base}/api/auth/nonce?address=${encodeURIComponent(other)}`)
		const issued = (await nonceRes.json()) as { nonce: string; message: string }
		const { signature } = await otherKp.signPersonalMessage(new TextEncoder().encode(issued.message))
		const verify = await fetch(`${base}/api/auth/verify`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ address: other, nonce: issued.nonce, signature }),
		})
		const session = (await verify.json()) as { token: string }

		const put = await fetch(`${base}/api/auto-withdraw`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${session.token}`,
			},
			body: JSON.stringify({
				rule: rule(owner, { enabled: false, status: 'disabled' }),
			}),
		})
		expect(put.status).toBe(403)
		expect(store.getAutoWithdrawRule(rule(owner).positionId)?.enabled).toBe(true)
	})
})
