import { describe, expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { CETUS_CLMM_MAINNET } from './clmmWhitelist.js'
import { CLMM_MANUAL_MAX_GAS_BUDGET, verifyClmmUnsignedTx } from './clmmTxPolicy.js'

const OWNER = `0x${'11'.repeat(32)}`
const STRANGER = `0x${'22'.repeat(32)}`
const POS = `0x${'aa'.repeat(32)}`
const POOL = `0x${'bb'.repeat(32)}`
const OTHER_POS = `0x${'cc'.repeat(32)}`
const INTEGRATE = CETUS_CLMM_MAINNET.integratePublishedAt
const CLMM_PUB = CETUS_CLMM_MAINNET.publishedAt
const SUI = '0x2::sui::SUI'
const USDC =
	'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

async function bytesOf(
	fill: (tx: Transaction) => void,
	opts?: { gasBudget?: bigint },
): Promise<string> {
	const tx = new Transaction()
	tx.setSender(OWNER)
	fill(tx)
	tx.setGasPrice(1000)
	tx.setGasBudget(opts?.gasBudget ?? 5_000_000n)
	tx.setGasPayment([
		{
			objectId: `0x${'ab'.repeat(32)}`,
			version: 1,
			digest: '11111111111111111111111111111111',
		},
	])
	return toBase64(await tx.build())
}

describe('CLMM manual-sign payload policy', () => {
	it('accepts SDK-style open_position_with_liquidity_by_fix_coin without TransferObjects', async () => {
		// Offline BCS only needs the Move call target; real open args are not required for policy.
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${INTEGRATE}::pool_script_v2::open_position_with_liquidity_by_fix_coin`,
				typeArguments: [SUI, USDC],
			})
		})
		const report = await verifyClmmUnsignedTx(raw, OWNER)
		expect(report.policyOk).toBe(true)
		expect(report.recipients).toContain(OWNER)
		expect(report.moveCalls.map((c) => `${c.module}::${c.function}`)).toEqual([
			'pool_script_v2::open_position_with_liquidity_by_fix_coin',
		])
	})

	it('accepts utils::transfer_coin_to_sender as OWNER settlement', async () => {
		const raw = await bytesOf((tx) => {
			const coin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [SUI] })
			tx.moveCall({
				target: `${INTEGRATE}::utils::transfer_coin_to_sender`,
				typeArguments: [SUI],
				arguments: [coin],
			})
		})
		const report = await verifyClmmUnsignedTx(raw, OWNER)
		expect(report.policyOk).toBe(true)
		expect(report.recipients).toEqual([OWNER])
	})

	it('accepts SDK-style pool_script::close_position without TransferObjects', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${INTEGRATE}::pool_script::close_position`,
				typeArguments: [SUI, USDC],
			})
		})
		const report = await verifyClmmUnsignedTx(raw, OWNER)
		expect(report.policyOk).toBe(true)
		expect(report.recipients).toContain(OWNER)
		expect(report.moveCalls.map((c) => `${c.module}::${c.function}`)).toEqual([
			'pool_script::close_position',
		])
	})

	it('accepts SDK-style pool_script_v2::collect_fee without TransferObjects', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${INTEGRATE}::pool_script_v2::collect_fee`,
				typeArguments: [SUI, USDC],
			})
		})
		const report = await verifyClmmUnsignedTx(raw, OWNER)
		expect(report.policyOk).toBe(true)
		expect(report.recipients).toContain(OWNER)
	})

	it('still rejects third-party TransferObjects', async () => {
		const raw = await bytesOf((tx) => {
			const coin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [SUI] })
			tx.transferObjects([coin], STRANGER)
		})
		await expect(verifyClmmUnsignedTx(raw, OWNER)).rejects.toThrow(/third-party recipient/)
	})

	it('remove kind rejects close_position (action substitution)', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${INTEGRATE}::pool_script::close_position`,
				typeArguments: [SUI, USDC],
			})
		})
		await expect(verifyClmmUnsignedTx(raw, OWNER, { kind: 'remove' })).rejects.toThrow(
			/forbids|unexpected/,
		)
	})

	it('remove kind rejects add_liquidity', async () => {
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${INTEGRATE}::pool_script_v2::add_liquidity_by_fixed_coin`,
				typeArguments: [SUI, USDC],
			})
		})
		await expect(verifyClmmUnsignedTx(raw, OWNER, { kind: 'remove' })).rejects.toThrow(
			/forbids|unexpected/,
		)
	})

	it('add kind accepts SDK fix_coin target with pool/position opts (UI contract)', async () => {
		const raw = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: POS,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({
				objectId: POOL,
				initialSharedVersion: 1,
				mutable: true,
			})
			tx.moveCall({
				target: `${INTEGRATE}::pool_script_v2::add_liquidity_by_fix_coin`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
			const coin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [SUI] })
			tx.transferObjects([coin], OWNER)
		})
		const report = await verifyClmmUnsignedTx(raw, OWNER, {
			kind: 'add',
			poolId: POOL,
			positionId: POS,
		})
		expect(report.policyOk).toBe(true)
		expect(report.moveCalls.map((c) => `${c.module}::${c.function}`)).toContain(
			'pool_script_v2::add_liquidity_by_fix_coin',
		)
	})

	it('add kind rejects when only fixed_coin typo was allowlisted historically', async () => {
		// Ensures the regression (KIND_ALLOW.add missing fix_coin) cannot return unnoticed:
		// SDK emits fix_coin; kind:add must accept it (covered above). This asserts remove still forbids it.
		const raw = await bytesOf((tx) => {
			tx.moveCall({
				target: `${INTEGRATE}::pool_script_v2::add_liquidity_by_fix_coin`,
				typeArguments: [SUI, USDC],
			})
		})
		await expect(verifyClmmUnsignedTx(raw, OWNER, { kind: 'remove' })).rejects.toThrow(
			/forbids|unexpected/,
		)
	})

	it('rejects wrong position object when expected', async () => {
		const raw = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: OTHER_POS,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({
				objectId: POOL,
				initialSharedVersion: 1,
				mutable: true,
			})
			tx.moveCall({
				target: `${CLMM_PUB}::pool::remove_liquidity`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
			const coin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [SUI] })
			tx.transferObjects([coin], OWNER)
		})
		await expect(
			verifyClmmUnsignedTx(raw, OWNER, {
				kind: 'remove',
				poolId: POOL,
				positionId: POS,
			}),
		).rejects.toThrow(/expected position/)
	})

	it('rejects wrong pool object when expected', async () => {
		const raw = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: POS,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({
				objectId: OTHER_POS,
				initialSharedVersion: 1,
				mutable: true,
			})
			tx.moveCall({
				target: `${CLMM_PUB}::pool::remove_liquidity`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
			const coin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [SUI] })
			tx.transferObjects([coin], OWNER)
		})
		await expect(
			verifyClmmUnsignedTx(raw, OWNER, {
				kind: 'remove',
				poolId: POOL,
				positionId: POS,
			}),
		).rejects.toThrow(/expected pool/)
	})

	it('rejects gas budget above Manage cap', async () => {
		const raw = await bytesOf(
			(tx) => {
				tx.moveCall({
					target: `${INTEGRATE}::pool_script_v2::collect_fee`,
					typeArguments: [SUI, USDC],
				})
			},
			{ gasBudget: CLMM_MANUAL_MAX_GAS_BUDGET + 1n },
		)
		await expect(verifyClmmUnsignedTx(raw, OWNER, { kind: 'collect_fee' })).rejects.toThrow(
			/gas budget/,
		)
	})

	it('rejects third-party recipient for remove with expected objects', async () => {
		const raw = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: POS,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({
				objectId: POOL,
				initialSharedVersion: 1,
				mutable: true,
			})
			tx.moveCall({
				target: `${CLMM_PUB}::pool::remove_liquidity`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
			const coin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [SUI] })
			tx.transferObjects([coin], STRANGER)
		})
		await expect(
			verifyClmmUnsignedTx(raw, OWNER, {
				kind: 'remove',
				poolId: POOL,
				positionId: POS,
			}),
		).rejects.toThrow(/third-party recipient/)
	})
})
