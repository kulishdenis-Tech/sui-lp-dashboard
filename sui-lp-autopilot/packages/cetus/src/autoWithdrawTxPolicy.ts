/**
 * Action-specific Auto Withdraw verifier.
 * Stricter than general Manage manual-sign policy: remove (+ optional collect) only,
 * expected owner/pool/position, no open/add/close/swap/publish.
 */
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { BLUEFIN_SPOT_MAINNET } from './bluefinConfig.js'
import { BLUEFIN_MANUAL_SIGN_PACKAGES } from './bluefinWhitelist.js'
import { CETUS_CLMM_MAINNET } from './clmmWhitelist.js'
import { CLMM_MANUAL_SIGN_PACKAGES } from './clmmTxPolicy.js'
import {
	MANUAL_SIGN_PACKAGES as DLMM_MANUAL_SIGN_PACKAGES,
	normalizeSuiAddress,
	sha256Hex,
	type MoveCallPreview,
	type PayloadReport,
} from './txPolicy.js'
import { CETUS_DLMM_MAINNET } from './whitelist.js'

/** Default gas budget cap for Auto Withdraw (0.5 SUI). */
export const AUTO_WITHDRAW_MAX_GAS_BUDGET = 500_000_000n

export type AutoWithdrawProtocol = 'clmm' | 'bluefin' | 'dlmm'

export type AutoWithdrawTxExpect = {
	owner: string
	network: 'mainnet' | 'testnet'
	protocol: AutoWithdrawProtocol
	poolId: string
	positionId: string
	/** When false, any collect_* Move call is rejected. */
	collectFee: boolean
	maxGasBudget?: bigint
}

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

/**
 * CLMM remove-only (+ fee bookkeeping that does not close).
 * `router::check_coin_threshold` is the min-out check inside official
 * sui-clmm-sdk 1.4.9 `removeLiquidityPayload` (one call per coin, then
 * transferObjects to the sender). It does not swap, collect, or close.
 */
const CLMM_REMOVE = new Set([
	'pool::remove_liquidity',
	'position::decrease_liquidity',
	'pool::update_fee_and_reward',
	'router::check_coin_threshold',
])
const CLMM_COLLECT = new Set([
	'pool::collect_fee',
	'pool::collect_reward',
	'rewarder::collect_reward',
	'pool_script_v2::collect_fee',
	'pool_script_v2::collect_reward',
	'pool_script_v3::collect_fee',
	'pool_script_v3::collect_reward',
	'pool_script::collect_fee',
	'utils::transfer_coin_to_sender',
])
const CLMM_SENDER_SETTLED = new Set([
	'utils::transfer_coin_to_sender',
	'pool_script_v2::collect_fee',
	'pool_script_v2::collect_reward',
	'pool_script_v3::collect_fee',
	'pool_script_v3::collect_reward',
	'pool_script::collect_fee',
])

const BLUEFIN_REMOVE = new Set(['pool::remove_liquidity', 'gateway::remove_liquidity'])
const BLUEFIN_COLLECT = new Set(['gateway::collect_fee', 'gateway::collect_reward'])
const BLUEFIN_SENDER_SETTLED = new Set([
	'gateway::remove_liquidity',
	'gateway::collect_fee',
	'gateway::collect_reward',
])

const DLMM_REMOVE = new Set(['pool::remove_liquidity', 'pool::remove_liquidity_by_percent'])
const DLMM_COLLECT = new Set([
	'pool::collect_position_fee',
	'pool::collect_position_reward',
	'pool::update_position_fee_and_rewards',
	'pool::fetch_bins',
	'utils::validate_active_id_slippage',
])

