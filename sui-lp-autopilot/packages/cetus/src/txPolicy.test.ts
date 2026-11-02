import { describe, expect, it } from 'vitest'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { CETUS_DLMM_MAINNET } from './whitelist.js'
import { verifyUnsignedTx } from './txPolicy.js'

const OWNER = `0x${'11'.repeat(32)}`
const STRANGER = `0x${'22'.repeat(32)}`

async function bytesOf(fill: (tx: Transaction) => void): Promise<string> {
	const tx = new Transaction()
	tx.setSender(OWNER)
	fill(tx)
	tx.setGasPrice(1000)
	tx.setGasBudget(5_000_000)
	tx.setGasPayment([
		{
			objectId: `0x${'ab'.repeat(32)}`,
			version: 1,
			digest: '11111111111111111111111111111111',
		},
	])
	return toBase64(await tx.build())
}

describe('manual-sign payload policy', () => {
	it('accepts a framework call that pays only the owner', async () => {
		const raw = await bytesOf((tx) => {
			const coin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: ['0x2::sui::SUI'] })
			tx.transferObjects([coin], OWNER)
		})
		const report = await verifyUnsignedTx(raw, OWNER)
		expect(report.policyOk).toBe(true)
		expect(report.recipients).toEqual([`0x${'11'.repeat(32)}`])
		expect(report.moveCalls.map((c) => c.function)).toEqual(['zero'])
		expect(report.payloadSha256).toMatch(/^[0-9a-f]{64}$/)
	})

	it('rejects a third-party recipient', async () => {
		const raw = await bytesOf((tx) => {
			const coin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: ['0x2::sui::SUI'] })
			tx.transferObjects([coin], STRANGER)
		})
		await expect(verifyUnsignedTx(raw, OWNER)).rejects.toThrow(/third-party recipient/)
	})

	it('rejects an unexpected Move call on the Cetus package', async () => {
		const raw = await bytesOf((tx) => {
			const coin = tx.moveCall({
				target: `${CETUS_DLMM_MAINNET.publishedAt}::pool::flash_swap`,
				typeArguments: ['0x2::sui::SUI'],
			})
			tx.transferObjects([coin], OWNER)
		})
		await expect(verifyUnsignedTx(raw, OWNER)).rejects.toThrow(/unexpected Move call/)
	})

	it('accepts a sender funds withdrawal and rejects send_funds to a stranger', async () => {
		const tx = new Transaction()
		tx.setSender(OWNER)
		const coin = coinWithBalance({ type: '0x2::sui::SUI', balance: 5n, useGasCoin: false })
		tx.transferObjects([coin(tx)], OWNER)
		tx.setGasPrice(1000)
		tx.setGasBudget(5_000_000)
		tx.setGasPayment([
			{ objectId: `0x${'ab'.repeat(32)}`, version: 1, digest: '11111111111111111111111111111111' },
		])
		const raw = toBase64(await tx.build({ assumeSufficientAddressBalances: true }))
		const report = await verifyUnsignedTx(raw, OWNER)
		expect(report.moveCalls.map((c) => c.function)).toEqual(['redeem_funds', 'send_funds'])

		const stolen = await bytesOf((built) => {
			const zero = built.moveCall({ target: '0x2::coin::zero', typeArguments: ['0x2::sui::SUI'] })
			built.moveCall({
				target: '0x2::coin::send_funds',
				typeArguments: ['0x2::sui::SUI'],
				arguments: [zero, built.pure.address(STRANGER)],
			})
			built.transferObjects([zero], OWNER)
		})
		await expect(verifyUnsignedTx(stolen, OWNER)).rejects.toThrow(/third-party recipient/)
	})

	it('rejects a pool function invoked on an unknown package', async () => {
		const raw = await bytesOf((tx) => {
			const coin = tx.moveCall({
				target: `0x${'33'.repeat(32)}::pool::remove_liquidity`,
				typeArguments: ['0x2::sui::SUI'],
			})
			tx.transferObjects([coin], OWNER)
		})
		await expect(verifyUnsignedTx(raw, OWNER)).rejects.toThrow(/unexpected package/)
	})
})
