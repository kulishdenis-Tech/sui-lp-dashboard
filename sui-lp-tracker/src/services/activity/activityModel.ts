/**
 * Address activity ledger.
 * Source: official Sui GraphQL `transactions(filter: { affectedAddress })`.
 * https://docs.sui.io/references/sui-api/sui-graphql/beta/reference/types/inputs/transaction-filter
 *
 * `affectedAddress` covers sender, sponsor, and recipient. It is not a proof that
 * every checkpoint for the address was indexed. Loaded ranges stay explicit.
 */
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { NATIVE_SUI_COIN_TYPE, normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import { classifyActivities } from '@/services/activity/activityClassify'

export const ACTIVITY_PARSER_VERSION = 5
export const ACTIVITY_NETWORK = 'mainnet' as const

export type ActivityKind =
	| 'sent'
	| 'received'
	| 'self_transfer'
	| 'swap'
	| 'add_liquidity'
	| 'withdraw_liquidity'
	| 'close_position'
	| 'collect_fees'
	| 'claim_rewards'
	| 'vault_deposit'
	| 'vault_withdraw'
	| 'supply'
	| 'withdraw'
	| 'borrow'
	| 'repay'
	| 'multiply_open'
	| 'multiply_increase'
	| 'multiply_reduce'
	| 'multiply_close'
	| 'stake'
	| 'unstake'
	| 'object_transfer'
	| 'object_change'
	| 'contract_interaction'
	| 'failed'

export type ActivityCompleteness = 'complete' | 'partial'

export type RawBalanceChange = { owner: string; coinType: string; amount: string }
export type RawActivityEvent = { seq: string; type: string; json: unknown }
export type RawObjectChange = {
	objectId: string
	idCreated: boolean | null
	idDeleted: boolean | null
	/** Address owner before the transaction, when GraphQL returned one. */
	inputOwner?: string | null
	/** Address owner after the transaction, when GraphQL returned one. */
	outputOwner?: string | null
}

/** Normalized transaction. Amounts stay decimal strings. */
export type RawActivityTx = {
	digest: string
	checkpoint: string | null
	timestampMs: number | null
	status: 'success' | 'failure' | 'unknown'
	/** Raw execution status from the provider, including unrecognized values. */
	statusDetail?: string | null
	sender: string | null
	gasSponsor: string | null
	gasBudget: string | null
	gasPrice: string | null
	computationCost: string | null
	storageCost: string | null
	storageRebate: string | null
	balanceChanges: RawBalanceChange[]
	events: RawActivityEvent[]
	objectChanges: RawObjectChange[]
	balanceTruncated: boolean
	eventsTruncated: boolean
	objectsTruncated: boolean
	balanceEndCursor?: string | null
	eventsEndCursor?: string | null
	objectsEndCursor?: string | null
}

export type AmountUnit = 'raw_coin' | 'shares' | 'fixed_point' | 'unknown'
export type AmountFlow = 'in' | 'out' | 'unknown'

export type ActionAmount = {
	coinType: string
	/** Signed raw integer. Null when the event has no verified amount. */
	amountRaw: string | null
	role: string
	unit: AmountUnit
	/** Wallet direction only when the amount is a proven address flow. */
	flow: AmountFlow
}

export type WalletChange = {
	coinType: string
	/** Signed raw delta as reported. SUI may already include the fee. */
	amountRaw: string
}

export type ActivityLeg = {
	id: string
	kind: ActivityKind
	protocol: string | null
	eventSeq: string | null
	actionAmounts: ActionAmount[]
	objectIds: string[]
	counterparty: string | null
	completeness: ActivityCompleteness
	reasons: string[]
}

export type ActivityTransaction = {
	network: typeof ACTIVITY_NETWORK
	digest: string
	checkpoint: string | null
	timestampMs: number | null
	sender: string | null
	gasSponsor: string | null
	/** Address that actually paid the fee. */
	feePayer: string | null
	gasBudget: string | null
	gasPrice: string | null
	/** computation + storage − rebate. Signed. Null when the summary is incomplete. */
	netFeeRaw: string | null
	feePaidByWallet: boolean
	/** True when this address's SUI delta already includes the fee. */
	suiDeltaIncludesFee: boolean
	status: 'success' | 'failure' | 'unknown'
	statusDetail: string | null
	balanceTruncated: boolean
	eventsTruncated: boolean
	objectsTruncated: boolean
	walletChanges: WalletChange[]
	activities: ActivityLeg[]
	primaryKind: ActivityKind
	completeness: ActivityCompleteness
	reasons: string[]
	parserVersion: typeof ACTIVITY_PARSER_VERSION
}

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
	sent: 'Sent',
	received: 'Received',
	self_transfer: 'Self Transfer',
	swap: 'Swap',
	add_liquidity: 'Add Liquidity',
	withdraw_liquidity: 'Withdraw Liquidity',
	close_position: 'Close Position',
	collect_fees: 'Collect Fees',
	claim_rewards: 'Claim Rewards',
	vault_deposit: 'Vault Deposit',
	vault_withdraw: 'Vault Withdrawal',
	supply: 'Supply',
	withdraw: 'Withdraw',
	borrow: 'Borrow',
	repay: 'Repay',
	multiply_open: 'Multiply Open',
	multiply_increase: 'Multiply Increase',
	multiply_reduce: 'Multiply Reduce',
	multiply_close: 'Multiply Close',
	stake: 'Stake',
	unstake: 'Unstake',
	object_transfer: 'Object Transfer',
	object_change: 'Object Change',
	contract_interaction: 'Contract Interaction',
	failed: 'Failed',
}