type PureInput = { $kind: 'Pure'; Pure: { bytes: string } }
type FundsInput = { $kind: 'FundsWithdrawal'; FundsWithdrawal: { withdrawFrom?: { $kind?: string } } }
type ObjectInput = {
	$kind: 'Object'
	Object: {
		$kind?: string
		ImmOrOwnedObject?: { objectId: string }
		SharedObject?: { objectId: string }
		Receiving?: { objectId: string }
	}
}
type TxInput = PureInput | FundsInput | ObjectInput | { $kind: string }
type ArgRef = { $kind: string; Input?: number }
type Cmd = {
	$kind: string
	MoveCall?: { package: string; module: string; function: string; arguments?: ArgRef[] }
	TransferObjects?: { address: { $kind: string; Input?: number } }
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

function inputAt(inputs: TxInput[], arg: ArgRef | undefined): TxInput | null {
	if (!arg || arg.$kind !== 'Input' || arg.Input === undefined) return null
	return inputs[arg.Input] ?? null
}

function objectIdsFromInputs(inputs: TxInput[]): string[] {
	const ids: string[] = []
	for (const input of inputs) {
		if (input.$kind !== 'Object') continue
		const obj = (input as ObjectInput).Object
		const id =
			obj.ImmOrOwnedObject?.objectId ?? obj.SharedObject?.objectId ?? obj.Receiving?.objectId ?? null
		if (id) ids.push(normalizeSuiAddress(id))
	}
	return ids
}

function packagesFor(protocol: AutoWithdrawProtocol): readonly string[] {
	if (protocol === 'clmm') return CLMM_MANUAL_SIGN_PACKAGES
	if (protocol === 'bluefin') return BLUEFIN_MANUAL_SIGN_PACKAGES
	return DLMM_MANUAL_SIGN_PACKAGES
}

function packageAllowed(protocol: AutoWithdrawProtocol, packageId: string): boolean {
	const id = normalizeSuiAddress(packageId)
	return packagesFor(protocol).some((pkg) => normalizeSuiAddress(pkg) === id)
}

function isFramework(packageId: string): boolean {
	return normalizeSuiAddress(packageId) === normalizeSuiAddress('0x2')
}

function setsFor(protocol: AutoWithdrawProtocol): {
	remove: Set<string>
	collect: Set<string>
	senderSettled: Set<string>
} {
	if (protocol === 'clmm') {
		return { remove: CLMM_REMOVE, collect: CLMM_COLLECT, senderSettled: CLMM_SENDER_SETTLED }
	}
	if (protocol === 'bluefin') {
		return { remove: BLUEFIN_REMOVE, collect: BLUEFIN_COLLECT, senderSettled: BLUEFIN_SENDER_SETTLED }
	}
	return { remove: DLMM_REMOVE, collect: DLMM_COLLECT, senderSettled: new Set() }
}

/**
 * Fail-closed Auto Withdraw payload check. Rejects Manage-style open/add/close.
 */
export async function verifyAutoWithdrawUnsignedTx(
	txBytesBase64: string,
	expect: AutoWithdrawTxExpect,
): Promise<PayloadReport> {
	if (expect.network !== 'mainnet') {
		throw new Error('Auto Withdraw only allows mainnet payloads')
	}
	const ownerId = normalizeSuiAddress(expect.owner)
	const poolId = normalizeSuiAddress(expect.poolId)
	const positionId = normalizeSuiAddress(expect.positionId)
	const maxGas = expect.maxGasBudget ?? AUTO_WITHDRAW_MAX_GAS_BUDGET
	const { remove, collect, senderSettled } = setsFor(expect.protocol)

	const bytes = fromBase64(txBytesBase64)
	const tx = Transaction.from(bytes)
	const data = tx.getData()
	if (!data.sender) throw new Error('transaction has no sender')
	const sender = normalizeSuiAddress(data.sender)
	if (sender !== ownerId) throw new Error('transaction sender is not the expected OWNER')
	const gasOwner = data.gasData.owner ? normalizeSuiAddress(data.gasData.owner) : null
	if (gasOwner !== ownerId) throw new Error('gas owner is not the expected OWNER')

	const budgetRaw = data.gasData.budget
	if (budgetRaw == null) throw new Error('transaction has no gas budget')
	const budget = BigInt(budgetRaw)
	if (budget <= 0n || budget > maxGas) {
		throw new Error(`gas budget ${budget} exceeds Auto Withdraw cap ${maxGas}`)
	}

	const inputs = data.inputs as TxInput[]
	for (const input of inputs) {
		if (input.$kind !== 'FundsWithdrawal') continue
		const from = (input as FundsInput).FundsWithdrawal.withdrawFrom?.$kind
		if (from !== 'Sender') throw new Error('funds withdrawal is not from the OWNER sender')
	}

	const objectIds = objectIdsFromInputs(inputs)
	if (!objectIds.includes(positionId)) {
		throw new Error('transaction does not reference the expected position object')
	}
	if (!objectIds.includes(poolId)) {
		throw new Error('transaction does not reference the expected pool object')
	}

	const moveCalls: MoveCallPreview[] = []
	const recipients: string[] = []
	const commands = data.commands as Cmd[]
	if (commands.length === 0) throw new Error('transaction has no commands')

	let sawRemove = false
	let sawCollect = false

	for (const cmd of commands) {
		if (cmd.$kind === 'MoveCall' && cmd.MoveCall) {
			const call = cmd.MoveCall
			if (!packageAllowed(expect.protocol, call.package) && !isFramework(call.package)) {
				throw new Error(`unexpected package ${call.package}`)
			}
			const name = `${call.module}::${call.function}`
			const fw = isFramework(call.package)
			const isRemove = remove.has(name)
			const isCollect = collect.has(name)
			const allowed =
				(fw && FRAMEWORK_FUNCTIONS.has(name)) || isRemove || (expect.collectFee && isCollect)
			if (!allowed) {
				if (!expect.collectFee && isCollect) {
					throw new Error(`collect not selected but found ${name}`)
				}
				throw new Error(`Auto Withdraw forbids Move call ${name}`)
			}
			if (isRemove) sawRemove = true
			if (isCollect && name !== 'utils::transfer_coin_to_sender') sawCollect = true

			if (name === 'coin::send_funds') {
				const recipientInput = inputAt(inputs, call.arguments?.[1])
				if (!recipientInput || recipientInput.$kind !== 'Pure') {
					throw new Error('send_funds recipient is not a pure address')
				}
				const recipient = addressFromPure((recipientInput as PureInput).Pure.bytes)
				if (recipient !== ownerId) throw new Error(`third-party recipient ${recipient}`)
				recipients.push(recipient)
			}
			if (senderSettled.has(name)) recipients.push(ownerId)
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

	if (!sawRemove) throw new Error('Auto Withdraw payload must include remove_liquidity')
	void sawCollect
	if (recipients.length === 0) throw new Error('transaction does not settle to the OWNER')
	for (const r of recipients) {
		if (normalizeSuiAddress(r) !== ownerId) throw new Error(`third-party recipient ${r}`)
	}

	return {
		payloadSha256: await sha256Hex(bytes),
		sender,
		moveCalls,
		recipients,
		policyOk: true,
	}
}

/** Packages referenced so unused-import guards stay honest for DLMM/CLMM constants. */
export const _AW_POLICY_PACKAGE_ANCHORS = {
	clmmPublishedAt: CETUS_CLMM_MAINNET.publishedAt,
	dlmmPublishedAt: CETUS_DLMM_MAINNET.publishedAt,
	bluefinCurrent: BLUEFIN_SPOT_MAINNET.CurrentPackage,
} as const
