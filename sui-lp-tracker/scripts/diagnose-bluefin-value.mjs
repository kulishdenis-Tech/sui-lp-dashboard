import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const POS = '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267::position::Position'

const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })

const page = await c.listOwnedObjects({
	owner: WALLET,
	type: POS,
	limit: 5,
	include: { json: true, type: true },
})
for (const o of page.objects ?? []) {
	const j = o.json ?? {}
	const poolId = j.pool_id
	console.log('\nPOS', o.objectId.slice(0, 16), 'liq', j.liquidity, 'pool', poolId)
	if (!poolId) continue
	const { object: pool } = await c.getObject({
		objectId: poolId,
		include: { json: true, type: true },
	})
	const pj = pool.json ?? {}
	console.log('POOL keys', Object.keys(pj).slice(0, 30))
	console.log('POOL tick/sqrt', {
		current_tick: pj.current_tick ?? pj.current_tick_index,
		sqrt: pj.sqrt_price ?? pj.current_sqrt_price,
		coin_a: typeof pj.coin_a,
		coin_b: typeof pj.coin_b,
		type: pool.type?.slice(0, 120),
	})
}
