import { describe, expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { CETUS_CLMM_MAINNET } from './clmmWhitelist.js'
import {
	AUTO_WITHDRAW_MAX_GAS_BUDGET,
	verifyAutoWithdrawUnsignedTx,
	type AutoWithdrawTxExpect,
} from './autoWithdrawTxPolicy.js'
import { verifyClmmUnsignedTx } from './clmmTxPolicy.js'

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

const baseExpect: AutoWithdrawTxExpect = {
	owner: OWNER,
	network: 'mainnet',
	protocol: 'clmm',
	poolId: POOL,
	positionId: POS,
	collectFee: false,
}

async function bytesOf(
	fill: (tx: Transaction) => void,
	opts?: { gasBudget?: bigint; sender?: string },
): Promise<string> {
	const tx = new Transaction()
	tx.setSender(opts?.sender ?? OWNER)
	fill(tx)
	tx.setGasPrice(1000n)
	tx.setGasBudget(opts?.gasBudget ?? 50_000_000n)
	tx.setGasPayment([
		{
			objectId: `0x${'ab'.repeat(32)}`,
			version: '1',
			digest: '11111111111111111111111111111111',
		},
	])
	return toBase64(await tx.build())
}

function removeOnly(tx: Transaction, positionId = POS, poolId = POOL): void {
	const pos = tx.objectRef({
		objectId: positionId,
		version: '1',
		digest: '11111111111111111111111111111111',
	})
	const pool = tx.sharedObjectRef({ objectId: poolId, initialSharedVersion: 1, mutable: true })
	tx.moveCall({
		target: `${CLMM_PUB}::pool::remove_liquidity`,
		typeArguments: [SUI, USDC],
		arguments: [pool, pos],
	})
	const coin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [SUI] })
	tx.transferObjects([coin], OWNER)
}

