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
console.log('fieldId', dynamicField.fieldId)
console.log('kind', dynamicField.$kind)
console.log('value type', dynamicField.value?.type)

const { object } = await c.getObject({
	objectId: dynamicField.fieldId,
	include: { json: true, type: true },
})
console.log('field obj type', object.type?.slice(0, 120))
console.log('field json', JSON.stringify(object.json, null, 2).slice(0, 2500))
