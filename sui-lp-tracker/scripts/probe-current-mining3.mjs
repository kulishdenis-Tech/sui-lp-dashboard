import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'

const TABLE = '0x7f78dc06733de16ca7fff076207934cca2c7977f13ffa07f04d6cef1878b2085'
const SUI = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })
const nameBcs = bcs.struct('TypeName', { name: bcs.string() }).serialize({ name: SUI }).toBytes()
const { dynamicField } = await c.getDynamicField({
	parentId: TABLE,
	name: { type: '0x1::type_name::TypeName', bcs: nameBcs },
})
const { object } = await c.getObject({ objectId: dynamicField.fieldId, include: { json: true } })
const value = object.json?.value
console.log('value keys', Object.keys(value ?? {}))
console.log('total_shares', value?.total_shares)
console.log('pool_rewards len', value?.pool_rewards?.length)
const now = Date.now()
for (const r of value?.pool_rewards ?? []) {
	const start = Number(r.start_time_ms)
	const end = Number(r.end_time_ms)
	const active = start <= now && now < end
	console.log({
		coin: r.coin_type,
		start,
		end,
		active,
		total: r.total_rewards,
		aprDays: (end - start) / 86400000,
	})
}
