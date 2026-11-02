import { bluefinProvider } from './bluefinProvider.js'
import { cetusClmmProvider } from './clmmProvider.js'
import { cetusDlmmProvider } from './dlmmProvider.js'
import { parseProtocol, type LiquidityProvider, type ProtocolId } from './types.js'

const providers: Record<ProtocolId, LiquidityProvider> = {
	clmm: cetusClmmProvider,
	dlmm: cetusDlmmProvider,
	bluefin: bluefinProvider,
}

export function getProvider(protocol: ProtocolId | string | null | undefined): LiquidityProvider {
	const id =
		typeof protocol === 'string' &&
		(protocol === 'clmm' || protocol === 'dlmm' || protocol === 'bluefin')
			? protocol
			: parseProtocol(protocol)
	return providers[id]
}

export function listProtocols(): ProtocolId[] {
	return ['clmm', 'dlmm', 'bluefin']
}
