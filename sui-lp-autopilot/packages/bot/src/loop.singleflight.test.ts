import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AutopilotStore } from '@autopilot/db'
import type { PositionSnapshot, WhitelistedPool } from '@autopilot/cetus'
import type { StrategyConfig } from '@autopilot/engine'
import { runLoop } from './loop.js'

const pool = {
	poolId: '0xpool',
	name: 'SUI/USDC',
	binStep: 1,
	tokenA: 'SUI',
	tokenB: 'USDC',
} as unknown as WhitelistedPool

const snap = {
	poolId: '0xpool',
	activeId: 1,
	priceUsdcPerSui: 1,
	source: 'test',
}

function storeWithStrategy(): AutopilotStore {
	const dir = mkdtempSync(join(tmpdir(), 'ap-loop-'))
	const s = new AutopilotStore(join(dir, 'db.json'))
	const cfg: StrategyConfig = {
		slot: 'BUY',
		status: 'active',
		regridMode: 'STATIC_GRID',
		binStrategy: 'spot',
		levels: [{ id: 'BUY-1', lowerPrice: 0.8, upperPrice: 0.9, budget: 10 }],
		hardPriceLimit: 0.9,
		totalBudget: 10,
		overlapPct: 0,
		maxGasPerOp: 1,
		maxOpsPerDay: 5,
		autoExitOnFullConversion: false,
		partialBinExit: false,
	}
	s.createStrategy(cfg)
	s.setMode('MONITOR_ONLY')
	return s
}

