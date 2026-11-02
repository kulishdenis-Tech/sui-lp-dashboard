import { mkdtempSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AutopilotStore } from '@autopilot/db'
import { startApi } from './http.js'

const owner = `0x${'cd'.repeat(32)}`
const poolId = '0x3b585786b13af1d8ea067ab37101b6513a05d2f90cfe60e8b1d9e1b46a63c4fa'
const positionId = `0x${'11'.repeat(32)}`

describe('HTTP Bluefin close preview response', () => {
	let server: Server
	let port = 0
	let closeCalls = 0

	beforeAll(async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ap-bf-close-'))
		const store = new AutopilotStore(join(dir, 'db.json'))
		store.setMode('MONITOR_ONLY')
		server = startApi({
			store,
			pools: [],
			packageIds: [],
			port: 0,
			bluefinTx: {
				buildCloseTx: async (input) => {
					closeCalls += 1
					expect(input.owner).toBe(owner)
					expect(input.poolId).toBe(poolId)
					expect(input.positionId).toBe(positionId)
					return {
						kind: 'close',
						slot: null,
						txBytesBase64: 'dGVzdA==',
						payloadSha256: 'abc',
						moveCalls: [{ target: '0xd075::gateway::close_position' }],
						recipients: [owner],
						gas: {
							computationCost: '42',
							storageCost: '0',
							storageRebate: '0',
							nonRefundableStorageFee: '0',
						},
						balanceChanges: [],
						policyOk: true,
						dryRunOk: true,
						dryRunError: null,
						binsChecked: [],
						activeBinNote: 'stub close',
						fill: {
							averageConversionPriceUsdcPerSui: null,
							suiDelta: null,
							usdcDelta: null,
							gasSui: null,
						},
						note: 'stub',
					}
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

	it('returns MANUAL_MANAGE + MONITOR_ONLY and keeps dryRunOk from the builder', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/api/tx`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				protocol: 'bluefin',
				kind: 'close',
				owner,
				poolId,
				positionId,
			}),
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			kind?: string
			protocol?: string
			contract?: string
			mode?: string
			riskValidated?: boolean
			dryRunOk?: boolean
			dryRunError?: string | null
			gas?: { computationCost?: string } | null
			submitted?: boolean
			txBytesBase64?: string
		}
		expect(closeCalls).toBe(1)
		expect(body.protocol).toBe('bluefin')
		expect(body.kind).toBe('close')
		expect(body.contract).toBe('MANUAL_MANAGE')
		expect(body.mode).toBe('MONITOR_ONLY')
		expect(body.riskValidated).toBe(false)
		expect(body.dryRunOk).toBe(true)
		expect(body.dryRunError).toBeNull()
		expect(body.gas?.computationCost).toBe('42')
		expect(body.submitted).toBe(false)
		expect(body.txBytesBase64).toBe('dGVzdA==')
	})

	it('propagates simulation unavailable without unlocking dryRunOk', async () => {
		closeCalls = 0
		const dir = mkdtempSync(join(tmpdir(), 'ap-bf-fail-'))
		const store = new AutopilotStore(join(dir, 'db.json'))
		store.setMode('MONITOR_ONLY')
		const failServer = startApi({
			store,
			port: 0,
			bluefinTx: {
				buildCloseTx: async () => ({
					kind: 'close',
					slot: null,
					txBytesBase64: 'dGVzdA==',
					payloadSha256: 'abc',
					moveCalls: [],
					recipients: [],
					gas: null,
					balanceChanges: [],
					policyOk: true,
					dryRunOk: false,
					dryRunError:
						'simulation unavailable: no confirmed execution status in the RPC response',
					binsChecked: [],
					activeBinNote: null,
					fill: {
						averageConversionPriceUsdcPerSui: null,
						suiDelta: null,
						usdcDelta: null,
						gasSui: null,
					},
					note: 'stub',
				}),
			},
		})
		await new Promise<void>((resolve, reject) => {
			failServer.once('listening', () => resolve())
			failServer.once('error', reject)
		})
		const addr = failServer.address()
		if (!addr || typeof addr === 'string') throw new Error('fail api port missing')
		const failPort = addr.port
		try {
			const res = await fetch(`http://127.0.0.1:${failPort}/api/tx`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					protocol: 'bluefin',
					kind: 'close',
					owner,
					poolId,
					positionId,
				}),
			})
			const body = (await res.json()) as {
				dryRunOk?: boolean
				dryRunError?: string | null
				gas?: unknown
				contract?: string
			}
			expect(res.status).toBe(200)
			expect(body.contract).toBe('MANUAL_MANAGE')
			expect(body.dryRunOk).toBe(false)
			expect(body.dryRunError).toMatch(/^simulation unavailable:/)
			expect(body.gas).toBeNull()
		} finally {
			await new Promise<void>((resolve, reject) => {
				failServer.close((err) => (err ? reject(err) : resolve()))
			})
		}
	})
})
