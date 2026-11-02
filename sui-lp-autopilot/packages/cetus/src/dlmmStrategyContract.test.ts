import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategyType } from '@cetusprotocol/dlmm-sdk'

const calculateAddLiquidityInfo = vi.fn(async (opts: { strategy_type: StrategyType }) => ({
	amount_a: '1000000',
	amount_b: '0',
	strategy_type: opts.strategy_type,
}))

const addLiquidityPayload = vi.fn((_opts: unknown, tx: unknown) => tx ?? makeTx())

function makeTx() {
	return {
		setSender: vi.fn(),
		build: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
	}
}

vi.mock('@mysten/sui/transactions', () => ({
	Transaction: {
		from: vi.fn(() => makeTx()),
	},
}))

vi.mock('@mysten/sui/utils', () => ({
	toBase64: () => 'dGVzdA==',
}))

vi.mock('./sdk.js', () => ({
	getDlmmSdk: () => ({
		setSenderAddress: vi.fn(),
		sdkOptions: {
			dlmm_pool: { package_id: '0xpoolpkg', published_at: '0xpoolpkg' },
			dlmm_router: { package_id: '0xrouter', published_at: '0xrouter' },
		},
		FullClient: {
			sendSimulationTransaction: vi.fn(async () => ({ effects: { status: { status: 'success' } } })),
		},
		Pool: {
			getPool: vi.fn(async () => ({
				id: '0xpool',
				bin_step: 50,
				active_id: 1400,
				coin_type_a: '0x2::sui::SUI',
				coin_type_b:
					'0xdba34672e30cb065b1f93e3ab55318735622319e0f209294765d06c6f8b4f0c0::usdc::USDC',
				reward_manager: { rewards: [] },
			})),
		},
		Position: {
			calculateAddLiquidityInfo,
			addLiquidityPayload,
		},
	}),
}))

vi.mock('./simResult.js', () => ({
	interpretSim: () => ({
		ok: true,
		gas: null,
		balanceChanges: [],
		error: null,
	}),
	interpretSimTransportError: () => ({ ok: false, gas: null, balanceChanges: [], error: 'x' }),
	logSimDiagnostics: vi.fn(),
}))

vi.mock('./txPolicy.js', () => ({
	packageAllowed: () => true,
	verifyUnsignedTx: () => ({
		ok: true as const,
		payloadSha256: 'abc',
		moveCalls: [],
		recipients: [],
	}),
}))

vi.mock('./binGuard.js', async () => {
	const actual = await vi.importActual<typeof import('./binGuard.js')>('./binGuard.js')
	return {
		...actual,
		assertRangeHardLimit: (input: { lowerBinId: number; upperBinId: number }) => [
			{ binId: input.lowerBinId, priceUsdcPerSui: 0.9 },
			{ binId: input.upperBinId, priceUsdcPerSui: 0.95 },
		],
		assertOneSidedDeposit: vi.fn(),
		binIdsFromPrices: () => ({ lowerBinId: 10, upperBinId: 20 }),
		binPriceUsdcPerSui: () => 0.92,
	}
})

describe('DLMM buildOpenTx → SDK StrategyType', () => {
	beforeEach(() => {
		calculateAddLiquidityInfo.mockClear()
		addLiquidityPayload.mockClear()
	})

	it('exports toStrategyType matching Cetus enum', async () => {
		const { toStrategyType } = await import('./buildTx.js')
		expect(toStrategyType('spot')).toBe(StrategyType.Spot)
		expect(toStrategyType(undefined)).toBe(StrategyType.Spot)
		expect(toStrategyType('curve')).toBe(StrategyType.Curve)
		expect(toStrategyType('bidask')).toBe(StrategyType.BidAsk)
		expect(StrategyType.Spot).toBe(0)
		expect(StrategyType.Curve).toBe(1)
		expect(StrategyType.BidAsk).toBe(2)
	})

	it('passes leg.binStrategy into calculateAddLiquidityInfo.strategy_type', async () => {
		const { buildOpenTx } = await import('./buildTx.js')
		const base = {
			owner: `0x${'11'.repeat(32)}`,
			poolId: '0xpool',
			slot: 'BUY' as const,
			hardPrice: 0.95,
		}

		for (const [shape, expected] of [
			['curve', StrategyType.Curve],
			['bidask', StrategyType.BidAsk],
			['spot', StrategyType.Spot],
		] as const) {
			calculateAddLiquidityInfo.mockClear()
			await buildOpenTx({
				...base,
				legs: [{ lowerPrice: 0.85, upperPrice: 0.9, budgetHuman: 10, binStrategy: shape }],
			})
			expect(calculateAddLiquidityInfo).toHaveBeenCalled()
			expect(calculateAddLiquidityInfo.mock.calls[0]![0].strategy_type).toBe(expected)
			expect(addLiquidityPayload.mock.calls.at(-1)![0]).toMatchObject({ strategy_type: expected })
		}
	})
})
