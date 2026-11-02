import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'

const MARKET = '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df'
const SUI = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'

const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })

const { object } = await c.getObject({ objectId: MARKET, include: { json: true } })
const j = object.json ?? {}
console.log('market top keys', Object.keys(j).slice(0, 40))
console.log('liquidity_miner', JSON.stringify(j.liquidity_miner, null, 2)?.slice(0, 1500))

const miner = j.liquidity_miner
const depositTable =
	miner?.deposit?.id ??
	miner?.fields?.deposit?.fields?.id?.id ??
	miner?.deposit?.fields?.id?.id
console.log('depositTable', depositTable)

// Try TypeName BCS: struct { name: string }
const nameStr = SUI
const nameBcs = bcs.struct('TypeName', { name: bcs.string() }).serialize({ name: nameStr }).toBytes()
console.log('nameBcs len', nameBcs.length)

if (depositTable) {
	try {
		const df = await c.getDynamicObjectField({
			parentId: typeof depositTable === 'string' ? depositTable : depositTable.id ?? depositTable,
			name: { type: '0x1::type_name::TypeName', bcs: nameBcs },
			include: { json: true },
		})
		console.log('DOF keys', Object.keys(df.object?.json ?? {}))
		console.log('DOF json', JSON.stringify(df.object?.json, null, 2)?.slice(0, 2000))
	} catch (e) {
		console.error('DOF fail', e.message)
		try {
			const df2 = await c.getDynamicField({
				parentId: typeof depositTable === 'string' ? depositTable : depositTable.id ?? depositTable,
				name: { type: '0x1::type_name::TypeName', bcs: nameBcs },
			})
			console.log('DF', JSON.stringify(df2, (_, v) => (v?.type === 'Buffer' ? `<buf>` : v), 2).slice(0, 1500))
		} catch (e2) {
			console.error('DF fail', e2.message)
		}
	}
}
