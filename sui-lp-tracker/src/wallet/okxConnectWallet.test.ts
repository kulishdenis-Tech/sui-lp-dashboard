import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getWallets } from '@mysten/wallet-standard'

vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://localhost' } }))

const request = vi.fn()
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

	it('signs already-built bytes exactly as given (no rebuild)', async () => {
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
		const built = toBase64(await tx.build())
		const w = getWallets().get().find((x) => x.name === 'OKX App (mobile)')!
		request.mockResolvedValue({ result: 'SIG' })
		const f = w.features['sui:signTransaction'] as {
			signTransaction: (i: unknown) => Promise<{ bytes: string; signature: string }>
		}
		const out = await f.signTransaction({
			transaction: { toJSON: async () => built },
			account: { address: '0x' + '11'.repeat(32) },
			chain: 'sui:mainnet',
		})
		expect(out).toEqual({ bytes: built, signature: 'SIG' })
		expect(request.mock.calls[0][0].params.txBytes).toBe(built)
	})
})