function addr(id: string | null | undefined): string | null {
	if (!id) return null
	try {
		return normalizeSuiAddress(id)
	} catch {
		return null
	}
}

function intString(v: unknown): string | null {
	if (typeof v === 'bigint') return v.toString()
	if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v)
	if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return v.trim()
	return null
}

/** Both protocol collect amounts are the integer 0. Missing coin types do not make that amount unknown. */
export function collectFeesExplicitlyZero(leg: { kind: ActivityKind; actionAmounts: ActionAmount[] }): boolean {
	return leg.kind === 'collect_fees'
		&& leg.actionAmounts.length >= 2
		&& leg.actionAmounts.every((amount) => amount.amountRaw === '0')
}

/** True when this SUI balance line is only the signed network fee or its refund. */
export function walletSuiChangeIsNetworkFee(
	tx: { feePaidByWallet: boolean; netFeeRaw: string | null },
	coinType: string,
	amountRaw: string,
): boolean {
	if (!tx.feePaidByWallet || tx.netFeeRaw == null) return false
	if (normalizeCoinTypeForMatch(coinType) !== NATIVE_SUI_COIN_TYPE) return false
	try {
		return BigInt(amountRaw) + BigInt(tx.netFeeRaw) === 0n
	} catch {
		return false
	}
}

/** Signed net fee in MIST. Rebate may exceed computation + storage. */
export function signedNetFeeRaw(
	computationCost: string | null,
	storageCost: string | null,
	storageRebate: string | null,
): string | null {
	const c = intString(computationCost)
	const s = intString(storageCost)
	const r = intString(storageRebate)
	if (c == null || s == null || r == null) return null
	return (BigInt(c) + BigInt(s) - BigInt(r)).toString()
}

export function interpretActivity(tx: RawActivityTx, wallet: string): ActivityTransaction {
	const walletAddr = addr(wallet)
	const sender = addr(tx.sender)
	const sponsor = addr(tx.gasSponsor) ?? sender
	const netFeeRaw = signedNetFeeRaw(tx.computationCost, tx.storageCost, tx.storageRebate)
	const feePaidByWallet = !!(walletAddr && sponsor && sponsor === walletAddr && netFeeRaw != null)
	const reasons: string[] = []
	if (tx.balanceTruncated) reasons.push('balance changes truncated')
	if (tx.eventsTruncated) reasons.push('events truncated')
	if (tx.objectsTruncated) reasons.push('object changes truncated')
	if (netFeeRaw == null) reasons.push('fee summary incomplete')

	const walletChanges: WalletChange[] = []
	if (walletAddr) {
		for (const c of tx.balanceChanges) {
			if (addr(c.owner) !== walletAddr) continue
			const amount = intString(c.amount)
			if (amount == null) {
				reasons.push('malformed balance amount')
				continue
			}
			walletChanges.push({
				coinType: normalizeCoinTypeForMatch(c.coinType),
				amountRaw: amount,
			})
		}
	}

	const classified = classifyActivities({
		tx,
		wallet: walletAddr,
		sender,
		sponsor,
		feePaidByWallet,
		netFeeRaw,
		walletChanges,
		reasons,
	})
	const activities = classified.activities
	reasons.splice(0, reasons.length, ...classified.reasons)

	const completeness: ActivityCompleteness =
		reasons.length > 0 || activities.some((a) => a.completeness === 'partial') ? 'partial' : 'complete'

	return {
		network: ACTIVITY_NETWORK,
		digest: tx.digest,
		checkpoint: tx.checkpoint,
		timestampMs: tx.timestampMs,
		sender,
		gasSponsor: sponsor,
		feePayer: sponsor,
		gasBudget: intString(tx.gasBudget),
		gasPrice: intString(tx.gasPrice),
		netFeeRaw,
		feePaidByWallet,
		suiDeltaIncludesFee: feePaidByWallet,
		status: tx.status,
		statusDetail: tx.statusDetail ?? null,
		balanceTruncated: !!tx.balanceTruncated,
		eventsTruncated: !!tx.eventsTruncated,
		objectsTruncated: !!tx.objectsTruncated,
		walletChanges,
		activities,
		primaryKind: activities[0]?.kind ?? 'contract_interaction',
		completeness,
		reasons: [...new Set(reasons.filter(Boolean))],
		parserVersion: ACTIVITY_PARSER_VERSION,
	}
}

export function upsertActivity(
	existing: ActivityTransaction[],
	incoming: ActivityTransaction[],
): ActivityTransaction[] {
	const map = new Map(existing.map((t) => [`${t.network}:${t.digest}`, t]))
	for (const tx of incoming) map.set(`${tx.network}:${tx.digest}`, tx)
	return [...map.values()].sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0) || b.digest.localeCompare(a.digest))
}
