import { describe, expect, it } from 'vitest'
import { PROTOCOL_PACKAGES } from '@/utils/constants'
import { HAEDAL_LENDING_VAULT_PACKAGE } from '@/utils/haedalLendingVault'
import {
	interpretActivity,
	signedNetFeeRaw,
	upsertActivity,
	type RawActivityTx,
} from '@/services/activity/activityModel'
import { activityExportRows, activityRowsToCsv, historicalPriceNote } from '@/services/activity/activityExport'
import { advanceBackfill, canBackfill, isCurrentGeneration, type BackfillCursor } from '@/services/activity/activitySync'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const OTHER = '0xdb3421ccb4c6320be2485969f7f679189e6507cdb462f3be838edee045f3771a'
const SUI = '0x2::sui::SUI'

function tx(partial: Partial<RawActivityTx> & Pick<RawActivityTx, 'digest'>): RawActivityTx {
	return {
		checkpoint: '1',
		timestampMs: 1_700_000_000_000,
		status: 'success',
		sender: OTHER,
		gasSponsor: OTHER,
		gasBudget: '1000',
		gasPrice: '750',
		computationCost: '750000',
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

describe('activity ledger', () => {
	it('keeps a signed net fee and does not clip a storage refund', () => {
		expect(signedNetFeeRaw('750000', '1976000', '978120')).toBe('1747880')
		expect(signedNetFeeRaw('100', '50', '200')).toBe('-50')
	})

	it('classifies an incoming transfer and does not charge the recipient the sender fee', () => {
		const row = interpretActivity(
			tx({
				digest: '9VGojLKFN2d89eproWWbG5APkAa461n5Cpg3DhX85CC1',
				sender: OTHER,
				gasSponsor: OTHER,
				computationCost: '750000',
				storageCost: '1976000',
				storageRebate: '978120',
				balanceChanges: [
					{ owner: WALLET, coinType: SUI, amount: '1000000000' },
					{ owner: OTHER, coinType: SUI, amount: '-1001747880' },
				],
			}),
			WALLET,
		)
		expect(row.primaryKind).toBe('received')
		expect(row.feePaidByWallet).toBe(false)
		expect(row.activities[0]?.actionAmounts[0]?.amountRaw).toBe('1000000000')
		expect(row.netFeeRaw).toBe('1747880')
	})

	it('classifies an outgoing transfer and separates gas from the sent amount', () => {
		const row = interpretActivity(
			tx({
				digest: 'out',
				sender: WALLET,
				gasSponsor: WALLET,
				computationCost: '100',
				storageCost: '0',
				storageRebate: '0',
				balanceChanges: [{ owner: WALLET, coinType: SUI, amount: '-1100' }],
			}),
			WALLET,
		)
		expect(row.primaryKind).toBe('sent')
		expect(row.feePaidByWallet).toBe(true)
		expect(row.suiDeltaIncludesFee).toBe(true)
		expect(row.walletChanges[0]?.amountRaw).toBe('-1100')
		expect(row.activities[0]?.actionAmounts[0]?.amountRaw).toBe('-1000')
	})

	it('classifies a self transfer when both legs stay on the address', () => {
		const row = interpretActivity(
			tx({
				digest: 'self',
				sender: WALLET,
				gasSponsor: WALLET,
				computationCost: '0',
				storageCost: '0',
				storageRebate: '0',
				balanceChanges: [
					{ owner: WALLET, coinType: SUI, amount: '-5' },
					{ owner: WALLET, coinType: SUI, amount: '5' },
				],
			}),
			WALLET,
		)
		expect(row.activities.some((a) => a.kind === 'self_transfer' || a.kind === 'contract_interaction')).toBe(true)
	})

	it('attributes sponsor gas to the sponsor, not the sender wallet', () => {
		const row = interpretActivity(
			tx({
				digest: 'sponsor',
				sender: WALLET,
				gasSponsor: OTHER,
				balanceChanges: [
					{ owner: WALLET, coinType: SUI, amount: '-1000' },
					{ owner: OTHER, coinType: SUI, amount: '-100' },
				],
			}),
			WALLET,
		)
		expect(row.feePayer).not.toBe(row.sender)
		expect(row.feePaidByWallet).toBe(false)
		expect(row.activities[0]?.actionAmounts[0]?.amountRaw).toBe('-1000')
	})

	it('does not label a failed transaction as a successful swap', () => {
		const row = interpretActivity(
			tx({
				digest: 'fail',
				status: 'failure',
				sender: WALLET,
				gasSponsor: WALLET,
				events: [
					{
						seq: '0',
						type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::SwapEvent`,
						json: { amount_in: '1', amount_out: '2' },
					},
				],
				balanceChanges: [{ owner: WALLET, coinType: SUI, amount: '-100' }],
			}),
			WALLET,
		)
		expect(row.primaryKind).toBe('failed')
		expect(row.activities.every((a) => a.kind !== 'swap')).toBe(true)
	})

	it('keeps swap and liquidity as separate actions and does not add balance legs', () => {
		const row = interpretActivity(
			tx({
				digest: 'ptb',
				sender: WALLET,
				gasSponsor: WALLET,
				events: [
					{
						seq: '0',
						type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::RemoveLiquidityV2Event`,
						json: { amount_a: '10', amount_b: '20', position: '0xabc' },
					},
					{
						seq: '1',
						type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::SwapEvent`,
						json: { amount_in: '10', amount_out: '9' },
					},
				],
				balanceChanges: [
					{ owner: WALLET, coinType: SUI, amount: '9' },
					{ owner: WALLET, coinType: '0x2::usdc::USDC', amount: '-1' },
				],
			}),
			WALLET,
		)
		expect(row.activities.map((a) => a.kind)).toEqual(['withdraw_liquidity', 'swap'])
		expect(row.walletChanges).toHaveLength(2)
		expect(row.activities.every((a) => a.kind !== 'received' && a.kind !== 'sent')).toBe(true)
	})

	it('maps a verified lending withdraw and keeps a foreign unknown event off this address', () => {
		const known = interpretActivity(
			tx({
				digest: 'lend',
				sender: WALLET,
				events: [
					{
						seq: '0',
						type: `${HAEDAL_LENDING_VAULT_PACKAGE}::vault_events::Withdrawn`,
						json: { amount: '42' },
					},
				],
			}),
			WALLET,
		)
		expect(known.primaryKind).toBe('withdraw')
		const unknown = interpretActivity(
			tx({
				digest: 'unk',
				events: [{ seq: '0', type: '0x123::borrow::BorrowEvent', json: { amount: '1' } }],
				balanceChanges: [{ owner: WALLET, coinType: SUI, amount: '5' }],
			}),
			WALLET,
		)
		expect(unknown.primaryKind).toBe('received')
		expect(unknown.activities.some((a) => a.kind === 'borrow')).toBe(false)
	})

	it('splits native unstake principal and reward only when both fields exist', () => {
		const split = interpretActivity(
			tx({
				digest: 'unstake',
				sender: WALLET,
				events: [
					{
						seq: '0',
						type: '0x3::validator::UnstakingRequestEvent',
						json: { principal_amount: '100', reward_amount: '7' },
					},
				],
			}),
			WALLET,
		)
		expect(split.primaryKind).toBe('unstake')
		expect(split.activities[0]?.actionAmounts.map((a) => a.role)).toEqual(['principal', 'reward'])
		const opaque = interpretActivity(
			tx({
				digest: 'unstake2',
				sender: WALLET,
				events: [{ seq: '0', type: '0x3::validator::UnstakingRequestEvent', json: { amount: '107' } }],
			}),
			WALLET,
		)
		expect(opaque.activities[0]?.actionAmounts).toHaveLength(0)
		expect(opaque.completeness).toBe('partial')
	})

	it('records an object transfer without requiring a coin amount', () => {
		const row = interpretActivity(
			tx({
				digest: 'nft',
				sender: OTHER,
				objectChanges: [{ objectId: '0xobj', idCreated: false, idDeleted: false }],
			}),
			WALLET,
		)
		expect(row.primaryKind).toBe('object_change')
		expect(row.activities[0]?.actionAmounts).toHaveLength(0)
		expect(row.activities[0]?.objectIds).toContain('0xobj')
	})

	it('classifies Cetus liquidity emitted by the CLMM package used in close fixtures', () => {
		const row = interpretActivity(
			tx({
				digest: 'cetus-v2-pkg',
				sender: WALLET,
				events: [
					{
						seq: '0',
						type: '0xdb5cd62a06c79695bfc9982eb08534706d3752fe123b48e0144f480209b3117f::pool::AddLiquidityV2Event',
						json: { amount_a: '10', amount_b: '20' },
					},
				],
			}),
			WALLET,
		)
		expect(row.primaryKind).toBe('add_liquidity')
		expect(row.activities[0]?.protocol).toBe('Cetus')
	})

	it('keeps a matched swap and records an unmatched event as a partial contract call', () => {
		const row = interpretActivity(
			tx({
				digest: 'mixed',
				sender: WALLET,
				events: [
					{
						seq: '0',
						type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::SwapEvent`,
						json: { amount_in: '1', amount_out: '2' },
					},
					{ seq: '1', type: '0x123::borrow::BorrowEvent', json: { amount: '5' } },
				],
			}),
			WALLET,
		)
		expect(row.activities.map((a) => a.kind)).toEqual(['swap', 'contract_interaction'])
		expect(row.completeness).toBe('partial')
		expect(row.activities.some((a) => a.kind === 'borrow' || a.kind === 'received')).toBe(false)
	})

	it('keeps a withdraw and a reward claim as separate actions', () => {
		const row = interpretActivity(
			tx({
				digest: 'lp-claim',
				sender: WALLET,
				gasSponsor: WALLET,
				events: [
					{
						seq: '0',
						type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::RemoveLiquidityV2Event`,
						json: { amount_a: '10', amount_b: '20', coin_type: SUI },
					},
					{
						seq: '1',
						type: `${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::CollectRewardV2Event`,
						json: { amount: '3', coin_type: SUI },
					},
				],
				balanceChanges: [{ owner: WALLET, coinType: SUI, amount: '13' }],
			}),
			WALLET,
		)
		expect(row.activities.map((a) => a.kind)).toEqual(['withdraw_liquidity', 'claim_rewards'])
		expect(row.activities.every((a) => a.kind !== 'received')).toBe(true)
	})

	it('leaves an unknown token amount raw and does not invent decimals', () => {
		const unknownCoin = '0xabc::spam::TOKEN'
		const row = interpretActivity(
			tx({
				digest: 'unknown-token',
				sender: OTHER,
				balanceChanges: [{ owner: WALLET, coinType: unknownCoin, amount: '123456' }],
			}),
			WALLET,
		)
		const exported = activityExportRows(
			[row],
			WALLET,
			{ loadedOnly: true, oldestMs: 1, newestMs: 2, exhausted: false, count: 1 },
			'UTC',
		)
		const leg = exported.find((r) => r.rowRole === 'activity')
		expect(leg?.decimals).toBe('')
		expect(leg?.amountHuman).toBe('')
		expect(leg?.amountRaw).toBe('123456')
		expect(leg?.symbol).toBe('')
	})

	it('records a missing historical price as unavailable', () => {
		expect(historicalPriceNote(null, '2024-01-01T00:00:00.000Z')).toEqual({ unavailable: true })
		expect(historicalPriceNote(Number.NaN, '2024-01-01T00:00:00.000Z')).toEqual({ unavailable: true })
		expect(historicalPriceNote(1.25, '2024-01-01T00:00:00.000Z')).toEqual({
			usd: '1.25',
			source: 'pyth',
			timeUtc: '2024-01-01T00:00:00.000Z',
		})
	})

	it('upserts overlapping pages by digest', () => {
		const a = interpretActivity(tx({ digest: 'a', timestampMs: 2 }), WALLET)
		const b = interpretActivity(tx({ digest: 'b', timestampMs: 1 }), WALLET)
		const again = interpretActivity(tx({ digest: 'a', timestampMs: 3 }), WALLET)
		const merged = upsertActivity(upsertActivity([a], [b]), [again])
		expect(merged.map((t) => t.digest)).toEqual(['a', 'b'])
		expect(merged[0]?.timestampMs).toBe(3)
	})

	it('exports fee once and escapes formula-like text', () => {
		const row = interpretActivity(
			tx({
				digest: '=cmd',
				sender: WALLET,
				gasSponsor: WALLET,
				computationCost: '10',
				storageCost: '0',
				storageRebate: '0',
				balanceChanges: [{ owner: WALLET, coinType: SUI, amount: '-10' }],
			}),
			WALLET,
		)
		const csv = activityRowsToCsv(
			activityExportRows([row], WALLET, { loadedOnly: true, oldestMs: 1, newestMs: 2, exhausted: false, count: 1 }, 'UTC'),
		)
		expect(csv.split('\n').filter((line) => line.includes('network_fee')).length).toBe(1)
		expect(csv).toContain("'=cmd")
	})

	it('stops an interrupted backfill without dropping the cursor already reached', () => {
		let state: BackfillCursor = { before: 'page-1', hasOlder: true, pages: 0, paused: false }
		expect(canBackfill(state, 30)).toBe(true)
		state = advanceBackfill(state, { olderCursor: 'page-2', hasOlder: true })
		state = { ...state, paused: true }
		expect(state.before).toBe('page-2')
		expect(canBackfill(state, 30)).toBe(false)
		state = { ...state, paused: false }
		expect(canBackfill(state, 30)).toBe(true)
	})

	it('discards a response after the address generation changes', () => {
		const requested = 1
		const current = 2
		expect(isCurrentGeneration(requested, current)).toBe(false)
		expect(isCurrentGeneration(2, 2)).toBe(true)
		const discarded = advanceBackfill(
			{ before: 'old', hasOlder: true, pages: 1, paused: false },
			null,
		)
		expect(discarded.paused).toBe(true)
		expect(discarded.before).toBe('old')
	})
})
