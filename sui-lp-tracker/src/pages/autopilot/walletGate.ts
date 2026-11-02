export type WalletOutcome =
	| 'ready'
	| 'signed'
	| 'rejected'
	| 'cancelled'
	| 'timeout'
	| 'disconnected'
	| 'account_changed'
	| 'wrong_network'
	| 'payload_changed'
	| 'error'

export type SignBlock = {
	ok: false
	outcome: Exclude<WalletOutcome, 'ready' | 'signed'>
	message: string
}

const TEXT: Record<Exclude<WalletOutcome, 'ready' | 'signed'>, string> = {
	rejected: 'Wallet rejected the signature. Transaction not sent.',
	cancelled: 'Signature cancelled. Transaction not sent.',
	timeout: 'Wallet wait timed out. Transaction not sent.',
	disconnected: 'Wallet disconnected. Signature cleared.',
	account_changed: 'Account changed. Previous signature is invalid.',
	wrong_network: 'Mainnet required. Signing blocked.',
	payload_changed: 'Bytes changed after dry-run. Send blocked.',
	error: 'Wallet did not sign. Send blocked.',
}

export function walletMessage(outcome: Exclude<WalletOutcome, 'ready' | 'signed'>): string {
	return TEXT[outcome]
}

export function classifyWalletError(error: unknown): Exclude<WalletOutcome, 'ready' | 'signed'> {
	const name = error instanceof Error ? error.name : ''
	const message = error instanceof Error ? error.message : String(error ?? '')
	const text = `${name} ${message}`.toLowerCase()
	if (name === 'AbortError' || /timeout|timed out|aborted/.test(text)) return 'timeout'
	if (/disconnect/.test(text)) return 'disconnected'
	if (/cancel|closed the prompt|user closed/.test(text)) return 'cancelled'
	if (/reject|denied|4001/.test(text)) return 'rejected'
	return 'error'
}

/** Checks that the connected wallet is still the preview owner on mainnet. */
export function evaluateSignGate(input: {
	connectedAddress: string | null
	owner: string
	network: string | null
}): { ok: true } | SignBlock {
	if (!input.connectedAddress) return { ok: false, outcome: 'disconnected', message: walletMessage('disconnected') }
	if (input.network !== 'mainnet') return { ok: false, outcome: 'wrong_network', message: walletMessage('wrong_network') }
	if (input.connectedAddress.toLowerCase() !== input.owner.toLowerCase()) {
		return { ok: false, outcome: 'account_changed', message: walletMessage('account_changed') }
	}
	return { ok: true }
}
