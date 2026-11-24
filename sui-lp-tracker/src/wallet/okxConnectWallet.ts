/**
 * OKX Connect (mobile deep link) as a Sui Wallet Standard wallet.
 *
 * Mobile browsers have no injected wallet. This registers an "OKX App" wallet: connect and
 * every signature open the OKX app via deep link, the user confirms there and returns to the
 * page. Because it is a standard wallet, dapp-kit lists it in the connect modal and all
 * existing sign flows (claim, manage, build) work unchanged. We never see keys; we only
 * hand the built transaction bytes to the OKX app and receive the signature back.
 * @see https://web3.okx.com/build/docs/sdks/app-connect-sui-sdk
 */
import {
	ReadonlyWalletAccount,
	SUI_MAINNET_CHAIN,
	getWallets,
	type StandardConnectFeature,
	type StandardDisconnectFeature,
	type StandardEventsFeature,
	type SuiSignPersonalMessageFeature,
	type SuiSignTransactionFeature,
	type Wallet,
} from '@mysten/wallet-standard'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient'

const WALLET_NAME = 'OKX App (mobile)'
const CHAIN = SUI_MAINNET_CHAIN
// 1×1 transparent PNG; the wallet list only needs a data URI.
const ICON =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

type OkxUi = import('@okxconnect/ui').OKXUniversalConnectUI

let uiPromise: Promise<OkxUi> | null = null

function getUi(): Promise<OkxUi> {
	uiPromise ??= (async () => {
		const { OKXUniversalConnectUI, THEME } = await import('@okxconnect/ui')
		return OKXUniversalConnectUI.init({
			dappMetaData: {
				name: 'SUI LP Dashboard',
				icon: `${window.location.origin}/icon-192.png`,
			},
			actionsConfiguration: { modals: ['before'], returnStrategy: 'none' },
			uiPreferences: { theme: THEME.DARK },
			language: 'en_US',
		})
	})()
	return uiPromise
}

function accountFromSession(ui: OkxUi): ReadonlyWalletAccount | null {
	const raw = ui.session?.namespaces?.sui?.accounts?.[0]
	const address = raw?.split(':')[2]
	if (!address) return null
	const extra = (ui.session?.namespaces?.sui as { extra?: Record<string, { publicKey?: string }> })
		?.extra?.[CHAIN]
	let publicKey = new Uint8Array(32)
	try {
		if (extra?.publicKey) publicKey = fromBase64(extra.publicKey)
	} catch {
		/* keep zero key; only the address is used for signing flows */
	}
	return new ReadonlyWalletAccount({
		address,
		publicKey,
		chains: [CHAIN],
		features: ['sui:signTransaction', 'sui:signPersonalMessage'],
	})
}

type RpcResult = { result?: unknown; error?: { message?: string } }

function unwrap(ret: unknown): unknown {
	const r = ret as RpcResult
	if (r && 'result' in r && r.result !== undefined) return r.result
	throw new Error(r?.error?.message ?? 'OKX wallet rejected or failed the request')
}

class OkxConnectWallet implements Wallet {
	readonly version = '1.0.0' as const
	readonly name = WALLET_NAME
	readonly icon = ICON
	readonly chains = [CHAIN] as const
	#accounts: ReadonlyWalletAccount[] = []
	#listeners = new Set<(p: { accounts?: readonly ReadonlyWalletAccount[] }) => void>()

	get accounts() {
		return this.#accounts
	}

	get features(): StandardConnectFeature &
		StandardDisconnectFeature &
		StandardEventsFeature &
		SuiSignTransactionFeature &
		SuiSignPersonalMessageFeature {
		return {
			'standard:connect': { version: '1.0.0', connect: this.#connect },
			'standard:disconnect': { version: '1.0.0', disconnect: this.#disconnect },
			'standard:events': { version: '1.0.0', on: this.#on },
			'sui:signTransaction': { version: '2.0.0', signTransaction: this.#signTransaction },
			'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: this.#signPersonalMessage },
		}
	}

	#setAccount(acc: ReadonlyWalletAccount | null) {
		this.#accounts = acc ? [acc] : []
		this.#listeners.forEach((l) => l({ accounts: this.#accounts }))
	}

	#on: StandardEventsFeature['standard:events']['on'] = (event, listener) => {
		if (event !== 'change') return () => {}
		this.#listeners.add(listener as never)
		return () => this.#listeners.delete(listener as never)
	}

	#connect: StandardConnectFeature['standard:connect']['connect'] = async (input) => {
		const ui = await getUi()
		let acc = ui.connected() ? accountFromSession(ui) : null
		if (!acc && !input?.silent) {
			await ui.openModal({ namespaces: { sui: { chains: [CHAIN] } } })
			acc = accountFromSession(ui)
		}
		this.#setAccount(acc)
		return { accounts: this.#accounts }
	}

	#disconnect = async () => {
		const ui = await getUi()
		try {
			await ui.disconnect()
		} finally {
			this.#setAccount(null)
		}
	}

	#signTransaction: SuiSignTransactionFeature['sui:signTransaction']['signTransaction'] = async ({
		transaction,
		account,
		chain,
		signal,
	}) => {
		signal?.throwIfAborted()
		const ui = await getUi()
		const tx = Transaction.from(await transaction.toJSON())
		tx.setSenderIfNotSet(account.address)
		const bytes = await tx.build({ client: getDashboardGrpcClient() })
		const txBytes = toBase64(bytes)
		const txSerialize = await Transaction.from(bytes).toJSON()
		const ret = await ui.request(
			{
				method: 'sui_signTransactionBlock',
				params: { txBytes, txSerialize },
				injectParams: { txBytes, txSerialize },
			} as never,
			chain,
		)
		return { bytes: txBytes, signature: String(unwrap(ret)) }
	}

	#signPersonalMessage: SuiSignPersonalMessageFeature['sui:signPersonalMessage']['signPersonalMessage'] =
		async ({ message }) => {
			const ui = await getUi()
			const ret = await ui.request(
				{
					method: 'sui_signPersonalMessage',
					params: { message: new TextDecoder().decode(message) },
					injectParams: { message },
				} as never,
				CHAIN,
			)
			return { bytes: toBase64(message), signature: String(unwrap(ret)) }
		}
}

let registered = false

/** Register once. Desktop with an injected OKX/Sui wallet needs no deep link, so skip there. */
export function registerOkxConnectWallet(): void {
	if (registered || typeof window === 'undefined') return
	registered = true
	getWallets().register(new OkxConnectWallet())
}
