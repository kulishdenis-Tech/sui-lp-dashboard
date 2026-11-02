import { describe, expect, it } from 'vitest'
import { isEmptyStubDbPath } from '@autopilot/db'

describe('isEmptyStubDbPath', () => {
	it('rejects the empty autopilot data stub and keeps the bot store', () => {
		expect(
			isEmptyStubDbPath(
				'C:\\Users\\kulis\\Desktop\\Projects\\SUI Dashboard\\sui-lp-autopilot\\data\\autopilot.db.json',
			),
		).toBe(true)
		expect(
			isEmptyStubDbPath(
				'C:/Users/kulis/Desktop/Projects/SUI Dashboard/sui-lp-autopilot/packages/bot/data/autopilot.db.json',
			),
		).toBe(false)
		expect(isEmptyStubDbPath('/tmp/autopilot.db.json')).toBe(false)
	})
})
