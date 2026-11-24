import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getWallets } from '@mysten/wallet-standard'

vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://localhost' } }))

const request = vi.fn()
const getTransaction = vi.fn()
vi.mock('@/services/suiData/createGrpcClient', () => ({
	getDashboardGrpcClient: () => ({ getTransaction }),
}))
const openModal = vi.fn()
let connected = false
const session = {
	namespaces: { sui: { accounts: ['sui:mainnet:0xabc'], extra: {} } },
}

vi.mock('@okxconnect/ui', () => ({
	THEME: { DARK: 'DARK' },
	OKXUniversalConnectUI: {
		init: async () => ({
			request,
			openModal: async (...a: unknown[]) => {
				openModal(...a)
				connected = true
			},
			connected: () => connected,
			get session() {
				return session
			},
			disconnect: async () => {
				connected = false
			},
		}),
	},
}))

import { registerOkxConnectWallet } from './okxConnectWallet'

describe('OKX Connect wallet standard adapter', () => {
	beforeEach(() => {
		request.mockReset()
		connected = false
	})

	it('registers as a Sui wallet with sign features', () => {
		registerOkxConnectWallet()
		registerOkxConnectWallet()
		const w = getWallets().get().filter((x) => x.name === 'OKX App (mobile)')
		expect(w).toHaveLength(1)
		expect(Object.keys(w[0].features)).toEqual(
			expect.arrayContaining(['standard:connect', 'sui:signTransaction', 'sui:signPersonalMessage']),
		)
	})

	it('connect opens the OKX modal and returns the Sui account', async () => {
		const w = getWallets().get().find((x) => x.name === 'OKX App (mobile)')!
		const connect = w.features['standard:connect'] as {
			connect: (i?: { silent?: boolean }) => Promise<{ accounts: { address: string }[] }>
		}
		const silent = await connect.connect({ silent: true })
		expect(silent.accounts).toHaveLength(0)
		const res = await connect.connect()
		expect(openModal).toHaveBeenCalled()
		expect(res.accounts[0].address).toBe('0xabc')
	})

	it('signPersonalMessage forwards text and returns the wallet signature', async () => {
		const w = getWallets().get().find((x) => x.name === 'OKX App (mobile)')!
		request.mockResolvedValue({ result: 'SIG' })
		const f = w.features['sui:signPersonalMessage'] as {
			signPersonalMessage: (i: unknown) => Promise<{ signature: string }>
		}
		const out = await f.signPersonalMessage({ message: new TextEncoder().encode('hi'), account: {} })
		expect(out.signature).toBe('SIG')
		expect(request.mock.calls[0][0].method).toBe('sui_signPersonalMessage')
	})

	it('surfaces a wallet rejection as an error', async () => {
		const w = getWallets().get().find((x) => x.name === 'OKX App (mobile)')!
		request.mockResolvedValue({ error: { message: 'User rejected' } })
		const f = w.features['sui:signPersonalMessage'] as {
			signPersonalMessage: (i: unknown) => Promise<unknown>
		}
		await expect(
			f.signPersonalMessage({ message: new TextEncoder().encode('x'), account: {} }),
		).rejects.toThrow('User rejected')
	})

	async function builtTx() {
		const { Transaction } = await import('@mysten/sui/transactions')
		const { toBase64 } = await import('@mysten/sui/utils')
		const tx = new Transaction()
		tx.setSender('0x' + '11'.repeat(32))
		tx.setGasPrice(1000)
		tx.setGasBudget(10_000_000)
		tx.setGasPayment([
			{ objectId: '0x' + '22'.repeat(32), version: '1', digest: '11111111111111111111111111111111' },
		])
		const [c] = tx.splitCoins(tx.gas, [1])
		tx.transferObjects([c], '0x' + '11'.repeat(32))
		return toBase64(await tx.build())
	}

	function signFeature() {
		const w = getWallets().get().find((x) => x.name === 'OKX App (mobile)')!
		return w.features['sui:signTransaction'] as {
			signTransaction: (i: unknown) => Promise<{ bytes: string; signature: string }>
		}
	}

	const input = (built: string) => ({
		transaction: { toJSON: async () => built },
		account: { address: '0x' + '11'.repeat(32) },
		chain: 'sui:mainnet',
	})

	it('signs already-built bytes as given and reads the signature from chain', async () => {
		const built = await builtTx()
		request.mockResolvedValue({ result: 'DIGEST' })
		getTransaction.mockResolvedValue({ $kind: 'Transaction', Transaction: { signatures: ['SIG'] } })
		const out = await signFeature().signTransaction(input(built))
		expect(out).toEqual({ bytes: built, signature: 'SIG' })
		expect(request.mock.calls[0][0].method).toBe('sui_signAndExecuteTransactionBlock')
		expect(request.mock.calls[0][0].params.txBytes).toBe(built)
	})

	it('still completes when the wallet reply never arrives (tab was reloaded) but the tx landed', async () => {
		const built = await builtTx()
		request.mockReturnValue(new Promise(() => {}))
		getTransaction.mockResolvedValue({ $kind: 'Transaction', Transaction: { signatures: ['SIG2'] } })
		const out = await signFeature().signTransaction(input(built))
		expect(out.signature).toBe('SIG2')
	})

	it('wallet rejection is an error and is not masked by the chain watcher', async () => {
		const built = await builtTx()
		request.mockResolvedValue({ error: { message: 'User rejected' } })
		getTransaction.mockRejectedValue(new Error('not found'))
		await expect(signFeature().signTransaction(input(built))).rejects.toThrow('User rejected')
	})
})
