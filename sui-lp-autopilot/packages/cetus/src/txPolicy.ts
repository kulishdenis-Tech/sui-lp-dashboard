import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { CETUS_DLMM_MAINNET } from './whitelist.js'

/** Packages a MANUAL_SIGN Cetus DLMM transaction is allowed to call. */
export const MANUAL_SIGN_PACKAGES = [
	'0x2',
	CETUS_DLMM_MAINNET.packageId,
	CETUS_DLMM_MAINNET.publishedAt,
	CETUS_DLMM_MAINNET.routerPackageId,
	CETUS_DLMM_MAINNET.routerPublishedAt,
] as const

const POOL_FUNCTIONS = new Set([
	'pool::close_position',
	'pool::collect_position_fee',
	'pool::collect_position_reward',
	'pool::destroy_close_position_cert',
	'pool::fetch_bins',
	'pool::remove_liquidity',
	'pool::remove_liquidity_by_percent',
	'pool::update_position_fee_and_rewards',
	'utils::validate_active_id_slippage',
])

const ROUTER_FUNCTIONS = new Set([
	'spot::open_position',
	'spot::add_liquidity',
	'curve::open_position',
	'curve::add_liquidity',
	'bid_ask::open_position',
	'bid_ask::add_liquidity',
	'add_liquidity::open_position',
	'add_liquidity::add_liquidity',
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

export type MoveCallPreview = {
	package: string
	module: string
	function: string
	target: string
}

export type PayloadReport = {
	payloadSha256: string
	sender: string
	moveCalls: MoveCallPreview[]
	recipients: string[]
	policyOk: true
}

export function normalizeSuiAddress(address: string): string {
	const hex = address.trim().toLowerCase().replace(/^0x/, '')
	if (!/^[0-9a-f]+$/.test(hex) || hex.length > 64) throw new Error(`not a Sui address: ${address}`)
	return `0x${hex.padStart(64, '0')}`
}

export function packageAllowed(packageId: string): boolean {
	const id = normalizeSuiAddress(packageId)
	return MANUAL_SIGN_PACKAGES.some((pkg) => normalizeSuiAddress(pkg) === id)
}

function hexOf(bytes: Uint8Array): string {
	let out = ''
	for (const b of bytes) out += b.toString(16).padStart(2, '0')
	return out
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const subtle = (globalThis as { crypto?: { subtle?: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> } } })
		.crypto?.subtle
	if (!subtle) throw new Error('WebCrypto is required to hash the payload')
	const digest = await subtle.digest('SHA-256', bytes)
	return hexOf(new Uint8Array(digest))
}

export function payloadsMatch(leftBase64: string, rightBase64: string): boolean {
	const left = fromBase64(leftBase64)
	const right = fromBase64(rightBase64)
	if (left.length !== right.length) return false
	for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
	return true
}

function addressFromPure(bytesB64: string): string {
	const raw = fromBase64(bytesB64)
	if (raw.length !== 32) throw new Error('recipient is not a 32-byte address')
	return normalizeSuiAddress(`0x${hexOf(raw)}`)
}

type PureInput = { $kind: 'Pure'; Pure: { bytes: string } }
type FundsInput = { $kind: 'FundsWithdrawal'; FundsWithdrawal: { withdrawFrom?: { $kind?: string } } }
type TxInput = PureInput | FundsInput | { $kind: string }
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

function roleOf(packageId: string): 'framework' | 'pool' | 'router' {
	const id = normalizeSuiAddress(packageId)
	if (id === normalizeSuiAddress('0x2')) return 'framework'
	if (
		id === normalizeSuiAddress(CETUS_DLMM_MAINNET.packageId) ||
		id === normalizeSuiAddress(CETUS_DLMM_MAINNET.publishedAt)
	) {
		return 'pool'
	}
	if (
		id === normalizeSuiAddress(CETUS_DLMM_MAINNET.routerPackageId) ||
		id === normalizeSuiAddress(CETUS_DLMM_MAINNET.routerPublishedAt)
	) {
		return 'router'
	}
	throw new Error(`unexpected package ${packageId}`)
}

/**
 * Inspect the exact BCS bytes that will be handed to the wallet.
 * Rejects a third-party recipient, an unknown command, and any Move call outside the Cetus LP allowlist.
 */
export async function verifyUnsignedTx(txBytesBase64: string, owner: string): Promise<PayloadReport> {
	const ownerId = normalizeSuiAddress(owner)
	const bytes = fromBase64(txBytesBase64)
	const tx = Transaction.from(bytes)
	const data = tx.getData()
	if (!data.sender) throw new Error('transaction has no sender')
	const sender = normalizeSuiAddress(data.sender)
	if (sender !== ownerId) throw new Error('transaction sender is not the OWNER address')
	const gasOwner = data.gasData.owner ? normalizeSuiAddress(data.gasData.owner) : null
	if (gasOwner !== ownerId) throw new Error('gas owner is not the OWNER address')

	const inputs = data.inputs as TxInput[]
	for (const input of inputs) {
		if (input.$kind !== 'FundsWithdrawal') continue
		const from = (input as FundsInput).FundsWithdrawal.withdrawFrom?.$kind
		if (from !== 'Sender') throw new Error('funds withdrawal is not from the OWNER sender')
	}

	const moveCalls: MoveCallPreview[] = []
	const recipients: string[] = []
	const commands = data.commands as Cmd[]
	if (commands.length === 0) throw new Error('transaction has no commands')

	for (const cmd of commands) {
		if (cmd.$kind === 'MoveCall' && cmd.MoveCall) {
			const call = cmd.MoveCall
			const role = roleOf(call.package)
			const name = `${call.module}::${call.function}`
			const allowed =
				(role === 'framework' && FRAMEWORK_FUNCTIONS.has(name)) ||
				(role === 'pool' && POOL_FUNCTIONS.has(name)) ||
				(role === 'router' && ROUTER_FUNCTIONS.has(name))
			if (!allowed) throw new Error(`unexpected Move call ${call.package}::${name}`)
			if (name === 'coin::send_funds') {
				const recipientInput = inputAt(inputs, call.arguments?.[1])
				if (!recipientInput || recipientInput.$kind !== 'Pure') {
					throw new Error('send_funds recipient is not a pure address')
				}
				const recipient = addressFromPure((recipientInput as PureInput).Pure.bytes)
				if (recipient !== ownerId) throw new Error(`third-party recipient ${recipient}`)
				recipients.push(recipient)
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

	if (recipients.length === 0) throw new Error('transaction does not transfer its result to the OWNER')

	return {
		payloadSha256: await sha256Hex(bytes),
		sender,
		moveCalls,
		recipients,
		policyOk: true,
	}
}
