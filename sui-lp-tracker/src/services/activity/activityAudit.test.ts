import { describe, expect, it } from 'vitest'
import { PROTOCOL_PACKAGES } from '@/utils/constants'
import { HAEDAL_VAULTS_V2_PACKAGE } from '@/utils/haedalVault'
import { collectFeesExplicitlyZero, interpretActivity, ACTIVITY_PARSER_VERSION, type RawActivityTx } from '@/services/activity/activityModel'
import { mapExecutionStatus, mergeRawActivity, appendRawSlice } from '@/services/activity/activityGraphql'
import { commitPageProgress, createSingleFlight, retryDelayMs } from '@/services/activity/activitySync'
import { displayAmount, humanRaw, activityExportRows } from '@/services/activity/activityExport'
import {
	clearActivityCache,
	loadActivityCache,
	migrateV1Records,
	rawRecordKey,
	saveActivityBatch,
	activityMetaId,
	type ActivityDriver,
	type StoreName,
} from '@/services/activity/activityIdb'
import { CURRENT_PROTOCOL_PACKAGE } from '@/services/activity/activityClassify'

const A = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const B = '0xdb3421ccb4c6320be2485969f7f679189e6507cdb462f3be838edee045f3771a'
const SUI = '0x2::sui::SUI'
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

function raw(partial: Partial<RawActivityTx> & Pick<RawActivityTx, 'digest'>): RawActivityTx {
	return {
		checkpoint: '1',
		timestampMs: 1_700_000_000_000,
		status: 'success',
		sender: A,
		gasSponsor: A,
		gasBudget: '1',
		gasPrice: '1',
		computationCost: '1',
		storageCost: '0',
		storageRebate: '0',
		balanceChanges: [],
		events: [],
		objectChanges: [],
		balanceTruncated: false,
		eventsTruncated: false,
		objectsTruncated: false,
		...partial,
	}
}

function memoryDriver(): ActivityDriver & { dump(store: StoreName): Record<string, unknown>[] } {
	const stores: Record<StoreName, Map<string, Record<string, unknown>>> = {
		raw: new Map(),
		membership: new Map(),
		interpretation: new Map(),
		meta: new Map(),
	}
	return {
		dump: (store) => [...stores[store].values()],
		async put(store, value) {
			const key = String(value.key ?? value.id)
			stores[store].set(key, value)
		},
		async get(store, key) {
			return stores[store].get(key)
		},
		async delete(store, key) {
			stores[store].delete(key)
		},
		async where(store, field, value) {
			return [...stores[store].values()].filter((row) => row[field] === value)
		},
	}
}

