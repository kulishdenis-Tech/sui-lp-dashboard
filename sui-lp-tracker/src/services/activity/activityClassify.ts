/**
 * Address-scoped activity classification.
 * Package + module + struct must match a verified schema.
 * affectedAddress on the transaction is not attribution for every event.
 */
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { PROTOCOL_PACKAGES } from '@/utils/constants'
import {
	HAEDAL_VAULTS_V2_PACKAGE,
	HAEDAL_VAULTS_V2_PUBLISHED_AT,
	VAULT_LP_INCENTIVE_PACKAGE,
} from '@/utils/haedalVault'
import { HAEDAL_LENDING_VAULT_PACKAGE } from '@/utils/haedalLendingVault'
import { NATIVE_SUI_COIN_TYPE, normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import {
	ACTIVITY_NETWORK,
	type ActionAmount,
	type ActivityKind,
	type ActivityLeg,
	type AmountUnit,
	type RawActivityEvent,
	type RawActivityTx,
	type RawObjectChange,
	type WalletChange,
} from '@/services/activity/activityModel'

/** Official Current lending package. https://current-finance.gitbook.io/buildkit */
export const CURRENT_PROTOCOL_PACKAGE =
	'0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf'

const CETUS_CLMM_V2 = '0xdb5cd62a06c79695bfc9982eb08534706d3752fe123b48e0144f480209b3117f'

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

function packageSet(ids: string[]): Set<string> {
	const out = new Set<string>()
	for (const id of ids) {
		const n = addr(id)
		if (n) out.add(n)
	}
	return out
}

const LP_PKGS = packageSet([...Object.values(PROTOCOL_PACKAGES), CETUS_CLMM_V2])
const HAEDAL_VAULT = packageSet([HAEDAL_VAULTS_V2_PACKAGE, HAEDAL_VAULTS_V2_PUBLISHED_AT])
const HAEDAL_LENDING = packageSet([HAEDAL_LENDING_VAULT_PACKAGE])
const HAEDAL_INCENTIVE = packageSet([VAULT_LP_INCENTIVE_PACKAGE])
const SYSTEM = packageSet(['0x3'])
const CURRENT = packageSet([CURRENT_PROTOCOL_PACKAGE])

const PROTOCOL_BY_PKG: Record<string, string> = {}
function remember(ids: string[], name: string) {
	for (const id of ids) {
		const n = addr(id)
		if (n) PROTOCOL_BY_PKG[n] = name
	}
}
remember([...Object.values(PROTOCOL_PACKAGES), CETUS_CLMM_V2], 'Cetus')
remember([PROTOCOL_PACKAGES.MOMENTUM_CLMM, PROTOCOL_PACKAGES.MOMENTUM_PUBLISHED_AT], 'Momentum')
remember([PROTOCOL_PACKAGES.BLUEFIN_CLMM, PROTOCOL_PACKAGES.BLUEFIN_SPOT], 'Bluefin')
remember([PROTOCOL_PACKAGES.TURBOS, PROTOCOL_PACKAGES.TURBOS_PUBLISHED_AT], 'Turbos')
remember([PROTOCOL_PACKAGES.FLOWX_V3], 'FlowX')
remember([PROTOCOL_PACKAGES.AFTERMATH], 'Aftermath')
remember([PROTOCOL_PACKAGES.SCALLOP_MARKET], 'Scallop')
remember(
	[HAEDAL_VAULTS_V2_PACKAGE, HAEDAL_VAULTS_V2_PUBLISHED_AT, HAEDAL_LENDING_VAULT_PACKAGE, VAULT_LP_INCENTIVE_PACKAGE],
	'Haedal',
)
remember(['0x3'], 'Sui staking')
remember([CURRENT_PROTOCOL_PACKAGE], 'Current')

type TypeRef = { pkg: string | null; module: string; struct: string; typeArgs: string[] }

function splitTypeArgs(raw: string): string[] {
	const args: string[] = []
	let depth = 0
	let start = 0
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i]
		if (ch === '<') depth++
		else if (ch === '>') depth--
		else if (ch === ',' && depth === 0) {
			args.push(raw.slice(start, i).trim())
			start = i + 1
		}
	}
	const tail = raw.slice(start).trim()
	if (tail) args.push(tail)
	return args
}

