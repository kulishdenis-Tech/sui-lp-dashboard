import { describe, expect, it } from 'vitest'
import {
	generateAutoGrid,
	initPaperState,
	paperMetrics,
	stepPaper,
	type StrategyConfig,
} from '@autopilot/engine'

describe('paper BUY conversion', () => {
	it('accumulates SUI when price is in range; does not raise ranges', () => {
		const levels = generateAutoGrid({
			slot: 'BUY',
			anchorPrice: 1,
			width: 0.1,
			count: 2,
			overlapPct: 0.5,
			totalBudget: 1000,
			budgetMode: 'equal',
			hardPriceLimit: 1,
		})
		const cfg: StrategyConfig = {
			slot: 'BUY',
			status: 'active',
			regridMode: 'STATIC_GRID',
			binStrategy: 'spot',
			levels,
			hardPriceLimit: 1,
			totalBudget: 1000,
			overlapPct: 0.5,
			maxGasPerOp: 1,
			maxOpsPerDay: 100,
			autoExitOnFullConversion: false,
			partialBinExit: false,
		}
		let st = initPaperState(cfg, 0.95)
		const upper0 = st.positions[0]!.upperPrice
		for (let i = 0; i < 20; i++) st = stepPaper(st, cfg, 0.92, { convertPct: 0.2 })
		const m = paperMetrics(st)
		expect(m.accumulatedTarget).toBeGreaterThan(0)
		expect(st.positions[0]!.upperPrice).toBe(upper0)
	})
})

describe('paper SELL', () => {
	it('does not sell when price below range', () => {
		const cfg: StrategyConfig = {
			slot: 'SELL',
			status: 'active',
			regridMode: 'STATIC_GRID',
			binStrategy: 'spot',
			levels: [{ id: 'SELL-1', lowerPrice: 1.2, upperPrice: 1.3, budget: 100 }],
			hardPriceLimit: 1.2,
			totalBudget: 100,
			overlapPct: 0,
			maxGasPerOp: 1,
			maxOpsPerDay: 10,
			autoExitOnFullConversion: false,
			partialBinExit: false,
		}
		let st = initPaperState(cfg, 1.0)
		st = stepPaper(st, cfg, 1.0, { convertPct: 1 })
		expect(paperMetrics(st).accumulatedTarget).toBe(0)
		expect(st.positions[0]!.startAsset).toBe(100)
	})
})
