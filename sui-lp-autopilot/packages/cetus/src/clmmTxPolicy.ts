import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { CETUS_CLMM_MAINNET } from './clmmWhitelist.js'
import {
	normalizeSuiAddress,
	sha256Hex,
	type MoveCallPreview,
	type PayloadReport,
} from './txPolicy.js'

/** Packages a MANUAL_SIGN Cetus CLMM transaction is allowed to call. */
export const CLMM_MANUAL_SIGN_PACKAGES = [
	'0x1',
	'0x2',
	CETUS_CLMM_MAINNET.packageId,
	CETUS_CLMM_MAINNET.publishedAt,
	CETUS_CLMM_MAINNET.integratePackageId,
	CETUS_CLMM_MAINNET.integratePublishedAt,
] as const

/** Direct CLMM pool module functions (published_at of clmm). */
const POOL_FUNCTIONS = new Set([
	'pool::open_position',
	'pool::add_liquidity',
	'pool::add_liquidity_fix_coin',
	'pool::repay_add_liquidity',
	'pool::remove_liquidity',
	'pool::close_position',
	'pool::collect_fee',
	'pool::collect_reward',
	'pool::update_fee_and_reward',
	'position::decrease_liquidity',
	'position::increase_liquidity',
	'rewarder::collect_reward',
])

/**
 * Integrate helpers used by sui-clmm-sdk Position payloads
 * (`open_position_with_liquidity_by_fix_coin`, `add_liquidity_by_fix_coin`).
 * Module names from sui-clmm-sdk 1.4.9 (`ClmmIntegratePoolV2Module` / `ClmmIntegrateUtilsModule`).
 *
 * Official SDK `buildAddLiquidityFixToken` emits only the integrate open/add call —
 * no PTB TransferObjects. The Position NFT (and leftover coins inside the script)
 * go to `tx_context::sender` on-chain (Cetus CLMM / integrate docs).
 */
const INTEGRATE_FUNCTIONS = new Set([
	'pool_script_v2::open_position_with_liquidity_by_fix_coin',
	'pool_script_v2::open_position_with_liquidity',
	'pool_script_v2::add_liquidity_by_fix_coin',
	'pool_script_v2::add_liquidity',
	'pool_script_v2::collect_fee',
	'pool_script_v2::collect_reward',
	'pool_script_v3::collect_fee',
	'pool_script_v3::collect_reward',
	'pool_script::close_position',
	'pool_script::open_position_with_liquidity_by_fix_coin',
	'pool_script::add_liquidity_by_fix_coin',
	'pool_script::collect_fee',
	'router::check_coin_threshold',
	/** Leftover coin return used by SDK when no explicit recipient is set. */
	'utils::transfer_coin_to_sender',
])

/**
 * Calls that settle ownership to the PTB sender (no TransferObjects / send_funds in BCS).
 * Safe only because we already require sender === OWNER and gas owner === OWNER.
 *
 * SDK `closePositionPayload` / collect helpers transfer coins to `tx_context::sender`
 * inside integrate scripts — no PTB TransferObjects (unlike removeLiquidityPayload).
 */
const SENDER_SETTLED_FUNCTIONS = new Set([
	'pool_script_v2::open_position_with_liquidity_by_fix_coin',
	'pool_script_v2::open_position_with_liquidity',
	'pool_script::open_position_with_liquidity_by_fix_coin',
	'pool_script::close_position',
	'pool_script_v2::collect_fee',
	'pool_script_v2::collect_reward',
	'pool_script_v3::collect_fee',
	'pool_script_v3::collect_reward',
	'pool_script::collect_fee',
	'utils::transfer_coin_to_sender',
])

const FRAMEWORK_FUNCTIONS = new Set([
	'balance::destroy_zero',
	'balance::redeem_funds',
	'balance::zero',
	'coin::destroy_zero',
	'coin::from_balance',
	'coin::into_balance',
	'coin::redeem_funds',
	'coin::send_funds',
	'coin::zero',
	'option::none',
	'option::some',
])

const STRUCTURAL_COMMANDS = new Set(['SplitCoins', 'MergeCoins', 'MakeMoveVec'])

