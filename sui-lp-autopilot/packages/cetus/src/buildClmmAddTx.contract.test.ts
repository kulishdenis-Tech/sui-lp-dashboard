import { describe, expect, it } from 'vitest'
import {
	buildClmmAddTx,
	buildClmmCloseTx,
	buildClmmCollectFeeTx,
	buildClmmOpenTx,
	buildClmmRemoveTx,
} from './buildClmmTx.js'

/** Contract surface for add-to-existing CLMM (no live RPC / no signing). */
describe('buildClmmAddTx contract', () => {
	it('exports buildClmmAddTx alongside open/remove/close/collect', () => {
		expect(typeof buildClmmAddTx).toBe('function')
		expect(typeof buildClmmOpenTx).toBe('function')
		expect(typeof buildClmmRemoveTx).toBe('function')
		expect(typeof buildClmmCloseTx).toBe('function')
		expect(typeof buildClmmCollectFeeTx).toBe('function')
	})
})
