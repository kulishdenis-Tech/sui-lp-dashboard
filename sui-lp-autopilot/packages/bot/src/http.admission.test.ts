import { mkdtempSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AutopilotStore } from '@autopilot/db'
import type { StrategyConfig } from '@autopilot/engine'
import { startApi } from './http.js'

const owner = `0x${'ab'.repeat(32)}`

const config: StrategyConfig = {
	slot: 'BUY',
	status: 'active',
	regridMode: 'STATIC_GRID',
	binStrategy: 'spot',
	levels: [{ id: 'BUY-1', lowerPrice: 0.8, upperPrice: 0.9, budget: 10 }],
	hardPriceLimit: 0.9,
	totalBudget: 20,
	overlapPct: 0,
	maxGasPerOp: 1,
	maxOpsPerDay: 5,
	autoExitOnFullConversion: false,
	partialBinExit: false,
}

describe('HTTP strategy admission', () => {
	let server: Server
	let port = 0
	let opened = 0
	let closed = 0

	beforeAll(async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ap-http-'))
		const store = new AutopilotStore(join(dir, 'db.json'))
		store.setMode('PAPER')
		store.createStrategy(config)
		server = startApi({
			store,
			pools: [{ poolId: '0xpoolpool' }],
			packageIds: ['0xpkg'],
			port: 0,
			dlmmTx: {
				buildOpenTx: async () => {
					opened += 1
					return { unsigned: true }
				},
				buildCloseTx: async () => {
					closed += 1
					return { unsigned: true }
				},
			},
		})
		await new Promise<void>((resolve, reject) => {
			server.once('listening', () => resolve())
			server.once('error', reject)
		})
		const addr = server.address()
		if (!addr || typeof addr === 'string') throw new Error('api port missing')
		port = addr.port
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()))
		})
	})

	it('denies strategyGate open with admission disabled and does not build', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/api/tx`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				protocol: 'dlmm',
				kind: 'open',
				owner,
				poolId: '0xpoolpool',
				slot: 'BUY',
				levelId: 'BUY-1',
				hardPrice: 1,
				lowerPrice: 0.8,
				upperPrice: 0.9,
				budgetHuman: 10,
				strategyGate: true,
				riskContext: { simulationOk: true, mode: 'PAPER', priceSources: [1], rpcFreshMs: 1 },
			}),
		})
		const body = (await res.json()) as { code?: string; riskValidated?: boolean; contract?: string }
		expect(res.status).toBe(400)
		expect(body.code).toBe('STRATEGY_ADMISSION_DISABLED')
		expect(body.riskValidated).toBe(false)
		expect(body.contract).toBe('STRATEGY_OPEN')
		expect(opened).toBe(0)
	})

	it('builds a manual open as MANUAL_BUILD and not risk-validated', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/api/tx`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				protocol: 'dlmm',
				kind: 'open',
				owner,
				poolId: '0xpoolpool',
				slot: 'BUY',
				hardPrice: 1,
				lowerPrice: 0.8,
				upperPrice: 0.9,
				budgetHuman: 10,
			}),
		})
		const body = (await res.json()) as { riskValidated?: boolean; contract?: string; submitted?: boolean }
		expect(res.status).toBe(200)
		expect(body.contract).toBe('MANUAL_BUILD')
		expect(body.riskValidated).toBe(false)
		expect(body.submitted).toBe(false)
		expect(opened).toBe(1)
	})

	it('builds a manage close as MANUAL_MANAGE and not risk-validated', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/api/tx`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				protocol: 'dlmm',
				kind: 'close',
				owner,
				poolId: '0xpoolpool',
				positionId: '0xposition',
			}),
		})
		const body = (await res.json()) as { riskValidated?: boolean; contract?: string }
		expect(res.status).toBe(200)
		expect(body.contract).toBe('MANUAL_MANAGE')
		expect(body.riskValidated).toBe(false)
		expect(closed).toBe(1)
	})

	it('does not mark strategy recommendations as risk-validated', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/api/recommend`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				strategyGate: true,
				config,
				levels: [],
				riskContext: { simulationOk: true },
			}),
		})
		const body = (await res.json()) as {
			riskValidated?: boolean
			code?: string
			strategyAdmission?: string
			recommendations?: { riskValidated?: boolean }[]
		}
		expect(res.status).toBe(200)
		expect(body.strategyAdmission).toBe('disabled')
		expect(body.code).toBe('STRATEGY_ADMISSION_DISABLED')
		expect(body.riskValidated).toBe(false)
		expect(body.recommendations?.every((r) => r.riskValidated === false)).toBe(true)
	})
})