describe('activity audit', () => {
	it('maps only an explicit SUCCESS to success', () => {
		expect(mapExecutionStatus('SUCCESS')).toBe('success')
		expect(mapExecutionStatus('FAILURE')).toBe('failure')
		expect(mapExecutionStatus(undefined)).toBe('unknown')
		expect(mapExecutionStatus('PENDING')).toBe('unknown')
		const unknown = interpretActivity(raw({ digest: 'u', status: 'unknown', statusDetail: 'PENDING', events: [
			{ seq: '0', type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::SwapEvent`, json: { amount_in: '1', amount_out: '2' } },
		] }), A)
		expect(unknown.activities.every((a) => a.kind !== 'swap')).toBe(true)
		expect(unknown.completeness).toBe('partial')
	})

	it('does not give a gas sponsor the sender swap', () => {
		const row = interpretActivity(raw({
			digest: 'sponsored',
			sender: B,
			gasSponsor: A,
			computationCost: '10',
			events: [{ seq: '0', type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::SwapEvent`, json: { amount_in: '5', amount_out: '4' } }],
			balanceChanges: [{ owner: B, coinType: SUI, amount: '-5' }],
		}), A)
		expect(row.activities.some((a) => a.kind === 'swap')).toBe(false)
		expect(row.feePaidByWallet).toBe(true)
		expect(row.completeness).toBe('partial')
	})

	it('gives the recipient their coins and not the sender protocol events', () => {
		const row = interpretActivity(raw({
			digest: 'ptb-recv',
			sender: B,
			gasSponsor: B,
			events: [{ seq: '0', type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::SwapEvent`, json: { amount_in: '5', amount_out: '4' } }],
			balanceChanges: [{ owner: A, coinType: USDC, amount: '4' }],
		}), A)
		expect(row.primaryKind).toBe('received')
		expect(row.activities.some((a) => a.kind === 'swap')).toBe(false)
	})

	it('does not assign one coin type to both sides of a two-token event', () => {
		const row = interpretActivity(raw({
			digest: 'two',
			events: [{
				seq: '0',
				type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::SwapEvent<${SUI}, ${USDC}>`,
				json: { amount_in: '10', amount_out: '9' },
			}],
		}), A)
		const coins = row.activities[0]?.actionAmounts.map((a) => a.coinType)
		expect(new Set(coins)).toEqual(new Set([
			'0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
			USDC,
		]))
		expect(row.activities[0]?.actionAmounts.every((a) => a.flow === 'unknown')).toBe(true)
	})

	it('keeps a vault share amount distinct from underlying tokens', () => {
		const row = interpretActivity(raw({
			digest: 'shares',
			events: [{
				seq: '0',
				type: `${HAEDAL_VAULTS_V2_PACKAGE}::vault::DepositEvent`,
				json: { amount_a: '1', amount_b: '2', lp_amount: '9' },
			}],
		}), A)
		expect(row.activities[0]?.actionAmounts.find((a) => a.role === 'lp_amount')?.unit).not.toBe('raw_coin')
	})

	it('calls an object mutation a change until owners prove a transfer', () => {
		const mutated = interpretActivity(raw({
			digest: 'mut',
			sender: B,
			gasSponsor: B,
			objectChanges: [{ objectId: '0xobj', idCreated: false, idDeleted: false }],
		}), A)
		expect(mutated.primaryKind).toBe('object_change')
		const moved = interpretActivity(raw({
			digest: 'moved',
			sender: B,
			gasSponsor: B,
			objectChanges: [{ objectId: '0xobj', idCreated: false, idDeleted: false, inputOwner: B, outputOwner: A }],
		}), A)
		expect(moved.primaryKind).toBe('object_transfer')
	})

	it('does not treat Current obligation creation or a deposit as multiply open', () => {
		const row = interpretActivity(raw({
			digest: 'current',
			events: [
				{
					seq: '0',
					type: `${CURRENT_PROTOCOL_PACKAGE}::enter_market::ObligationCreatedEvent`,
					json: { sender: A, obligation: '0xob', obligation_admin_cap: '0xcap' },
				},
				{
					seq: '1',
					type: `${CURRENT_PROTOCOL_PACKAGE}::deposit::DepositEvent`,
					json: { minter: A, obligation: '0xob', deposit_asset: { name: SUI.slice(2) }, deposit_amount: '100', ctoken_amount: '90' },
				},
				{
					seq: '2',
					type: `${CURRENT_PROTOCOL_PACKAGE}::borrow::BorrowEvent`,
					json: { borrower: A, obligation: '0xob', asset: { name: USDC.slice(2) }, amount: '40' },
				},
			],
		}), A)
		expect(row.activities.map((a) => a.kind)).toEqual(['contract_interaction', 'supply', 'borrow'])
		expect(row.activities.some((a) => a.kind.startsWith('multiply'))).toBe(false)
		const shares = row.activities.find((a) => a.kind === 'supply')?.actionAmounts.find((a) => a.role === 'ctoken_amount')
		expect(shares?.unit).toBe('shares')
	})

	it('does not replace a fuller cached transaction with a shorter page', () => {
		const full = raw({ digest: 'd', balanceChanges: [{ owner: A, coinType: SUI, amount: '1' }, { owner: A, coinType: USDC, amount: '2' }], balanceTruncated: false })
		const short = raw({ digest: 'd', balanceChanges: [{ owner: A, coinType: SUI, amount: '1' }], balanceTruncated: true })
		expect(mergeRawActivity(full, short).balanceChanges).toHaveLength(2)
	})

	it('keeps the older cursor when the newest page is refreshed', () => {
		const next = commitPageProgress(
			{ olderCursor: 'deep', hasOlder: true, newestMs: 10, oldestMs: 1, seenCursors: ['deep'] },
			{ mode: 'refresh', requestedCursor: null, olderCursor: 'newest-page', hasOlder: true, count: 2, timestamps: [20] },
		)
		expect(next.progress.olderCursor).toBe('deep')
		expect(next.progress.newestMs).toBe(20)
		expect(next.progress.oldestMs).toBe(1)
		const stuck = commitPageProgress(
			{ olderCursor: 'c', hasOlder: true, newestMs: null, oldestMs: null, seenCursors: [] },
			{ mode: 'older', requestedCursor: 'c', olderCursor: 'c', hasOlder: true, count: 1, timestamps: [1] },
		)
		expect(stuck.stopReason).toBe('cursor_repeat')
		expect(stuck.advanced).toBe(false)
	})

	it('stops rate-limit retries after three waits', () => {
		expect(retryDelayMs(0, 429)).toBeGreaterThan(0)
		expect(retryDelayMs(3, 429)).toBeNull()
		expect(retryDelayMs(0, 400)).toBeNull()
	})

	it('lets an address change replace the in-flight sync', async () => {
		const run = createSingleFlight()
		let release: () => void = () => undefined
		const first = run(() => new Promise<string>((resolve) => { release = () => resolve('old') }), 'replace')
		const second = run(async () => 'new', 'replace')
		release()
		expect(await first).toBe('old')
		expect(await second).toBe('new')
	})

	it('rejects a second sync while one is in flight', async () => {
		const run = createSingleFlight()
		let release: () => void = () => undefined
		const first = run(() => new Promise<string>((resolve) => { release = () => resolve('ok') }))
		expect(await run(async () => 'second')).toBe('busy')
		release()
		expect(await first).toBe('ok')
	})

	it('keeps address A when address B is cleared and reprocesses a stale parser', async () => {
		const driver = memoryDriver()
		const tx = raw({ digest: 'shared', balanceChanges: [{ owner: A, coinType: SUI, amount: '5' }, { owner: B, coinType: SUI, amount: '-5' }] })
		const meta = {
			id: activityMetaId(A),
			network: 'mainnet' as const,
			address: A,
			provider: 'mysten-graphql' as const,
			parserVersion: 3,
			olderCursor: 'cursor-a',
			hasOlder: true,
			exhausted: false,
			newestMs: tx.timestampMs,
			oldestMs: tx.timestampMs,
			updatedAtMs: 1,
		}
		await saveActivityBatch(A, [interpretActivity(tx, A)], [tx], meta, driver)
		await saveActivityBatch(B, [interpretActivity(tx, B)], [tx], { ...meta, address: B, olderCursor: 'cursor-b' }, driver)
		await clearActivityCache(B, driver)
		const reloadedA = await loadActivityCache(A, driver)
		expect(reloadedA.rows).toHaveLength(1)
		expect(reloadedA.meta?.olderCursor).toBe('cursor-a')
		expect(driver.dump('raw')).toHaveLength(1)
		const stale = driver.dump('interpretation')[0] as { key: string; row: { parserVersion: number } }
		await driver.put('interpretation', { ...stale, parserVersion: 1, row: { ...stale.row, parserVersion: 1 } })
		const reprocessed = await loadActivityCache(A, driver)
		expect(reprocessed.rows[0]?.parserVersion).toBe(ACTIVITY_PARSER_VERSION)
	})

	it('migrates only the membership v1 still had', () => {
		const plans = migrateV1Records(
			[{ address: A, row: interpretActivity(raw({ digest: 'once' }), A) }],
			[{ address: B, raw: raw({ digest: 'once' }) }],
		)
		const owners = plans.filter((p) => p.store === 'membership').map((p) => p.addressKey)
		expect(new Set(owners)).toEqual(new Set([A, B]))
		expect(plans.some((p) => p.store === 'raw' && p.key === rawRecordKey('once'))).toBe(true)
	})

	it('does not render an unknown-decimal raw integer as a token amount', () => {
		expect(displayAmount('1000000000', null)).toBe('Amount unavailable')
		expect(humanRaw('1000000000', 9)).toBe('1')
		expect(humanRaw('5', 0)).toBe('5')
		expect(humanRaw('-15', 1)).toBe('-1.5')
		const exported = activityExportRows(
			[interpretActivity(raw({
				digest: 'supply-export',
				events: [{
					seq: '0',
					type: `${CURRENT_PROTOCOL_PACKAGE}::deposit::DepositEvent`,
					json: { minter: A, deposit_asset: SUI, deposit_amount: '100', ctoken_amount: '90' },
				}],
			}), A)],
			A,
			{ loadedOnly: true, oldestMs: 1, newestMs: 2, exhausted: false, count: 1, parserVersion: 3 },
			'UTC',
		)
		const semantic = exported.find((row) => row.rowRole === 'activity' && row.activityType === 'supply')
		expect(semantic?.direction).toBe('unknown')
		expect(semantic?.historicalUsd).toBe('unavailable')
	})

	it('appends a nested page without dropping the rows already stored', () => {
		const prev = raw({
			digest: 'nested',
			balanceChanges: [{ owner: A, coinType: SUI, amount: '1' }],
			balanceTruncated: true,
			balanceEndCursor: 'cursor',
		})
		const next = appendRawSlice(prev, {
			balanceChanges: [{ owner: A, coinType: USDC, amount: '2' }],
			balanceTruncated: false,
			balanceEndCursor: null,
		})
		expect(next.balanceChanges).toHaveLength(2)
		expect(next.balanceTruncated).toBe(false)
		expect(mergeRawActivity(next, raw({ digest: 'nested', balanceChanges: [{ owner: A, coinType: SUI, amount: '1' }], balanceTruncated: true })).balanceChanges).toHaveLength(2)
	})

	it('does not treat the same struct in another module as a Current deposit', () => {
		const row = interpretActivity(raw({
			digest: 'wrong-module',
			events: [{
				seq: '0',
				type: `${CURRENT_PROTOCOL_PACKAGE}::enter_market::DepositEvent`,
				json: { minter: A, deposit_asset: SUI, deposit_amount: '100' },
			}],
		}), A)
		expect(row.activities.some((a) => a.kind === 'supply')).toBe(false)
		const lone = interpretActivity(raw({
			digest: 'increase',
			events: [{
				seq: '0',
				type: `${PROTOCOL_PACKAGES.TURBOS}::pool::IncreaseLiquidityEvent`,
				json: {},
			}],
		}), A)
		expect(lone.primaryKind).toBe('add_liquidity')
		expect(lone.completeness).toBe('partial')
	})

	it('does not present a storage rebate as the Collect Fees amount', () => {
		const row = interpretActivity(raw({
			digest: '5urQP8W9YB32oEK4tAJXviE8WqeZSC3hxUbD3rYfqhUR',
			computationCost: '100000',
			storageCost: '52326000',
			storageRebate: '54539745',
			balanceChanges: [
				{ owner: A, coinType: SUI, amount: '2113745' },
				{ owner: A, coinType: USDC, amount: '473244672' },
			],
			events: [{
				seq: '0',
				type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::CollectFeeEvent`,
				json: { amount_a: '0', amount_b: '0' },
			}],
		}), A)
		const collect = row.activities.find((a) => a.kind === 'collect_fees')
		expect(row.netFeeRaw).toBe('-2113745')
		expect(collectFeesExplicitlyZero(collect!)).toBe(true)
		expect(collect?.completeness).toBe('complete')
		expect(collect?.actionAmounts.map((a) => a.amountRaw)).toEqual(['0', '0'])
		expect(collect?.actionAmounts.every((a) => a.coinType === '')).toBe(true)
		expect(collect?.reasons.join(' ')).toContain('coin types')
		expect(collect?.reasons.join(' ')).not.toContain('unavailable')
		expect(row.walletChanges.some((c) => c.amountRaw === '2113745')).toBe(true)
		const exported = activityExportRows(
			[row],
			A,
			{ loadedOnly: true, oldestMs: 1, newestMs: 2, exhausted: false, count: 1, parserVersion: ACTIVITY_PARSER_VERSION },
			'UTC',
		)
		const collectRows = exported.filter((r) => r.activityType === 'collect_fees')
		expect(collectRows.some((r) => r.symbol === 'SUI' || r.amountRaw === '2113745')).toBe(false)
		expect(collectRows.map((r) => r.amountRaw)).toEqual(['0', '0'])
		expect(collectRows.every((r) => r.reconciliation.includes('explicit zero collect'))).toBe(true)
		const fee = exported.find((r) => r.rowRole === 'network_fee')
		expect(fee?.feeRaw).toBe('-2113745')
		const walletSui = exported.find((r) => r.rowRole === 'wallet_change' && r.symbol === 'SUI')
		expect(walletSui?.includesNetworkFee).toBe('yes')
		expect(walletSui?.amountRaw).toBe('2113745')
	})

	it('keeps a typed collect amount and does not replace it with the gas refund', () => {
		const row = interpretActivity(raw({
			digest: 'typed-collect',
			computationCost: '100000',
			storageCost: '52326000',
			storageRebate: '54539745',
			balanceChanges: [{ owner: A, coinType: SUI, amount: '2113745' }],
			events: [{
				seq: '0',
				type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::CollectFeeEvent<${SUI}, ${USDC}>`,
				json: { amount_a: '5', amount_b: '0' },
			}],
		}), A)
		expect(row.activities[0]?.actionAmounts.map((a) => a.amountRaw)).toEqual(['5', '0'])
		expect(row.activities[0]?.actionAmounts.some((a) => a.amountRaw === '2113745')).toBe(false)
		expect(collectFeesExplicitlyZero(row.activities[0]!)).toBe(false)
	})

	it('uses Current deposit_amount as underlying and keeps an equal ctoken as shares', () => {
		const deep = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'
		const row = interpretActivity(raw({
			digest: '6nSP4CZb7UKsmoayxDhUVbY4mwxq8PdG8bEPZsuWYsrB',
			computationCost: '100000',
			storageCost: '60959600',
			storageRebate: '35009699',
			balanceChanges: [
				{ owner: A, coinType: SUI, amount: '-26049901' },
				{ owner: A, coinType: deep, amount: '-232042375965' },
			],
			events: [{
				seq: '1',
				type: `${CURRENT_PROTOCOL_PACKAGE}::deposit::DepositEvent`,
				json: {
					minter: A,
					deposit_asset: { name: deep.slice(2) },
					deposit_amount: '232042375965',
					ctoken_amount: '232042375965',
				},
			}],
		}), A)
		const supply = row.activities.find((a) => a.kind === 'supply')
		const underlying = supply?.actionAmounts.find((a) => a.role === 'deposit_amount')
		const shares = supply?.actionAmounts.find((a) => a.role === 'ctoken_amount')
		expect(underlying).toMatchObject({ amountRaw: '232042375965', unit: 'raw_coin' })
		expect(underlying?.coinType.endsWith('::deep::DEEP')).toBe(true)
		expect(shares).toMatchObject({ amountRaw: '232042375965', unit: 'shares', coinType: '' })
		const exported = activityExportRows(
			[row],
			A,
			{ loadedOnly: true, oldestMs: 1, newestMs: 2, exhausted: false, count: 1 },
			'UTC',
		)
		const shareRow = exported.find((r) => r.rowRole === 'activity' && r.amountUnit === 'shares')
		expect(shareRow?.symbol).toBe('')
		expect(shareRow?.amountRaw).toBe('232042375965')
		const sharesOnly = interpretActivity(raw({
			digest: 'shares-only',
			events: [{
				seq: '0',
				type: `${CURRENT_PROTOCOL_PACKAGE}::deposit::DepositEvent`,
				json: { minter: A, ctoken_amount: '90' },
			}],
		}), A)
		expect(sharesOnly.activities[0]?.actionAmounts.some((a) => a.unit === 'raw_coin' && a.coinType.includes('DEEP'))).toBe(false)
		expect(sharesOnly.completeness).toBe('partial')
	})
})
