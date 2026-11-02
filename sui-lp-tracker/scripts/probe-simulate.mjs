import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
// Navi getter - from typical config; may need real addresses from API
const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })

// Minimal: get reference gas via simulate of empty-ish - just test getMoveFunction path
const fn = await c.getMoveFunction({
	package: '0x2',
	module: 'coin',
	function: 'total_supply',
})
console.log('getMoveFunction', JSON.stringify(fn, (_, v) => (typeof v === 'bigint' ? String(v) : v)).slice(0, 500))
