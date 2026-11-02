import { describe, expect, it } from 'vitest'
import { interpretSim, interpretSimTransportError, SIMULATE_INCLUDE } from './simResult.js'

const GAS = {
	computationCost: '1000',
	storageCost: '2000',
	storageRebate: '0',
	nonRefundableStorageFee: '0',
}

describe('SIMULATE_INCLUDE', () => {
	it('requests effects and balanceChanges per Mysten docs', () => {
		expect(SIMULATE_INCLUDE).toEqual({ effects: true, balanceChanges: true })
	})
})

describe('interpretSim', () => {
	it('accepts gRPC success with body-level status only (no effects)', () => {
		const sim = {
			$kind: 'Transaction',
			Transaction: {
				status: { success: true, error: null },
				signatures: [],
			},
		}
		const parsed = interpretSim(sim)
		expect(parsed.ok).toBe(true)
		expect(parsed.code).toBe('ok')
		expect(parsed.error).toBeNull()
		expect(parsed.gas).toBeNull()
		expect(parsed.diag.hasBodyStatus).toBe(true)
		expect(parsed.diag.hasEffects).toBe(false)
	})

	it('accepts nested effects.status success and extracts gas', () => {
		const sim = {
			$kind: 'Transaction',
			Transaction: {
				status: { success: true, error: null },
				effects: {
					status: { success: true, error: null },
					gasUsed: GAS,
				},
				balanceChanges: [{ coinType: '0x2::sui::SUI', address: '0xabc', amount: '-1' }],
			},
		}
		const parsed = interpretSim(sim)
		expect(parsed.ok).toBe(true)
		expect(parsed.code).toBe('ok')
		expect(parsed.gas).toEqual(GAS)
		expect(parsed.balanceChanges).toHaveLength(1)
		expect(parsed.diag.hasGas).toBe(true)
		expect(parsed.diag.hasBalanceChanges).toBe(true)
	})

	it('reports MoveAbort as simulation failed', () => {
		const sim = {
			$kind: 'FailedTransaction',
			FailedTransaction: {
				status: {
					success: false,
					error: {
						message:
							"MoveAbort in 1st command, abort code: 1001, in '0x67b34b::config::verify_version'",
					},
				},
			},
		}
		const parsed = interpretSim(sim)
		expect(parsed.ok).toBe(false)
		expect(parsed.code).toBe('failed')
		expect(parsed.error).toMatch(/^simulation failed:/)
		expect(parsed.error).toContain('abort code: 1001')
	})

	it('rejects Transaction without any status as unavailable', () => {
		const sim = { $kind: 'Transaction', Transaction: { signatures: [] } }
		const parsed = interpretSim(sim)
		expect(parsed.ok).toBe(false)
		expect(parsed.code).toBe('unavailable')
		expect(parsed.error).toMatch(/^simulation unavailable:/)
	})

	it('rejects unknown discriminator as unsupported', () => {
		const parsed = interpretSim({ $kind: 'SomethingElse' })
		expect(parsed.ok).toBe(false)
		expect(parsed.code).toBe('unsupported')
		expect(parsed.error).toMatch(/^unsupported response:/)
	})

	it('does not treat digest-only as success', () => {
		const parsed = interpretSim({
			$kind: 'Transaction',
			Transaction: { digest: 'AbCdEf', signatures: [] },
		})
		expect(parsed.ok).toBe(false)
		expect(parsed.code).toBe('unavailable')
	})

	it('fails when effects.status contradicts body success', () => {
		const parsed = interpretSim({
			$kind: 'Transaction',
			Transaction: {
				status: { success: true, error: null },
				effects: {
					status: { success: false, error: { message: 'effects aborted' } },
					gasUsed: GAS,
				},
			},
		})
		expect(parsed.ok).toBe(false)
		expect(parsed.code).toBe('failed')
		expect(parsed.error).toContain('effects aborted')
	})

	it('maps transport errors to simulation failed', () => {
		const parsed = interpretSimTransportError(new Error('connect ECONNREFUSED'))
		expect(parsed.ok).toBe(false)
		expect(parsed.code).toBe('failed')
		expect(parsed.error).toBe('simulation failed: connect ECONNREFUSED')
		expect(parsed.gas).toBeNull()
	})
})