/** Default gas budget cap for manual Manage (1 SUI). */
export const CLMM_MANUAL_MAX_GAS_BUDGET = 1_000_000_000n

/** Action-specific allowlists — stricter than the general Manage set. */
const KIND_ALLOW: Record<
	'open' | 'add' | 'remove' | 'collect_fee' | 'close',
	ReadonlySet<string>
> = {
	open: new Set([
		'pool::open_position',
		'pool_script_v2::open_position_with_liquidity_by_fix_coin',
		'pool_script_v2::open_position_with_liquidity',
		'pool_script::open_position_with_liquidity_by_fix_coin',
		'pool_script::open_position_with_liquidity_by_fixed_coin',
		'pool::add_liquidity',
		'pool::add_liquidity_fix_coin',
		'pool::repay_add_liquidity',
		'pool_script_v2::add_liquidity_by_fix_coin',
		'pool_script_v2::add_liquidity_by_fixed_coin',
		'pool_script_v2::add_liquidity',
		'pool_script::add_liquidity_by_fix_coin',
		'pool_script::add_liquidity_by_fixed_coin',
		'utils::transfer_coin_to_sender',
	]),
	add: new Set([
		'pool::add_liquidity',
		'pool::add_liquidity_fix_coin',
		'pool::repay_add_liquidity',
		'pool_script_v2::add_liquidity_by_fix_coin',
		'pool_script_v2::add_liquidity_by_fixed_coin',
		'pool_script_v2::add_liquidity',
		'pool_script::add_liquidity_by_fix_coin',
		'pool_script::add_liquidity_by_fixed_coin',
		'position::increase_liquidity',
		'utils::transfer_coin_to_sender',
	]),
	remove: new Set([
		'pool::remove_liquidity',
		'position::decrease_liquidity',
		'pool::update_fee_and_reward',
		'router::check_coin_threshold',
		'utils::transfer_coin_to_sender',
	]),
	collect_fee: new Set([
		'pool::collect_fee',
		'pool::collect_reward',
		'pool::update_fee_and_reward',
		'rewarder::collect_reward',
		'pool_script_v2::collect_fee',
		'pool_script_v2::collect_reward',
		'pool_script_v3::collect_fee',
		'pool_script_v3::collect_reward',
		'pool_script::collect_fee',
		'utils::transfer_coin_to_sender',
	]),
	close: new Set([
		'pool::close_position',
		'pool_script::close_position',
		'pool::remove_liquidity',
		'position::decrease_liquidity',
		'pool::collect_fee',
		'pool::collect_reward',
		'pool::update_fee_and_reward',
		'rewarder::collect_reward',
		'pool_script_v2::collect_fee',
		'pool_script_v2::collect_reward',
		'pool_script_v3::collect_fee',
		'pool_script_v3::collect_reward',
		'pool_script::collect_fee',
		'utils::transfer_coin_to_sender',
	]),
}

const KIND_FORBID_HINT: Record<string, string> = {
	remove: 'principal-only withdraw forbids collect/close/open/add/swap',
	collect_fee: 'collect forbids remove/close/add/open/swap',
	add: 'add forbids remove/close/collect/open/swap',
	close: 'close forbids open/add/swap outside close path',
	open: 'open forbids remove/close/collect outside open path',
}

export type ClmmManageKind = keyof typeof KIND_ALLOW

export type VerifyClmmOpts = {
	kind?: ClmmManageKind
	poolId?: string
	positionId?: string
	maxGasBudget?: bigint
}

export function clmmPackageAllowed(packageId: string): boolean {
	const id = normalizeSuiAddress(packageId)
	return CLMM_MANUAL_SIGN_PACKAGES.some((pkg) => normalizeSuiAddress(pkg) === id)
}

function hexOf(bytes: Uint8Array): string {
	let out = ''
	for (const b of bytes) out += b.toString(16).padStart(2, '0')
	return out
}

function addressFromPure(bytesB64: string): string {
	const raw = fromBase64(bytesB64)
	if (raw.length !== 32) throw new Error('recipient is not a 32-byte address')
	return normalizeSuiAddress(`0x${hexOf(raw)}`)
}

