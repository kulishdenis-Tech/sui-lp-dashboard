import { describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { executeOrFetchLanded } from './executeOrFetchLanded'

async function bytes() {
	const tx = new Transaction()
	tx.setSender('0x' + '11'.repeat(32))
	tx.setGasPrice(1000)
	tx.setGasBudget(10_000_000)
	tx.setGasPayment([{ objectId: '0x' + '22'.repeat(32), version: '1', digest: '11111111111111111111111111111111' }])
	const [c] = tx.splitCoins(tx.gas, [1])
	tx.transferObjects([c], '0x' + '11'.repeat(32))
	return tx.build()
}

describe('executeOrFetchLanded', () => {
	it('returns the on-chain result and does not broadcast when already executed', async () => {
		const getTransaction = vi.fn().mockResolvedValue({ $kind: 'Transaction' })
		const executeTransaction = vi.fn()
		const out = await executeOrFetchLanded(
			{ getTransaction, executeTransaction },
			{ transaction: await bytes(), signatures: ['s'] },
		)
		expect(out).toEqual({ $kind: 'Transaction' })
		expect(executeTransaction).not.toHaveBeenCalled()
	})

	it('broadcasts when the digest is not on chain', async () => {
		const getTransaction = vi.fn().mockRejectedValue(new Error('not found'))
		const executeTransaction = vi.fn().mockResolvedValue('executed')
		const out = await executeOrFetchLanded(
			{ getTransaction, executeTransaction },
			{ transaction: await bytes(), signatures: ['s'] },
		)
		expect(out).toBe('executed')
		expect(executeTransaction).toHaveBeenCalledOnce()
	})
})