function parseType(type: string): TypeRef {
	const lt = type.indexOf('<')
	const bare = lt >= 0 ? type.slice(0, lt) : type
	const args = lt >= 0 ? splitTypeArgs(type.slice(lt + 1, type.lastIndexOf('>'))) : []
	const parts = bare.split('::')
	return {
		pkg: addr(parts[0] ?? null),
		module: parts.length >= 2 ? (parts[parts.length - 2] ?? '') : '',
		struct: parts[parts.length - 1] ?? '',
		typeArgs: args.map((a) => normalizeCoinTypeForMatch(a)),
	}
}

function coinName(v: unknown): string {
	if (typeof v === 'string' && v.includes('::')) return normalizeCoinTypeForMatch(v)
	if (v && typeof v === 'object' && 'name' in v && typeof (v as { name?: unknown }).name === 'string') {
		const name = (v as { name: string }).name
		if (name.includes('::')) return normalizeCoinTypeForMatch(name.startsWith('0x') ? name : `0x${name}`)
	}
	return ''
}

function amt(
	coinType: string,
	amountRaw: string | null,
	role: string,
	unit: AmountUnit,
	flow: ActionAmount['flow'] = 'unknown',
): ActionAmount {
	return { coinType, amountRaw, role, unit, flow }
}

function legId(digest: string, kind: ActivityKind, seq: string): string {
	return `${ACTIVITY_NETWORK}:${digest}:${kind}:${seq}`
}

function objectIdsFrom(event: RawActivityEvent): string[] {
	const ids = new Set<string>()
	if (event.json && typeof event.json === 'object') {
		for (const key of ['position', 'position_id', 'vault_id', 'pool_id', 'obligation', 'obligation_admin_cap', 'nft_address', 'object_id']) {
			const v = (event.json as Record<string, unknown>)[key]
			if (typeof v === 'string' && v.startsWith('0x')) ids.add(v)
		}
	}
	return [...ids]
}

const ACTOR_KEYS = ['minter', 'borrower', 'redeemer', 'repayer', 'who', 'sender', 'owner', 'recipient'] as const

function eventActor(json: unknown): string | null {
	if (!json || typeof json !== 'object') return null
	const o = json as Record<string, unknown>
	for (const key of ACTOR_KEYS) {
		const v = o[key]
		if (typeof v === 'string' && v.startsWith('0x')) return addr(v)
	}
	return null
}

type Parsed = {
	kind: ActivityKind
	protocol: string | null
	amounts: ActionAmount[]
	partial: boolean
	reasons: string[]
	objectIds: string[]
	actor: string | null
}

function pairAmount(
	json: Record<string, unknown>,
	keyA: string,
	keyB: string,
	coins: [string, string],
	unit: AmountUnit,
): { amounts: ActionAmount[]; partial: boolean } {
	const amounts: ActionAmount[] = []
	const a = intString(json[keyA])
	const b = intString(json[keyB])
	if (a != null) amounts.push(amt(coins[0], a, keyA, unit))
	if (b != null) amounts.push(amt(coins[1], b, keyB, unit))
	const partial = amounts.length === 0 || amounts.some((x) => !x.coinType)
	return { amounts, partial }
}