type PureInput = { $kind: 'Pure'; Pure: { bytes: string } }
type FundsInput = { $kind: 'FundsWithdrawal'; FundsWithdrawal: { withdrawFrom?: { $kind?: string } } }
type ObjectInput = {
	$kind: 'Object'
	Object: {
		ImmOrOwnedObject?: { objectId?: string }
		SharedObject?: { objectId?: string }
		Receiving?: { objectId?: string }
	}
}
type TxInput = PureInput | FundsInput | ObjectInput | { $kind: string }
type ArgRef = { $kind: string; Input?: number }
type Cmd = {
	$kind: string
	MoveCall?: { package: string; module: string; function: string; arguments?: ArgRef[] }
	TransferObjects?: { address: { $kind: string; Input?: number } }
}

function inputAt(inputs: TxInput[], arg: ArgRef | undefined): TxInput | null {
	if (!arg || arg.$kind !== 'Input' || arg.Input === undefined) return null
	return inputs[arg.Input] ?? null
}

function objectIdsFromInputs(inputs: TxInput[]): string[] {
	const out: string[] = []
	for (const input of inputs) {
		if (input.$kind !== 'Object') continue
		const o = (input as ObjectInput).Object
		const id =
			o.ImmOrOwnedObject?.objectId ?? o.SharedObject?.objectId ?? o.Receiving?.objectId ?? null
		if (id) out.push(normalizeSuiAddress(id))
	}
	return out
}

function roleOf(packageId: string): 'framework' | 'pool' | 'integrate' {
	const id = normalizeSuiAddress(packageId)
	// 0x2 = Sui framework; 0x1 = Move stdlib (option::*) used by some Cetus integrate paths.
	if (id === normalizeSuiAddress('0x2') || id === normalizeSuiAddress('0x1')) return 'framework'
	if (
		id === normalizeSuiAddress(CETUS_CLMM_MAINNET.packageId) ||
		id === normalizeSuiAddress(CETUS_CLMM_MAINNET.publishedAt)
	) {
		return 'pool'
	}
	if (
		id === normalizeSuiAddress(CETUS_CLMM_MAINNET.integratePackageId) ||
		id === normalizeSuiAddress(CETUS_CLMM_MAINNET.integratePublishedAt)
	) {
		return 'integrate'
	}
	throw new Error(`unexpected CLMM package ${packageId}`)
}

/**
 * Inspect CLMM unsigned BCS. Fail-closed: unknown package/function or third-party recipient.
 * Optional `kind` / pool / position / gas cap bind the payload to the intended Manage action.
 */