describe('loop single-flight', () => {
	it('does not start a second tick while a hung RPC is still in flight, and stop drops late recommends', async () => {
		const logs: string[] = []
		let release: (rows: PositionSnapshot[]) => void = () => {}
		let calls = 0
		const hung = new Promise<PositionSnapshot[]>((resolve) => {
			release = resolve
		})
		const handle = await runLoop({
			store: storeWithStrategy(),
			pools: [pool],
			intervalMs: 30,
			timeoutMs: 40,
			owner: '0xowner',
			readPool: async () => snap as never,
			listPositions: () => {
				calls += 1
				return hung
			},
			log: (line) => logs.push(line),
		})

		await new Promise((r) => setTimeout(r, 80))
		expect(calls).toBe(1)
		expect(logs.some((l) => l.includes('previous tick still running'))).toBe(true)

		handle.stop()
		release([])
		await new Promise((r) => setTimeout(r, 30))
		expect(logs.some((l) => l.includes('[recommend]'))).toBe(false)
		expect(calls).toBe(1)
	})

	it('positions RPC failure does not record a mapping or recommend open_level', async () => {
		const logs: string[] = []
		const db = storeWithStrategy()
		const handle = await runLoop({
			store: db,
			pools: [pool],
			intervalMs: 10_000,
			timeoutMs: 2_000,
			owner: '0xowner',
			readPool: async () => snap as never,
			listPositions: async () => {
				throw new Error('rpc down')
			},
			log: (line) => logs.push(line),
		})
		await new Promise((r) => setTimeout(r, 40))
		handle.stop()
		expect(logs.some((l) => l.includes('positions unknown'))).toBe(true)
		expect(logs.some((l) => l.includes('[recommend]'))).toBe(false)
		expect(db.listPositionMappings()).toEqual([])
	})

	it('pool RPC failure is logged and does not become an unhandled rejection', async () => {
		const rejections: string[] = []
		const onRejection = (err: unknown) => {
			rejections.push(err instanceof Error ? err.message : String(err))
		}
		process.on('unhandledRejection', onRejection)
		const logs: string[] = []
		let listed = 0
		const db = storeWithStrategy()
		try {
			const handle = await runLoop({
				store: db,
				pools: [pool],
				intervalMs: 10_000,
				timeoutMs: 2_000,
				owner: '0xowner',
				readPool: async () => {
					throw new Error('pool RPC down')
				},
				listPositions: async () => {
					listed += 1
					return []
				},
				log: (line) => logs.push(line),
			})
			await new Promise((r) => setTimeout(r, 50))
			handle.stop()
			await new Promise((r) => setTimeout(r, 20))
		} finally {
			process.off('unhandledRejection', onRejection)
		}
		expect(rejections).toEqual([])
		expect(listed).toBe(0)
		expect(logs.some((l) => l.includes('pool RPC down'))).toBe(true)
		expect(logs.some((l) => l.includes('[recommend]'))).toBe(false)
		expect(db.listPositionMappings()).toEqual([])
	})

	it('a hung pool RPC keeps single-flight until it settles, and stop drops the late result', async () => {
		const logs: string[] = []
		let release: (row: typeof snap) => void = () => {}
		let calls = 0
		const hung = new Promise<typeof snap>((resolve) => {
			release = resolve
		})
		const handle = await runLoop({
			store: storeWithStrategy(),
			pools: [pool],
			intervalMs: 30,
			timeoutMs: 40,
			owner: '0xowner',
			readPool: () => {
				calls += 1
				return hung as never
			},
			listPositions: async () => [],
			log: (line) => logs.push(line),
		})
		await new Promise((r) => setTimeout(r, 80))
		expect(calls).toBe(1)
		expect(logs.some((l) => l.includes('previous tick still running'))).toBe(true)
		handle.stop()
		release(snap)
		await new Promise((r) => setTimeout(r, 30))
		expect(logs.some((l) => l.includes('[recommend]'))).toBe(false)
		expect(calls).toBe(1)
	})

	it('does not record a geometry overlap as a confirmed mapping', async () => {
		const logs: string[] = []
		const db = storeWithStrategy()
		db.setPositionMapping('pos-foreign', {
			strategySlot: 'BUY',
			levelId: 'BUY-1',
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'testnet',
			binding: 'confirmed',
			digest: 'other-network',
		})
		const handle = await runLoop({
			store: db,
			pools: [pool],
			intervalMs: 10_000,
			timeoutMs: 2_000,
			owner: '0xowner',
			readPool: async () => snap as never,
			listPositions: async () =>
				[
					{
						positionId: 'pos-foreign',
						poolId: '0xpool',
						lowerPriceUsdcPerSui: 0.8,
						upperPriceUsdcPerSui: 0.9,
						amountSui: 0,
						amountUsdc: 10,
						feeUsdEstimate: 0,
					},
				] as never,
			log: (line) => logs.push(line),
		})
		await new Promise((r) => setTimeout(r, 40))
		handle.stop()
		expect(db.getPositionMapping('pos-foreign')?.network).toBe('testnet')
		expect(db.listPositionMappings()).toHaveLength(1)
		expect(logs.some((l) => l.includes('open_level'))).toBe(false)
		expect(logs.some((l) => l.includes('BUY-1:hold'))).toBe(true)
	})

	it('writes confirmed mappings from settlement, not from an overlapping foreign LP', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ap-loop-'))
		const path = join(dir, 'db.json')
		const db = new AutopilotStore(path)
		const cfg: StrategyConfig = {
			slot: 'BUY',
			status: 'active',
			regridMode: 'STATIC_GRID',
			binStrategy: 'spot',
			levels: [
				{ id: 'BUY-1', lowerPrice: 0.8, upperPrice: 0.9, budget: 10 },
				{ id: 'BUY-2', lowerPrice: 0.7, upperPrice: 0.8, budget: 10 },
			],
			hardPriceLimit: 0.9,
			totalBudget: 20,
			overlapPct: 0,
			maxGasPerOp: 1,
			maxOpsPerDay: 5,
			autoExitOnFullConversion: false,
			partialBinExit: false,
		}
		db.createStrategy(cfg)
		db.setMode('MONITOR_ONLY')
		db.recordOpenIntent({
			slot: 'BUY',
			levelIds: ['BUY-1', 'BUY-2'],
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'mainnet',
			digest: 'digest-open',
		})
		const handle = await runLoop({
			store: db,
			pools: [pool],
			intervalMs: 10_000,
			timeoutMs: 2_000,
			owner: '0xowner',
			readPool: async () => snap as never,
			readSettlement: async () => ({
				success: true,
				digest: 'digest-open',
				positionObjectIds: ['pos-b', 'pos-a'],
				positions: [
					{ positionId: 'pos-b', lowerPrice: 0.7, upperPrice: 0.8 },
					{ positionId: 'pos-a', lowerPrice: 0.8, upperPrice: 0.9 },
				],
			}),
			listPositions: async () =>
				[
					{ positionId: 'pos-a', poolId: '0xpool', lowerPriceUsdcPerSui: 0.8, upperPriceUsdcPerSui: 0.9, amountSui: 0, amountUsdc: 10, feeUsdEstimate: 0 },
					{ positionId: 'pos-b', poolId: '0xpool', lowerPriceUsdcPerSui: 0.7, upperPriceUsdcPerSui: 0.8, amountSui: 0, amountUsdc: 10, feeUsdEstimate: 0 },
					{ positionId: 'pos-foreign', poolId: '0xpool', lowerPriceUsdcPerSui: 0.8, upperPriceUsdcPerSui: 0.9, amountSui: 0, amountUsdc: 10, feeUsdEstimate: 0 },
				] as never,
			log: () => {},
		})
		await new Promise((r) => setTimeout(r, 50))
		handle.stop()
		expect(db.getPositionMapping('pos-a')).toMatchObject({ levelId: 'BUY-1', binding: 'confirmed', network: 'mainnet', protocol: 'dlmm', digest: 'digest-open' })
		expect(db.getPositionMapping('pos-b')).toMatchObject({ levelId: 'BUY-2', binding: 'confirmed' })
		expect(db.getPositionMapping('pos-foreign')).toBeUndefined()
		expect(db.listOpenIntents()[0]?.status).toBe('confirmed')

		const restarted = new AutopilotStore(path)
		expect(restarted.getPositionMapping('pos-a')?.levelId).toBe('BUY-1')
		expect(restarted.listOpenIntents()[0]?.status).toBe('confirmed')
	})

	it('does not write a mapping when settlement resolves after stop', async () => {
		const db = storeWithStrategy()
		db.recordOpenIntent({
			slot: 'BUY',
			levelIds: ['BUY-1'],
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'mainnet',
			digest: 'digest-late',
		})
		let release: (row: {
			success: boolean
			digest: string
			positionObjectIds: string[]
		}) => void = () => {}
		const pending = new Promise<{
			success: boolean
			digest: string
			positionObjectIds: string[]
		}>((resolve) => {
			release = resolve
		})
		const handle = await runLoop({
			store: db,
			pools: [pool],
			intervalMs: 10_000,
			timeoutMs: 10_000,
			owner: '0xowner',
			readPool: async () => snap as never,
			readSettlement: () => pending,
			listPositions: async () => [],
			log: () => {},
		})
		await new Promise((r) => setTimeout(r, 20))
		handle.stop()
		release({ success: true, digest: 'digest-late', positionObjectIds: ['pos-late'] })
		await new Promise((r) => setTimeout(r, 30))
		expect(db.listPositionMappings()).toEqual([])
		expect(db.listOpenIntents()[0]?.status).toBe('awaiting_settlement')
	})
})