function parseVerified(event: RawActivityEvent, txEvents: RawActivityEvent[]): Parsed | null {
	const t = parseType(event.type)
	if (!t.pkg) return null
	const json = event.json && typeof event.json === 'object' ? (event.json as Record<string, unknown>) : null
	const protocol = PROTOCOL_BY_PKG[t.pkg] ?? null
	const actor = eventActor(json)

	const lpModules = new Set(['pool', 'liquidity', 'collect'])
	if (t.struct === 'IncreaseLiquidityEvent' && LP_PKGS.has(t.pkg) && lpModules.has(t.module)) {
		const pairedMint = txEvents.some((other) => {
			const o = parseType(other.type)
			return o.pkg === t.pkg && o.struct === 'MintEvent'
		})
		if (pairedMint) return null
		return {
			kind: 'add_liquidity',
			protocol,
			amounts: [],
			partial: true,
			reasons: ['increase liquidity is not paired with a mint; not treated as a second deposit'],
			objectIds: json ? objectIdsFrom(event) : [],
			actor,
		}
	}

	if (LP_PKGS.has(t.pkg) && lpModules.has(t.module) && json) {
		const coins: [string, string] = [t.typeArgs[0] ?? '', t.typeArgs[1] ?? '']
		const map: Record<string, ActivityKind> = {
			AddLiquidityEvent: 'add_liquidity',
			AddLiquidityV2Event: 'add_liquidity',
			MintEvent: 'add_liquidity',
			RemoveLiquidityEvent: 'withdraw_liquidity',
			RemoveLiquidityV2Event: 'withdraw_liquidity',
			BurnEvent: 'withdraw_liquidity',
			DecreaseLiquidityEvent: 'withdraw_liquidity',
			ClosePositionEvent: 'close_position',
			CollectEventV2: 'collect_fees',
			CollectFeeEvent: 'collect_fees',
			FeeCollectedEvent: 'collect_fees',
			CollectRewardEvent: 'claim_rewards',
			CollectRewardV2Event: 'claim_rewards',
			CollectRewardEventV2: 'claim_rewards',
			CollectPoolRewardEvent: 'claim_rewards',
			SwapEvent: 'swap',
		}
		const kind = map[t.struct]
		if (!kind) return null
		if (kind === 'swap') {
			const inn = intString(json.amount_in)
			const out = intString(json.amount_out)
			const amounts: ActionAmount[] = []
			if (inn != null) amounts.push(amt(coins[0], inn, 'amount_in', 'raw_coin'))
			if (out != null) amounts.push(amt(coins[1], out, 'amount_out', 'raw_coin'))
			return {
				kind,
				protocol,
				amounts,
				partial: amounts.length === 0 || amounts.some((a) => !a.coinType),
				reasons: amounts.some((a) => !a.coinType) ? ['swap coin types incomplete'] : [],
				objectIds: objectIdsFrom(event),
				actor,
			}
		}
		if (kind === 'claim_rewards') {
			const raw = intString(json.amount ?? json.reward_amount)
			const coin = coinName(json.rewarder_type) || coinName(json.reward_type) || coinName(json.coin_type) || t.typeArgs[2] || ''
			return {
				kind,
				protocol,
				amounts: raw != null ? [amt(coin, raw, 'reward_amount', 'raw_coin')] : [],
				partial: raw == null || !coin,
				reasons: raw == null || !coin ? ['reward amount incomplete'] : [],
				objectIds: objectIdsFrom(event),
				actor,
			}
		}
		if (kind === 'close_position') {
			return { kind, protocol, amounts: [], partial: false, reasons: [], objectIds: objectIdsFrom(event), actor }
		}
		const collected = kind === 'collect_fees'
		const parsed = pairAmount(
			json,
			collected ? (json.fee_a != null ? 'fee_a' : 'amount_a') : 'amount_a',
			collected ? (json.fee_b != null ? 'fee_b' : 'amount_b') : 'amount_b',
			coins,
			'raw_coin',
		)
		if (collected) {
			const typed = parsed.amounts.filter((a) => a.coinType)
			const bothZero = parsed.amounts.length >= 2 && parsed.amounts.every((a) => a.amountRaw === '0')
			if (bothZero) {
				return {
					kind,
					protocol,
					amounts: parsed.amounts,
					partial: false,
					reasons: parsed.amounts.some((a) => !a.coinType) ? ['collect coin types were not on the event'] : [],
					objectIds: objectIdsFrom(event),
					actor,
				}
			}
			return {
				kind,
				protocol,
				amounts: typed,
				partial: typed.length === 0,
				reasons: typed.length === 0 ? ['collect amount unavailable without a confirmed coin type'] : [],
				objectIds: objectIdsFrom(event),
				actor,
			}
		}
		if (!collected && intString(json.lp_amount) != null) {
			parsed.amounts.push(amt('', intString(json.lp_amount), 'lp_amount', 'shares'))
			parsed.partial = true
		}
		return {
			kind,
			protocol,
			amounts: parsed.amounts,
			partial: parsed.partial,
			reasons: parsed.partial ? ['event coin amounts incomplete'] : [],
			objectIds: objectIdsFrom(event),
			actor,
		}
	}

	if (HAEDAL_VAULT.has(t.pkg) && t.module === 'vault' && json) {
		if (t.struct === 'DepositEvent' || t.struct === 'WithdrawClmmEvent' || t.struct === 'WithdrawDlmmEvent') {
			const kind: ActivityKind = t.struct === 'DepositEvent' ? 'vault_deposit' : 'vault_withdraw'
			const coins: [string, string] = [t.typeArgs[0] ?? coinName(json.coin_type_a), t.typeArgs[1] ?? coinName(json.coin_type_b)]
			const parsed = pairAmount(json, 'amount_a', 'amount_b', coins, 'raw_coin')
			const lp = intString(json.lp_amount)
			if (lp != null) parsed.amounts.push(amt('', lp, 'lp_amount', 'shares'))
			return {
				kind,
				protocol: 'Haedal',
				amounts: parsed.amounts,
			reasons: lp != null ? ['vault share amount is not an underlying token amount'] : parsed.partial ? ['event coin amounts incomplete'] : [],
			partial: parsed.partial,
				objectIds: objectIdsFrom(event),
				actor,
			}
		}
	}

	if (HAEDAL_LENDING.has(t.pkg) && t.module === 'vault_events' && json && (t.struct === 'Deposited' || t.struct === 'Withdrawn')) {
		const raw = intString(json.amount ?? json.amount_received)
		const coin = t.typeArgs[0] ?? coinName(json.coin_type)
		return {
			kind: t.struct === 'Deposited' ? 'supply' : 'withdraw',
			protocol: 'Haedal',
			amounts: raw != null ? [amt(coin, raw, 'amount', 'raw_coin')] : [],
			partial: raw == null || !coin,
			reasons: raw == null || !coin ? ['lending amount incomplete'] : [],
			objectIds: objectIdsFrom(event),
			actor,
		}
	}

	if (HAEDAL_INCENTIVE.has(t.pkg) && t.module === 'core' && t.struct === 'HarvestEvent' && json) {
		const raw = intString(json.amount ?? json.reward_amount)
		const coin = coinName(json.reward_type) || coinName(json.coin_type)
		return {
			kind: 'claim_rewards',
			protocol: 'Haedal',
			amounts: raw != null ? [amt(coin, raw, 'reward_amount', 'raw_coin')] : [],
			partial: raw == null || !coin,
			reasons: raw == null || !coin ? ['reward amount incomplete'] : [],
			objectIds: objectIdsFrom(event),
			actor,
		}
	}

	if (SYSTEM.has(t.pkg) && t.module === 'validator' && json) {
		if (t.struct === 'StakingRequestEvent') {
			const raw = intString(json.amount)
			return {
				kind: 'stake',
				protocol: 'Sui staking',
				amounts: raw != null ? [amt(NATIVE_SUI_COIN_TYPE, raw, 'amount', 'raw_coin')] : [],
				partial: raw == null,
				reasons: raw == null ? ['stake amount incomplete'] : [],
				objectIds: [],
				actor,
			}
		}
		if (t.struct === 'UnstakingRequestEvent') {
			const principal = intString(json.principal_amount)
			const reward = intString(json.reward_amount)
			if (principal != null && reward != null) {
				return {
					kind: 'unstake',
					protocol: 'Sui staking',
					amounts: [
						amt(NATIVE_SUI_COIN_TYPE, principal, 'principal', 'raw_coin'),
						amt(NATIVE_SUI_COIN_TYPE, reward, 'reward', 'raw_coin'),
					],
					partial: false,
					reasons: [],
					objectIds: [],
					actor,
				}
			}
			return {
				kind: 'unstake',
				protocol: 'Sui staking',
				amounts: [],
				partial: true,
				reasons: ['unstake principal and reward were not both present'],
				objectIds: [],
				actor,
			}
		}
	}

	if (CURRENT.has(t.pkg) && json) {
		const current = parseCurrent(t, json, actor)
		if (current) return current
	}
	return null
}

