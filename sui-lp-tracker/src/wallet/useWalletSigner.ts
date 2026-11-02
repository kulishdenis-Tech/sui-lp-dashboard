import { useDAppKit } from '@mysten/dapp-kit-react'

/** Sign helpers. Broadcast stays on `SuiGrpcClient.executeTransaction`, not the wallet kit. */
export function useWalletSigner() {
	const dAppKit = useDAppKit()
	return {
		signTransaction: (args: { transaction: Parameters<typeof dAppKit.signTransaction>[0]['transaction'] }) =>
			dAppKit.signTransaction({ transaction: args.transaction }),
		signPersonalMessage: (args: { message: Uint8Array }) =>
			dAppKit.signPersonalMessage({ message: args.message }),
		disconnectWallet: () => dAppKit.disconnectWallet(),
	}
}
