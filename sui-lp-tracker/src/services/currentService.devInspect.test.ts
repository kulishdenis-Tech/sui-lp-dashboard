import { describe, expect, it } from 'vitest'
import {
	encodeCurrentObligationOverviewForTest,
	encodeCurrentRatesVectorForTest,
	parseCurrentObligationOverviewReturn,
	parseCurrentRatesVectorReturn,
} from '@/services/currentService'

describe('Current devInspect BCS (gRPC number[] / JSON-RPC bytes)', () => {
	it('parses obligation overview from serialized BCS like grpc simulate returnValues', () => {
		const asset =
			'06864a1535b37e31b894f74b4a0dd741341a081107a4d7d6e6e209e6e7e5965::usdc::USDC'
		const grpcStyle = encodeCurrentObligationOverviewForTest({
			emode_group_id: 0,
			borrows: [
				{
					asset,
					borrow_index: { value: '1000000000000000000' },
					debt: { value: '500000000000000000' },
				},
			],
			deposits: [{ asset: '0x2::sui::SUI', ctoken_amount: 12345n }],
		})
		const parsed = parseCurrentObligationOverviewReturn(grpcStyle)
		expect(parsed.deposits).toHaveLength(1)
		expect(parsed.borrows).toHaveLength(1)
		expect(Number(parsed.deposits[0]?.ctoken_amount)).toBe(12345)
		expect(parsed.borrows[0]?.asset).toBe(asset)
	})

	it('parses asset market rates vector (exchange + borrow index)', () => {
		const grpcStyle = encodeCurrentRatesVectorForTest([
			{ value: '1000000000000000000' },
			{ value: '1000000000000000000' },
		])
		const parsed = parseCurrentRatesVectorReturn(grpcStyle)
		expect(parsed).toHaveLength(2)
		expect(parsed[0]?.value).toBe('1000000000000000000')
	})

	it('mining bundle shape: deposit/borrow result arrays are not conflated', () => {
		const depositMiningResults = [
			{
				status: 'complete' as const,
				apr: 0.01,
				parts: [{ symbol: 'SUI', coinType: '0x2::sui::SUI', apr: 0.01 }],
				readAtMs: Date.now(),
			},
		]
		const borrowMiningResults: typeof depositMiningResults = []
		const miningBundle = [depositMiningResults, borrowMiningResults] as const
		const [dResults, bResults] = miningBundle
		expect(dResults[0]?.parts.filter((p) => p.apr != null)).toHaveLength(1)
		expect(bResults).toHaveLength(0)
	})
})