function parseCurrent(t: TypeRef, json: Record<string, unknown>, actor: string | null): Parsed | null {
	if (t.module === 'enter_market' && t.struct === 'ObligationCreatedEvent') {
		return {
			kind: 'contract_interaction',
			protocol: 'Current',
			amounts: [],
			partial: true,
			reasons: ['obligation created is not a multiply open'],
			objectIds: [json.obligation, json.obligation_admin_cap].filter((v): v is string => typeof v === 'string'),
			actor: addr(typeof json.sender === 'string' ? json.sender : null) ?? actor,
		}
	}
	if (t.module === 'deposit' && t.struct === 'DepositEvent') {
		const coin = coinName(json.deposit_asset)
		const deposit = intString(json.deposit_amount)
		const shares = intString(json.ctoken_amount)
		const amounts: ActionAmount[] = []
		if (deposit != null) amounts.push(amt(coin, deposit, 'deposit_amount', 'raw_coin'))
		if (shares != null) amounts.push(amt('', shares, 'ctoken_amount', 'shares'))
		return {
			kind: 'supply',
			protocol: 'Current',
			amounts,
			partial: deposit == null || !coin,
			reasons: ['ctoken amount is shares, not the underlying deposit'],
			objectIds: typeof json.obligation === 'string' ? [json.obligation] : [],
			actor: addr(typeof json.minter === 'string' ? json.minter : null) ?? actor,
		}
	}
	if (t.module === 'withdraw' && t.struct === 'WithdrawEvent') {
		const coin = coinName(json.withdraw_asset)
		const withdrawn = intString(json.withdraw_amount)
		const burned = intString(json.burn_amount)
		const amounts: ActionAmount[] = []
		if (withdrawn != null) amounts.push(amt(coin, withdrawn, 'withdraw_amount', 'raw_coin'))
		if (burned != null) amounts.push(amt('', burned, 'burn_amount', 'shares'))
		return {
			kind: 'withdraw',
			protocol: 'Current',
			amounts,
			partial: withdrawn == null || !coin,
			reasons: burned != null ? ['burned ctoken amount is shares'] : [],
			objectIds: typeof json.obligation === 'string' ? [json.obligation] : [],
			actor: addr(typeof json.redeemer === 'string' ? json.redeemer : null),
		}
	}
	if (t.module === 'borrow' && t.struct === 'BorrowEvent') {
		const coin = coinName(json.asset)
		const raw = intString(json.amount)
		return {
			kind: 'borrow',
			protocol: 'Current',
			amounts: raw != null ? [amt(coin, raw, 'amount', 'raw_coin')] : [],
			partial: raw == null || !coin,
			reasons: ['borrow is a liability, not income'],
			objectIds: typeof json.obligation === 'string' ? [json.obligation] : [],
			actor: addr(typeof json.borrower === 'string' ? json.borrower : null),
		}
	}
	if (t.module === 'repay' && t.struct === 'RepayEvent') {
		const coin = coinName(json.asset)
		const raw = intString(json.amount)
		return {
			kind: 'repay',
			protocol: 'Current',
			amounts: raw != null ? [amt(coin, raw, 'amount', 'raw_coin')] : [],
			partial: raw == null || !coin,
			reasons: [],
			objectIds: typeof json.obligation === 'string' ? [json.obligation] : [],
			actor: addr(typeof json.repayer === 'string' ? json.repayer : null),
		}
	}
	if (t.module === 'liquidity_mining' && t.struct === 'RewardClaimedEvent') {
		const coin = coinName(json.reward_coin_type)
		const raw = intString(json.reward_amount)
		return {
			kind: 'claim_rewards',
			protocol: 'Current',
			amounts: raw != null ? [amt(coin, raw, 'reward_amount', 'raw_coin')] : [],
			partial: raw == null || !coin,
			reasons: raw == null || !coin ? ['reward amount incomplete'] : [],
			objectIds: typeof json.obligation === 'string' ? [json.obligation] : [],
			actor: addr(typeof json.who === 'string' ? json.who : null),
		}
	}
	return null
}

