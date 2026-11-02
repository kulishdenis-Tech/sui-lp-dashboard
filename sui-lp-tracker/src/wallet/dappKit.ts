/**
 * Wallet connect/sign on the official gRPC client.
 * @see https://sdk.mystenlabs.com/sui/migrations/sui-2.0/dapp-kit
 * @see https://sdk.mystenlabs.com/dapp-kit/getting-started/react
 */
import { createDAppKit } from '@mysten/dapp-kit-react'
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient'

/** Cursor Simple Browser / Electron often breaks wallet autoConnect (Phantom ethereum clash). */
const autoConnect =
	typeof navigator === 'undefined' || !/\bElectron\b/i.test(navigator.userAgent)

export const dAppKit = createDAppKit({
	networks: ['mainnet'],
	defaultNetwork: 'mainnet',
	autoConnect,
	createClient() {
		return getDashboardGrpcClient()
	},
})

declare module '@mysten/dapp-kit-react' {
	interface Register {
		dAppKit: typeof dAppKit
	}
}
