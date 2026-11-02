import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AutopilotStore } from '@autopilot/db'
import type { StrategyConfig } from '@autopilot/engine'
import { bindConfirmedOpen, confirmedLevelMap } from './openSettlement.js'

function store(): AutopilotStore {
	const dir = mkdtempSync(join(tmpdir(), 'ap-settle-'))
	return new AutopilotStore(join(dir, 'db.json'))
}

describe('confirmed open settlement', () => {
	it('binds each created position id to its intent and ignores a count mismatch', () => {
		const db = store()
		const intent = db.recordOpenIntent({
			slot: 'BUY',
			levelIds: ['BUY-1', 'BUY-2'],
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'mainnet',
			digest: 'digest-open',
		})
		expect(
			bindConfirmedOpen(db, intent, {
				success: true,
				digest: 'digest-open',
				positionObjectIds: ['pos-a'],
			}),
		).toBe('incomplete')
		expect(db.listPositionMappings()).toEqual([])
		expect(db.listOpenIntents()[0]?.status).toBe('incomplete')

		const again = db.recordOpenIntent({
			slot: 'BUY',
			levelIds: ['BUY-1', 'BUY-2'],
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'mainnet',
			digest: 'digest-ok',
		})
		expect(
			bindConfirmedOpen(db, again, {
				success: true,
				digest: 'digest-ok',
				positionObjectIds: ['pos-a', 'pos-b'],
			}),
		).toBe('incomplete')
		expect(db.listPositionMappings()).toEqual([])
	})

	it('pairs a cascade by confirmed ranges when position ids are reversed', () => {
		const db = store()
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
		const intent = db.recordOpenIntent({
			slot: 'BUY',
			levelIds: ['BUY-1', 'BUY-2'],
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'mainnet',
			digest: 'digest-cascade',
		})
		expect(
			bindConfirmedOpen(db, intent, {
				success: true,
				digest: 'digest-cascade',
				positionObjectIds: ['pos-wide', 'pos-tight'],
				positions: [
					{ positionId: 'pos-wide', lowerPrice: 0.7, upperPrice: 0.8 },
					{ positionId: 'pos-tight', lowerPrice: 0.8, upperPrice: 0.9 },
				],
			}),
		).toBe('confirmed')
		expect(db.getPositionMapping('pos-tight')?.levelId).toBe('BUY-1')
		expect(db.getPositionMapping('pos-wide')?.levelId).toBe('BUY-2')
	})

	it('does not pin another network or protocol, or a row without a confirmed binding', () => {
		const db = store()
		db.setPositionMapping('pos-testnet', {
			strategySlot: 'BUY',
			levelId: 'BUY-1',
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'testnet',
			binding: 'confirmed',
			digest: 'd1',
		})
		db.setPositionMapping('pos-clmm', {
			strategySlot: 'BUY',
			levelId: 'BUY-1',
			poolId: '0xpool',
			protocol: 'clmm',
			network: 'mainnet',
			binding: 'confirmed',
			digest: 'd2',
		})
		db.setPositionMapping('pos-geometry', {
			strategySlot: 'BUY',
			levelId: 'BUY-2',
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'mainnet',
		})
		const pins = confirmedLevelMap(db.listPositionMappings(), {
			strategySlot: 'BUY',
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'mainnet',
		})
		expect([...pins.keys()]).toEqual([])
	})

	it('leaves the intent awaiting when the settlement read returns nothing', async () => {
		const db = store()
		db.recordOpenIntent({
			slot: 'BUY',
			levelIds: ['BUY-1'],
			poolId: '0xpool',
			protocol: 'dlmm',
			network: 'mainnet',
			digest: 'digest-missing',
		})
		const { reconcileOpenIntents } = await import('./openSettlement.js')
		const logs: string[] = []
		await reconcileOpenIntents(db, async () => null, (line) => logs.push(line))
		expect(db.listOpenIntents()[0]?.status).toBe('awaiting_settlement')
		expect(db.listPositionMappings()).toEqual([])
		expect(logs.some((l) => l.includes('left awaiting'))).toBe(true)
	})
})
