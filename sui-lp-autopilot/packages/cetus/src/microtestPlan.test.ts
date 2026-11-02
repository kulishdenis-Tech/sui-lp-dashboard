import { describe, expect, it } from 'vitest'
import { MICROTEST_PLAN, assertMicrotestIsManual } from './microtestPlan.js'

describe('microtest plan', () => {
	it('is OPEN → MONITOR → CLOSE → VERIFY and never submits', () => {
		expect(MICROTEST_PLAN.steps.map((step) => step.id)).toEqual(['open', 'monitor', 'close', 'verify'])
		expect(MICROTEST_PLAN.autoExecute).toBe(false)
		expect(() => assertMicrotestIsManual()).not.toThrow()
	})
})
