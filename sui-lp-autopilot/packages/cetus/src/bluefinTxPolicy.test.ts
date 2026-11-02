import { describe, expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { BLUEFIN_SPOT_MAINNET } from './bluefinConfig.js'
import { verifyBluefinUnsignedTx } from './bluefinTxPolicy.js'

const OWNER = `0x${'11'.repeat(32)}`
const STRANGER = `0x${'22'.repeat(32)}`
const PKG = BLUEFIN_SPOT_MAINNET.CurrentPackage
const SUI = '0x2::sui::SUI'
const USDC =
	'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

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

describe('Bluefin manual-sign payload policy', () => {
	it('accepts open_position + TransferObjects to OWNER', async () => {
		const raw = await bytesOf((tx) => {
			const [pos] = tx.moveCall({
				target: `${PKG}::pool::open_position`,
				typeArguments: [SUI, USDC],
				arguments: [],
			})
			tx.transferObjects([pos], OWNER)
		})
		const report = await verifyBluefinUnsignedTx(raw, OWNER)
		expect(report.policyOk).toBe(true)
		expect(report.recipients).toContain(OWNER)
		expect(report.moveCalls.map((c) => `${c.module}::${c.function}`)).toEqual(['pool::open_position'])
	})

	it('accepts gateway::provide_liquidity_with_fixed_amount', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${PKG}::gateway::provide_liquidity_with_fixed_amount`,
				typeArguments: [SUI, USDC],
			})
			tx.transferObjects([tx.pure.u64(1)], OWNER)
		})
		const report = await verifyBluefinUnsignedTx(raw, OWNER)
		expect(report.policyOk).toBe(true)
	})

	it('accepts gateway::close_position without TransferObjects (sender-settled)', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${PKG}::gateway::close_position`,
				typeArguments: [SUI, USDC],
			})
		})
		const report = await verifyBluefinUnsignedTx(raw, OWNER)
		expect(report.policyOk).toBe(true)
		expect(report.moveCalls.map((c) => `${c.module}::${c.function}`)).toEqual(['gateway::close_position'])
	})

	it('accepts gateway::collect_fee + collect_reward without TransferObjects', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${PKG}::gateway::collect_fee`,
				typeArguments: [SUI, USDC],
			})
			tx.moveCall({
				target: `${PKG}::gateway::collect_reward`,
				typeArguments: [SUI, USDC, SUI],
			})
		})
		const report = await verifyBluefinUnsignedTx(raw, OWNER)
		expect(report.policyOk).toBe(true)
	})

	it('rejects third-party TransferObjects recipient', async () => {
		const raw = await bytesOf((tx) => {
			const [pos] = tx.moveCall({
				target: `${PKG}::pool::open_position`,
				typeArguments: [SUI, USDC],
			})
			tx.transferObjects([pos], STRANGER)
		})
		await expect(verifyBluefinUnsignedTx(raw, OWNER)).rejects.toThrow(/third-party recipient/)
	})

	it('rejects unknown Move package', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `0x${'ff'.repeat(32)}::pool::open_position`,
				typeArguments: [SUI, USDC],
			})
			tx.transferObjects([tx.pure.u64(1)], OWNER)
		})
		await expect(verifyBluefinUnsignedTx(raw, OWNER)).rejects.toThrow(/unexpected Bluefin package/)
	})

	it('principal-only remove accepts gateway::remove_liquidity alone', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${PKG}::gateway::remove_liquidity`,
				typeArguments: [SUI, USDC],
			})
		})
		const report = await verifyBluefinUnsignedTx(raw, OWNER, { kind: 'remove' })
		expect(report.policyOk).toBe(true)
		expect(report.moveCalls.map((c) => `${c.module}::${c.function}`)).toEqual([
			'gateway::remove_liquidity',
		])
	})

	it('principal-only remove rejects collect_fee / collect_reward in the same PTB', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${PKG}::gateway::remove_liquidity`,
				typeArguments: [SUI, USDC],
			})
			tx.moveCall({
				target: `${PKG}::gateway::collect_fee`,
				typeArguments: [SUI, USDC],
			})
		})
		await expect(verifyBluefinUnsignedTx(raw, OWNER, { kind: 'remove' })).rejects.toThrow(
			/principal-only|forbids/,
		)
	})

	it('collect kind rejects remove_liquidity', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${PKG}::gateway::remove_liquidity`,
				typeArguments: [SUI, USDC],
			})
		})
		await expect(verifyBluefinUnsignedTx(raw, OWNER, { kind: 'collect_fee' })).rejects.toThrow(
			/forbids|unexpected/,
		)
	})

	it('add kind accepts provide_liquidity_with_fixed_amount and rejects close', async () => {
		const ok = await bytesOf((tx) => {
			tx.moveCall({
				target: `${PKG}::gateway::provide_liquidity_with_fixed_amount`,
				typeArguments: [SUI, USDC],
			})
			tx.transferObjects([tx.pure.u64(1)], OWNER)
		})
		await expect(verifyBluefinUnsignedTx(ok, OWNER, { kind: 'add' })).resolves.toMatchObject({
			policyOk: true,
		})
		const bad = await bytesOf((tx) => {
			tx.moveCall({
				target: `${PKG}::gateway::close_position`,
				typeArguments: [SUI, USDC],
			})
		})
		await expect(verifyBluefinUnsignedTx(bad, OWNER, { kind: 'add' })).rejects.toThrow(/forbids|unexpected/)
	})

	it('add kind accepts provide_liquidity without TransferObjects (one-sided / no leftovers)', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${PKG}::gateway::provide_liquidity_with_fixed_amount`,
				typeArguments: [SUI, USDC],
			})
		})
		await expect(verifyBluefinUnsignedTx(raw, OWNER, { kind: 'add' })).resolves.toMatchObject({
			policyOk: true,
			recipients: [],
		})
	})

	it('remove rejects open_position (action substitution)', async () => {
		const raw = await bytesOf((tx) => {
			const [pos] = tx.moveCall({
				target: `${PKG}::pool::open_position`,
				typeArguments: [SUI, USDC],
				arguments: [],
			})
			tx.transferObjects([pos], OWNER)
		})
		await expect(verifyBluefinUnsignedTx(raw, OWNER, { kind: 'remove' })).rejects.toThrow(
			/forbids|unexpected/,
		)
	})

	it('rejects wrong position when expected', async () => {
		const POS = `0x${'aa'.repeat(32)}`
		const POOL = `0x${'bb'.repeat(32)}`
		const OTHER = `0x${'cc'.repeat(32)}`
		const raw = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: OTHER,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({
				objectId: POOL,
				initialSharedVersion: 1,
				mutable: true,
			})
			tx.moveCall({
				target: `${PKG}::gateway::remove_liquidity`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
		})
		await expect(
			verifyBluefinUnsignedTx(raw, OWNER, {
				kind: 'remove',
				poolId: POOL,
				positionId: POS,
			}),
		).rejects.toThrow(/expected position/)
	})

	it('rejects gas budget above Manage cap', async () => {
		const { BLUEFIN_MANUAL_MAX_GAS_BUDGET } = await import('./bluefinTxPolicy.js')
		const tx = new Transaction()
		tx.setSender(OWNER)
		tx.moveCall({
			target: `${PKG}::gateway::collect_fee`,
			typeArguments: [SUI, USDC],
		})
		tx.setGasPrice(1000)
		tx.setGasBudget(BLUEFIN_MANUAL_MAX_GAS_BUDGET + 1n)
		tx.setGasPayment([
			{
				objectId: `0x${'ab'.repeat(32)}`,
				version: 1,
				digest: '11111111111111111111111111111111',
			},
		])
		const raw = toBase64(await tx.build())
		await expect(verifyBluefinUnsignedTx(raw, OWNER, { kind: 'collect_fee' })).rejects.toThrow(
			/gas budget/,
		)
	})
})
