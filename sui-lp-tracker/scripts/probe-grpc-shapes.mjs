import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })

const bal = await c.listBalances({ owner: WALLET, limit: 2 })
console.log('BAL', JSON.stringify(bal, null, 2).slice(0, 800))

const meta = await c.getCoinMetadata({ coinType: '0x2::sui::SUI' })
console.log('META', JSON.stringify(meta, null, 2).slice(0, 500))

const owned = await c.listOwnedObjects({
	owner: WALLET,
	limit: 1,
	include: { content: true, type: true },
})
console.log('OWNED keys', Object.keys(owned))
console.log('obj0', JSON.stringify(owned.objects?.[0], null, 2).slice(0, 1200))

const oid = owned.objects?.[0]?.objectId
if (oid) {
	const one = await c.getObject({ objectId: oid, include: { content: true, type: true } })
	console.log('GETOBJ', JSON.stringify(one, null, 2).slice(0, 1200))
	const many = await c.getObjects({
		objectIds: [oid],
		include: { content: true, type: true },
	})
	console.log('GETOBJS', JSON.stringify(many, null, 2).slice(0, 800))
}

try {
	const ev = await c.listEvents({
		filter: { sender: WALLET },
		limit: 1,
		order: 'descending',
	})
	console.log('EVENTS', JSON.stringify(ev, null, 2).slice(0, 1000))
} catch (e) {
	console.error('listEvents err', e.message)
}

try {
	const tx = await c.listTransactions({
		filter: { sender: WALLET },
		limit: 1,
		order: 'descending',
		include: { effects: true, events: true },
	})
	console.log('TXS', JSON.stringify(tx, null, 2).slice(0, 1200))
} catch (e) {
	console.error('listTransactions err', e.message)
}
