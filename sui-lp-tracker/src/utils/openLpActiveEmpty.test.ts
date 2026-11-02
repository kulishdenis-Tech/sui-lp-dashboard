import { describe, expect, it } from 'vitest'
import type { OpenPosition } from '@/types'
import { splitOpenLpActiveEmpty } from '@/utils/openLpActiveEmpty'

function pos(liquidity: string): OpenPosition {
	return {
		id: liquidity,
		protocol: 'bluefin',
		pair: 'A/B',
		tokenA: 'A',
		tokenB: 'B',
		liquidity,
		status: 'out_of_range',
	} as OpenPosition
}

describe('splitOpenLpActiveEmpty', () => {
	it('splits zero liquidity from active', () => {
		const { active, empty } = splitOpenLpActiveEmpty([pos('100'), pos('0'), pos('')])
		expect(active.map((p) => p.id)).toEqual(['100', ''])
		expect(empty.map((p) => p.id)).toEqual(['0'])
	})
})