function belongsToWallet(parsed: Parsed, wallet: string | null, sender: string | null): boolean {
	if (!wallet) return false
	if (parsed.actor && parsed.actor === wallet) return true
	if (parsed.actor && parsed.actor !== wallet) return false
	return sender === wallet
}

function pushParsed(activities: ActivityLeg[], digest: string, event: RawActivityEvent, parsed: Parsed) {
	activities.push({
		id: legId(digest, parsed.kind, event.seq),
		kind: parsed.kind,
		protocol: parsed.protocol,
		eventSeq: event.seq,
		actionAmounts: parsed.amounts,
		objectIds: parsed.objectIds,
		counterparty: parsed.actor,
		completeness: parsed.partial ? 'partial' : 'complete',
		reasons: parsed.reasons,
	})
}

function objectActivity(tx: RawActivityTx, wallet: string | null, sender: string | null): ActivityLeg {
	const proven = tx.objectChanges.filter((o) => {
		const before = addr(o.inputOwner)
		const after = addr(o.outputOwner)
		if (!before && !after) return false
		if (before === after) return false
		return before === wallet || after === wallet
	})
	const kind: ActivityKind = proven.length > 0 ? 'object_transfer' : 'object_change'
	return {
		id: legId(tx.digest, kind, '0'),
		kind,
		protocol: null,
		eventSeq: null,
		actionAmounts: [],
		objectIds: (proven.length > 0 ? proven : tx.objectChanges).map((o) => o.objectId),
		counterparty: sender && sender !== wallet ? sender : null,
		completeness: kind === 'object_change' ? 'partial' : 'complete',
		reasons: kind === 'object_change' ? ['object owner before and after were not both available'] : [],
	}
}

