import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { BLUEFIN_SPOT_MAINNET } from './bluefinConfig.js'
import { BLUEFIN_MANUAL_SIGN_PACKAGES } from './bluefinWhitelist.js'
import {
	normalizeSuiAddress,
	sha256Hex,
	type MoveCallPreview,
	type PayloadReport,
} from './txPolicy.js'

/**
 * Direct pool + gateway entrypoints used by Spot SDK / principal-only PTB.
 * @see https://github.com/fireflyprotocol/bluefin-spot-contract-interface/blob/main/sources/gateway.move
 * @see https://bluefin-exchange.readme.io/v2.0.1/reference/spot-api-sdk-removeliquidity
 */
const POOL_FUNCTIONS = new Set([
	'pool::open_position',
	'pool::provide_liquidity',
	'pool::provide_liquidity_with_fixed_amount',
	'pool::remove_liquidity',
	'gateway::provide_liquidity',
	'gateway::provide_liquidity_with_fixed_amount',
	'gateway::open_position_with_liquidity',
	'gateway::close_position',
	'gateway::remove_liquidity',
	'gateway::collect_fee',
	'gateway::collect_reward',
])

/**
 * Gateway manage calls settle to tx sender / destination arg — often no PTB TransferObjects.
 * Safe only because sender + gas owner are already required to be OWNER.
 *
 * `provide_liquidity*` deposits into an existing Position NFT (owned by sender). SDK may omit
 * TransferObjects when there are no leftover merge coins (common for one-sided / Max add).
 * @see https://github.com/fireflyprotocol/bluefin-spot-contract-interface/blob/main/sources/gateway.move
 */
const SENDER_SETTLED_FUNCTIONS = new Set([
	'gateway::close_position',
	'gateway::remove_liquidity',
	'gateway::collect_fee',
	'gateway::collect_reward',
	'gateway::provide_liquidity',
	'gateway::provide_liquidity_with_fixed_amount',
	'pool::provide_liquidity',
	'pool::provide_liquidity_with_fixed_amount',
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

/** Action-specific allowlists — stricter than the general Manage set. */
const KIND_ALLOW: Record<
	'open' | 'add' | 'remove' | 'collect_fee' | 'close',
	ReadonlySet<string>
> = {
	open: new Set([
		'pool::open_position',
		'gateway::open_position_with_liquidity',
		'gateway::provide_liquidity',
		'gateway::provide_liquidity_with_fixed_amount',
		'pool::provide_liquidity',
		'pool::provide_liquidity_with_fixed_amount',
	]),
	add: new Set([
		'gateway::provide_liquidity',
		'gateway::provide_liquidity_with_fixed_amount',
		'pool::provide_liquidity',
		'pool::provide_liquidity_with_fixed_amount',
	]),
	/** Principal-only: no collect / close / open / add / swap. */
	remove: new Set(['gateway::remove_liquidity', 'pool::remove_liquidity']),
	collect_fee: new Set(['gateway::collect_fee', 'gateway::collect_reward']),
	/**
	 * SDK close collects pending rewards then gateway::close_position
	 * (fees + remaining liquidity + burn). Collect fee alone is not required.
	 */
	close: new Set([
		'gateway::close_position',
		'gateway::collect_reward',
		'gateway::collect_fee',
		'gateway::remove_liquidity',
		'pool::remove_liquidity',
	]),
}

const KIND_FORBID_HINT: Record<string, string> = {
	remove: 'principal-only withdraw forbids collect/close/open/add/swap',
	collect_fee: 'collect forbids remove/close/add/open/swap',
	add: 'add forbids remove/close/collect/open/swap',
	close: 'close forbids open/add/swap outside close path',
	open: 'open forbids remove/close/collect outside open path',
}

export type BluefinManageKind = keyof typeof KIND_ALLOW

/** Default gas budget cap for manual Manage (1 SUI). */
export const BLUEFIN_MANUAL_MAX_GAS_BUDGET = 1_000_000_000n

export type VerifyBluefinOpts = {
	/** When set, only that action's Move functions are allowed (plus framework). */
	kind?: BluefinManageKind
	poolId?: string
	positionId?: string
	maxGasBudget?: bigint
}

export function bluefinPackageAllowed(packageId: string): boolean {
	const id = normalizeSuiAddress(packageId)
	return BLUEFIN_MANUAL_SIGN_PACKAGES.some((pkg) => normalizeSuiAddress(pkg) === id)
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

function roleOf(packageId: string): 'framework' | 'bluefin' {
	const id = normalizeSuiAddress(packageId)
	// 0x2 = Sui framework; 0x1 = Move stdlib (option::*) sometimes emitted in PTBs.
	if (id === normalizeSuiAddress('0x2') || id === normalizeSuiAddress('0x1')) return 'framework'
	if (
		id === normalizeSuiAddress(BLUEFIN_SPOT_MAINNET.CurrentPackage) ||
		id === normalizeSuiAddress(BLUEFIN_SPOT_MAINNET.BasePackage)
	) {
		return 'bluefin'
	}
	throw new Error(`unexpected Bluefin package ${packageId}`)
}

/**
 * Inspect Bluefin unsigned BCS. Fail-closed: unknown package/function or third-party recipient.
 * Open PTBs use TransferObjects for Position NFT + leftover coins → OWNER.
 * Optional `kind` applies action-specific allowlists (principal-only remove, etc.).
 */
export async function verifyBluefinUnsignedTx(
	txBytesBase64: string,
	owner: string,
	opts?: VerifyBluefinOpts,
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

	const maxGas = opts?.maxGasBudget ?? BLUEFIN_MANUAL_MAX_GAS_BUDGET
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
				(role === 'bluefin' && POOL_FUNCTIONS.has(name))
			if (!allowedBase) throw new Error(`unexpected Bluefin Move call ${call.package}::${name}`)
			if (kindAllow && role === 'bluefin' && !kindAllow.has(name)) {
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
		const forbidden = moveCalls.filter((c) =>
			['collect_fee', 'collect_reward', 'close_position', 'open_position', 'provide_liquidity'].some(
				(f) => c.function.includes(f) || c.function === f,
			),
		)
		if (forbidden.length) {
			throw new Error(
				`principal-only withdraw forbids ${forbidden.map((c) => `${c.module}::${c.function}`).join(', ')}`,
			)
		}
	}

	const senderSettled = moveCalls.some((c) => SENDER_SETTLED_FUNCTIONS.has(`${c.module}::${c.function}`))
	if (recipients.length === 0 && !senderSettled) {
		throw new Error('transaction does not transfer its result to the OWNER')
	}

	return {
		payloadSha256: await sha256Hex(bytes),
		sender,
		moveCalls,
		recipients,
		policyOk: true,
	}
}
