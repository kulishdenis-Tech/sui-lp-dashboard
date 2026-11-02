import { describe, expect, it } from 'vitest'
import {
	CETUS_CANNOT_CLOSE_ATTACKED_ABORT,
	CETUS_CLOSE_LOCKED_MESSAGE,
} from './compensationLock.js'

describe('compensationLock constants', () => {
	it('documents Cetus pool abort 23', () => {
		expect(CETUS_CANNOT_CLOSE_ATTACKED_ABORT).toBe(23)
		expect(CETUS_CLOSE_LOCKED_MESSAGE).toMatch(/compensation/i)
		expect(CETUS_CLOSE_LOCKED_MESSAGE).toMatch(/cannot be closed/i)
	})
})