function balanceActivities(
	tx: RawActivityTx,
	wallet: string | null,
	sender: string | null,
	feePaidByWallet: boolean,
	netFeeRaw: string | null,
	walletChanges: WalletChange[],
	reasons: string[],
): ActivityLeg[] {
	const fee = netFeeRaw != null ? BigInt(netFeeRaw) : null
	const residuals: { coinType: string; amount: bigint }[] = []
	for (const change of walletChanges) {
		let amount = BigInt(change.amountRaw)
		if (normalizeCoinTypeForMatch(change.coinType) === NATIVE_SUI_COIN_TYPE && feePaidByWallet && fee != null) {
			amount += fee
		}
		if (amount !== 0n) residuals.push({ coinType: change.coinType, amount })
	}
	if (residuals.length === 0 && tx.objectChanges.length > 0) return [objectActivity(tx, wallet, sender)]
	if (residuals.length === 0) {
		return [
			{
				id: legId(tx.digest, 'contract_interaction', '0'),
				kind: 'contract_interaction',
				protocol: null,
				eventSeq: null,
				actionAmounts: [],
				objectIds: [],
				counterparty: null,
				completeness: reasons.length ? 'partial' : 'complete',
				reasons: reasons.includes('fee summary incomplete') ? ['fee summary incomplete'] : [],
			},
		]
	}
	return residuals.map((residual) => {
		const rowsForCoin = tx.balanceChanges.filter(
			(c) => normalizeCoinTypeForMatch(c.coinType) === residual.coinType && addr(c.owner) === wallet,
		)
		const others = [
			...new Set(
				tx.balanceChanges
					.filter((c) => normalizeCoinTypeForMatch(c.coinType) === residual.coinType)
					.map((c) => addr(c.owner))
					.filter((o): o is string => !!o && o !== wallet),
			),
		]
		const opposite =
			rowsForCoin.some((c) => BigInt(intString(c.amount) ?? '0') > 0n) &&
			rowsForCoin.some((c) => BigInt(intString(c.amount) ?? '0') < 0n)
		const self = sender === wallet && others.length === 0 && opposite
		const kind: ActivityKind = self ? 'self_transfer' : residual.amount < 0n ? 'sent' : 'received'
		const flow = residual.amount < 0n ? 'out' : 'in'
		return {
			id: legId(tx.digest, kind, `bal:${residual.coinType}`),
			kind,
			protocol: null,
			eventSeq: null,
			actionAmounts: [amt(residual.coinType, residual.amount.toString(), 'amount', 'raw_coin', self ? 'unknown' : flow)],
			objectIds: [],
			counterparty: others.length === 1 ? others[0]! : null,
			completeness: reasons.length ? 'partial' : 'complete',
			reasons: [],
		}
	})
}

