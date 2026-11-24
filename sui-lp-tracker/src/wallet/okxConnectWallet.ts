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
import { installOkxLifecycleLog, okxLog } from '@/wallet/okxDebugLog'
import { clearPending, resumePendingOkxTx, savePending, waitForDigestOnChain } from '@/wallet/okxPendingTx'
import { suiTxDigestFromBytesBase64 } from '@/pages/autopilot/suiTxDigest'

/** Fired right before OKX's own modal opens, so the dapp-kit connect dialog can close and not cover it. */
export const OKX_CONNECT_OPENING_EVENT = 'okx-connect:opening'

const WALLET_NAME = 'OKX App (mobile)'
const CHAIN = SUI_MAINNET_CHAIN
// Black tile with a white block pattern (OKX-style mark); wallet icons must be data URIs.
const ICON =
	'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMwMDAiLz48ZyBmaWxsPSIjZmZmIj48cmVjdCB4PSIxMCIgeT0iMTAiIHdpZHRoPSIxNCIgaGVpZ2h0PSIxNCIvPjxyZWN0IHg9IjQwIiB5PSIxMCIgd2lkdGg9IjE0IiBoZWlnaHQ9IjE0Ii8+PHJlY3QgeD0iMjUiIHk9IjI1IiB3aWR0aD0iMTQiIGhlaWdodD0iMTQiLz48cmVjdCB4PSIxMCIgeT0iNDAiIHdpZHRoPSIxNCIgaGVpZ2h0PSIxNCIvPjxyZWN0IHg9IjQwIiB5PSI0MCIgd2lkdGg9IjE0IiBoZWlnaHQ9IjE0Ii8+PC9nPjwvc3ZnPg=='

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
			// `deeplink` opens the OKX app directly; the default universal link bounces through a web page first.
			openAppLinkType: 'deeplink' as never,
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
	okxLog(`unwrap: no result (${r?.error?.message ?? 'empty response'})`)
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
			okxLog('connect: opening OKX')
			window.dispatchEvent(new CustomEvent(OKX_CONNECT_OPENING_EVENT))
			await ui.openModal({ namespaces: { sui: { chains: [CHAIN] } } })
			acc = accountFromSession(ui)
		}
		okxLog(`connect: ${acc ? 'connected' : 'no account'}`)
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
		okxLog('sign: start')
		const json = await transaction.toJSON()
		// A string that is not JSON is already-built base64 bytes: sign exactly those, never rebuild
		// (a rebuild could differ from the bytes the dashboard dry-ran and policy-checked).
		const prebuilt = !json.trimStart().startsWith('{')
		let txBytes: string
		let txSerialize: string
		if (prebuilt) {
			txBytes = json
			txSerialize = await Transaction.from(fromBase64(json)).toJSON()
		} else {
			const tx = Transaction.from(json)
			tx.setSenderIfNotSet(account.address)
			const bytes = await tx.build({ client: getDashboardGrpcClient() })
			txBytes = toBase64(bytes)
			txSerialize = await Transaction.from(bytes).toJSON()
		}
		const digest = suiTxDigestFromBytesBase64(txBytes)
		savePending({ digest, owner: account.address, ts: Date.now() })
		okxLog(`sign: request sent (${prebuilt ? 'prebuilt' : 'built'} ${txBytes.length}b, ${digest.slice(0, 8)}…)`)

		// The wallet signs AND executes. Its reply can be lost if the tab is unloaded while the user
		// is in the OKX app, so also watch the chain for the digest and take whichever finishes first.
		let stop = false
		const reply = ui
			.request(
				{
					method: 'sui_signAndExecuteTransactionBlock',
					params: { txBytes, txSerialize },
					injectParams: { txBytes, txSerialize },
				} as never,
				chain,
			)
			.then((ret) => ({ kind: 'reply' as const, ret }))
		const watch = waitForDigestOnChain(digest, { isCancelled: () => stop }).then((landed) => ({
			kind: 'chain' as const,
			landed,
		}))
		try {
			let first = await Promise.race([reply, watch])
			if (first.kind === 'reply') {
				const err = (first.ret as RpcResult)?.error
				okxLog(`sign: reply ${err ? 'error ' + (err.message ?? '') : 'ok'}`)
				if (err) throw new Error(err.message ?? 'OKX wallet rejected or failed the request')
				// Wallet says done: confirm on chain to read the signature.
				const landed = await waitForDigestOnChain(digest, { timeoutMs: 60_000 })
				first = { kind: 'chain', landed }
			}
			const landed = first.landed
			if (!landed) throw new Error('Transaction was not found on chain. Check OKX / Suiscan before retrying.')
			okxLog(`sign: landed ${landed.success ? 'ok' : 'FAILED'}`)
			if (!landed.signature) throw new Error('Transaction landed but its signature could not be read.')
			return { bytes: txBytes, signature: landed.signature }
		} finally {
			stop = true
			clearPending()
		}
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
	installOkxLifecycleLog()
	void resumePendingOkxTx()
	getWallets().register(new OkxConnectWallet())
}