describe('Auto Withdraw action-specific policy', () => {
	it('accepts remove_liquidity to OWNER with expected pool+position', async () => {
		const raw = await bytesOf((tx) => removeOnly(tx))
		const report = await verifyAutoWithdrawUnsignedTx(raw, baseExpect)
		expect(report.policyOk).toBe(true)
		expect(report.recipients).toContain(OWNER)
		expect(report.moveCalls.some((c) => c.function === 'remove_liquidity')).toBe(true)
	})

	it('rejects close_position that general Manage policy accepts', async () => {
		const raw = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: POS,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({ objectId: POOL, initialSharedVersion: 1, mutable: true })
			tx.moveCall({
				target: `${INTEGRATE}::pool_script::close_position`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
		})
		await expect(verifyClmmUnsignedTx(raw, OWNER)).resolves.toMatchObject({ policyOk: true })
		await expect(verifyAutoWithdrawUnsignedTx(raw, baseExpect)).rejects.toThrow(
			/forbids|must include remove/i,
		)
	})

	it('rejects open_position', async () => {
		const raw = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: POS,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({ objectId: POOL, initialSharedVersion: 1, mutable: true })
			tx.moveCall({
				target: `${INTEGRATE}::pool_script_v2::open_position_with_liquidity_by_fix_coin`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
			tx.transferObjects([tx.moveCall({ target: '0x2::coin::zero', typeArguments: [SUI] })], OWNER)
		})
		await expect(verifyAutoWithdrawUnsignedTx(raw, baseExpect)).rejects.toThrow(/forbids/i)
	})

	it('rejects wrong owner sender', async () => {
		const raw = await bytesOf((tx) => removeOnly(tx), { sender: STRANGER })
		await expect(verifyAutoWithdrawUnsignedTx(raw, baseExpect)).rejects.toThrow(/OWNER/i)
	})

	it('rejects wrong position object', async () => {
		const raw = await bytesOf((tx) => removeOnly(tx, OTHER_POS, POOL))
		await expect(verifyAutoWithdrawUnsignedTx(raw, baseExpect)).rejects.toThrow(/position object/i)
	})

	it('rejects wrong pool object', async () => {
		const otherPool = `0x${'dd'.repeat(32)}`
		const raw = await bytesOf((tx) => removeOnly(tx, POS, otherPool))
		await expect(verifyAutoWithdrawUnsignedTx(raw, baseExpect)).rejects.toThrow(/pool object/i)
	})

	it('rejects third-party TransferObjects', async () => {
		const raw = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: POS,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({ objectId: POOL, initialSharedVersion: 1, mutable: true })
			tx.moveCall({
				target: `${CLMM_PUB}::pool::remove_liquidity`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
			tx.transferObjects([tx.moveCall({ target: '0x2::coin::zero', typeArguments: [SUI] })], STRANGER)
		})
		await expect(verifyAutoWithdrawUnsignedTx(raw, baseExpect)).rejects.toThrow(/third-party/i)
	})

	it('Bluefin principal-only accepts gateway::remove_liquidity and rejects collect', async () => {
		const PKG = '0xd075338d105482f1527cbfd363d6413558f184dec36d9138a70261e87f486e9c'
		const bluefinExpect: AutoWithdrawTxExpect = {
			...baseExpect,
			protocol: 'bluefin',
			collectFee: false,
		}
		const ok = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: POS,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({ objectId: POOL, initialSharedVersion: 1, mutable: true })
			tx.moveCall({
				target: `${PKG}::gateway::remove_liquidity`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
		})
		const report = await verifyAutoWithdrawUnsignedTx(ok, bluefinExpect)
		expect(report.policyOk).toBe(true)

		const withCollect = await bytesOf((tx) => {
			const pos = tx.objectRef({
				objectId: POS,
				version: '1',
				digest: '11111111111111111111111111111111',
			})
			const pool = tx.sharedObjectRef({ objectId: POOL, initialSharedVersion: 1, mutable: true })
			tx.moveCall({
				target: `${PKG}::gateway::remove_liquidity`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
			tx.moveCall({
				target: `${PKG}::gateway::collect_fee`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
		})
		await expect(verifyAutoWithdrawUnsignedTx(withCollect, bluefinExpect)).rejects.toThrow(
			/collect not selected|forbids/,
		)
	})

	it('rejects collect when collectFee is false', async () => {
		const raw = await bytesOf((tx) => {
			removeOnly(tx)
			const pos = tx.objectRef({
				objectId: POS,
				version: '2',
				digest: '22222222222222222222222222222222',
			})
			const pool = tx.sharedObjectRef({ objectId: POOL, initialSharedVersion: 1, mutable: true })
			tx.moveCall({
				target: `${CLMM_PUB}::pool::collect_fee`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
		})
		await expect(verifyAutoWithdrawUnsignedTx(raw, { ...baseExpect, collectFee: false })).rejects.toThrow(
			/collect not selected/i,
		)
	})

	it('allows collect when collectFee is true', async () => {
		const raw = await bytesOf((tx) => {
			removeOnly(tx)
			const pos = tx.objectRef({
				objectId: POS,
				version: '2',
				digest: '22222222222222222222222222222222',
			})
			const pool = tx.sharedObjectRef({ objectId: POOL, initialSharedVersion: 1, mutable: true })
			tx.moveCall({
				target: `${CLMM_PUB}::pool::collect_fee`,
				typeArguments: [SUI, USDC],
				arguments: [pool, pos],
			})
		})
		const report = await verifyAutoWithdrawUnsignedTx(raw, { ...baseExpect, collectFee: true })
		expect(report.policyOk).toBe(true)
	})

	it('rejects gas budget above cap', async () => {
		const raw = await bytesOf((tx) => removeOnly(tx), {
			gasBudget: AUTO_WITHDRAW_MAX_GAS_BUDGET + 1n,
		})
		await expect(verifyAutoWithdrawUnsignedTx(raw, baseExpect)).rejects.toThrow(/gas budget/i)
	})

	it('rejects testnet network expectation', async () => {
		const raw = await bytesOf((tx) => removeOnly(tx))
		await expect(
			verifyAutoWithdrawUnsignedTx(raw, { ...baseExpect, network: 'testnet' }),
		).rejects.toThrow(/mainnet/i)
	})
})