export async function verifyClmmUnsignedTx(
	txBytesBase64: string,
	owner: string,
	opts?: VerifyClmmOpts,
): Promise<PayloadReport> {
	const ownerId = normalizeSuiAddress(owner)
	const bytes = fromBase64(txBytesBase64)
	const tx = Transaction.from(bytes)
	const data = tx.getData()
	if (!data.sender) throw new Error('transaction has no sender')
	const sender = normalizeSuiAddress(data.sender)
	if (sender !== ownerId) throw new Error('transaction sender is not the OWNER address')
	const gasOwner = data.gasData.owner ? normalizeSuiAddress(data.gasData.owner) : null
	if (gasOwner !== ownerId) throw new Error('gas owner is not the OWNER address')

	const maxGas = opts?.maxGasBudget ?? CLMM_MANUAL_MAX_GAS_BUDGET
	const budgetRaw = data.gasData.budget
	if (budgetRaw == null) throw new Error('transaction has no gas budget')
	const budget = BigInt(budgetRaw)
	if (budget <= 0n || budget > maxGas) {
		throw new Error(`gas budget ${budget} exceeds Manage cap ${maxGas}`)
	}

	const inputs = data.inputs as TxInput[]
	for (const input of inputs) {
		if (input.$kind !== 'FundsWithdrawal') continue
		const from = (input as FundsInput).FundsWithdrawal.withdrawFrom?.$kind
		if (from !== 'Sender') throw new Error('funds withdrawal is not from the OWNER sender')
	}

	if (opts?.poolId || opts?.positionId) {
		const objectIds = objectIdsFromInputs(inputs)
		if (opts.poolId && !objectIds.includes(normalizeSuiAddress(opts.poolId))) {
			throw new Error('transaction does not reference the expected pool object')
		}
		if (opts.positionId && !objectIds.includes(normalizeSuiAddress(opts.positionId))) {
			throw new Error('transaction does not reference the expected position object')
		}
	}

	const kindAllow = opts?.kind ? KIND_ALLOW[opts.kind] : null
	const moveCalls: MoveCallPreview[] = []
	const recipients: string[] = []
	const commands = data.commands as Cmd[]
	if (commands.length === 0) throw new Error('transaction has no commands')

	for (const cmd of commands) {
		if (cmd.$kind === 'MoveCall' && cmd.MoveCall) {
			const call = cmd.MoveCall
			const role = roleOf(call.package)
			const name = `${call.module}::${call.function}`
			const allowedBase =
				(role === 'framework' && FRAMEWORK_FUNCTIONS.has(name)) ||
				(role === 'pool' && POOL_FUNCTIONS.has(name)) ||
				(role === 'integrate' && INTEGRATE_FUNCTIONS.has(name))
			if (!allowedBase) throw new Error(`unexpected CLMM Move call ${call.package}::${name}`)
			if (kindAllow && role !== 'framework' && !kindAllow.has(name)) {
				throw new Error(
					`${KIND_FORBID_HINT[opts!.kind!] ?? 'action policy'}: unexpected ${name}`,
				)
			}
			if (name === 'coin::send_funds') {
				const recipientInput = inputAt(inputs, call.arguments?.[1])
				if (!recipientInput || recipientInput.$kind !== 'Pure') {
					throw new Error('send_funds recipient is not a pure address')
				}
				const recipient = addressFromPure((recipientInput as PureInput).Pure.bytes)
				if (recipient !== ownerId) throw new Error(`third-party recipient ${recipient}`)
				recipients.push(recipient)
			}
			if (SENDER_SETTLED_FUNCTIONS.has(name)) {
				recipients.push(ownerId)
			}
			if (name === 'coin::redeem_funds' || name === 'balance::redeem_funds') {
				for (const arg of call.arguments ?? []) {
					const withdrawal = inputAt(inputs, arg)
					if (!withdrawal || withdrawal.$kind !== 'FundsWithdrawal') {
						throw new Error('redeem_funds argument is not a funds withdrawal')
					}
				}
			}
			moveCalls.push({
				package: normalizeSuiAddress(call.package),
				module: call.module,
				function: call.function,
				target: `${normalizeSuiAddress(call.package)}::${name}`,
			})
			continue
		}
		if (cmd.$kind === 'TransferObjects' && cmd.TransferObjects) {
			const address = cmd.TransferObjects.address
			if (address.$kind !== 'Input' || address.Input === undefined) {
				throw new Error('TransferObjects recipient is not a decoded address')
			}
			const input = data.inputs[address.Input] as PureInput | undefined
			if (!input || input.$kind !== 'Pure') throw new Error('TransferObjects recipient is not a pure address')
			const recipient = addressFromPure(input.Pure.bytes)
			if (recipient !== ownerId) throw new Error(`third-party recipient ${recipient}`)
			recipients.push(recipient)
			continue
		}
		if (STRUCTURAL_COMMANDS.has(cmd.$kind)) continue
		throw new Error(`unexpected command ${cmd.$kind}`)
	}

	if (opts?.kind === 'remove') {
		const sawRemove = moveCalls.some((c) =>
			KIND_ALLOW.remove.has(`${c.module}::${c.function}`),
		)
		if (!sawRemove) throw new Error('principal-only withdraw missing remove_liquidity')
	}

	if (recipients.length === 0) throw new Error('transaction does not transfer its result to the OWNER')

	return {
		payloadSha256: await sha256Hex(bytes),
		sender,
		moveCalls,
		recipients,
		policyOk: true,
	}
}