export function classifyActivities(input: {
	tx: RawActivityTx
	wallet: string | null
	sender: string | null
	sponsor: string | null
	feePaidByWallet: boolean
	netFeeRaw: string | null
	walletChanges: WalletChange[]
	reasons: string[]
}): { activities: ActivityLeg[]; reasons: string[] } {
	const { tx, wallet, sender, sponsor, feePaidByWallet, netFeeRaw, walletChanges } = input
	const reasons = [...input.reasons]
	if (tx.status === 'failure') {
		return {
			reasons,
			activities: [
				{
					id: legId(tx.digest, 'failed', '0'),
					kind: 'failed',
					protocol: null,
					eventSeq: null,
					actionAmounts: [],
					objectIds: tx.objectChanges.map((o) => o.objectId),
					counterparty: sender && sender !== wallet ? sender : null,
					completeness: reasons.length ? 'partial' : 'complete',
					reasons: [...reasons],
				},
			],
		}
	}
	if (tx.status === 'unknown') {
		reasons.push('execution status unknown')
		return {
			reasons,
			activities: [
				{
					id: legId(tx.digest, 'contract_interaction', 'status'),
					kind: 'contract_interaction',
					protocol: null,
					eventSeq: null,
					actionAmounts: [],
					objectIds: [],
					counterparty: null,
					completeness: 'partial',
					reasons: ['execution status unknown', tx.statusDetail ?? ''],
				},
			],
		}
	}

	const sponsorOnly = !!(wallet && sponsor === wallet && sender !== wallet && walletChanges.length === 0)
	if (sponsorOnly) {
		reasons.push('gas sponsor only')
		return {
			reasons,
			activities: [
				{
					id: legId(tx.digest, 'contract_interaction', 'sponsor'),
					kind: 'contract_interaction',
					protocol: null,
					eventSeq: null,
					actionAmounts: [],
					objectIds: [],
					counterparty: sender,
					completeness: 'partial',
					reasons: ['gas sponsor only; protocol events are not this address'],
				},
			],
		}
	}

	const signed = sender != null && sender === wallet
	const activities: ActivityLeg[] = []
	let ignoredForeign = false
	for (const event of tx.events) {
		const parsed = parseVerified(event, tx.events)
		if (!parsed) continue
		if (!belongsToWallet(parsed, wallet, sender)) {
			ignoredForeign = true
			continue
		}
		if (parsed.partial) reasons.push(...parsed.reasons)
		pushParsed(activities, tx.digest, event, parsed)
	}
	if (ignoredForeign) reasons.push('other participants events were not attributed to this address')

	if (!signed && activities.length === 0) {
		if (tx.events.length > 0) reasons.push('protocol events belong to another address')
		return {
			reasons,
			activities: balanceActivities(tx, wallet, sender, feePaidByWallet, netFeeRaw, walletChanges, reasons),
		}
	}

	const unmatched = tx.events.filter((event) => {
		const parsed = parseVerified(event, tx.events)
		if (!parsed) {
			const type = parseType(event.type)
			if (type.struct === 'IncreaseLiquidityEvent') {
				const paired = tx.events.some((other) => parseType(other.type).struct === 'MintEvent' && parseType(other.type).pkg === type.pkg)
				if (paired) return false
			}
			return signed
		}
		return false
	})
	if (signed && unmatched.length > 0) {
		reasons.push('unrecognized events')
		activities.push({
			id: legId(tx.digest, 'contract_interaction', unmatched[0]?.seq ?? 'unmatched'),
			kind: 'contract_interaction',
			protocol: null,
			eventSeq: unmatched[0]?.seq ?? null,
			actionAmounts: [],
			objectIds: [],
			counterparty: null,
			completeness: 'partial',
			reasons: ['unrecognized events'],
		})
	}
	if (activities.length === 0) {
		return {
			reasons,
			activities: balanceActivities(tx, wallet, sender, feePaidByWallet, netFeeRaw, walletChanges, reasons),
		}
	}
	return { activities, reasons }
}

export function provenObjectTransfer(change: RawObjectChange, wallet: string | null): boolean {
	const before = addr(change.inputOwner)
	const after = addr(change.outputOwner)
	if (!wallet || !before || !after || before === after) return false
	return before === wallet || after === wallet
}
