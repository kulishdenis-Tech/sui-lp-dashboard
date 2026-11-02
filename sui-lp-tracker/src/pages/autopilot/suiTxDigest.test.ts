import { describe, expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { sameSuiTxDigest, suiTxDigestFromBytesBase64 } from './suiTxDigest'

describe('suiTxDigestFromBytesBase64', () => {
	it('is stable for the same frozen bytes and case-sensitive', async () => {
		const tx = new Transaction()
		tx.setSender(`0x${'11'.repeat(32)}`)
		tx.setGasPrice(1000)
		tx.setGasBudget(1_000_000n)
		tx.setGasPayment([
			{
				objectId: `0x${'ab'.repeat(32)}`,
				version: 1,
				digest: '11111111111111111111111111111111',
			},
		])
		const bytes = await tx.build()
		const b64 = toBase64(bytes)
		const d1 = suiTxDigestFromBytesBase64(b64)
		const d2 = suiTxDigestFromBytesBase64(b64)
		expect(d1).toBe(d2)
		expect(d1.length).toBeGreaterThan(20)
		expect(sameSuiTxDigest(d1, d2)).toBe(true)
		expect(sameSuiTxDigest(d1, d1.toLowerCase() === d1 ? d1.toUpperCase() : d1.toLowerCase())).toBe(
			d1 === d1.toLowerCase() && d1 === d1.toUpperCase() ? true : false,
		)
	})
})
