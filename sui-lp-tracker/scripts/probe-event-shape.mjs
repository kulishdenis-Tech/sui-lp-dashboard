import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })
const ev = await c.listEvents({ filter: { sender: WALLET }, limit: 1, order: 'descending' })
const e = ev.events?.[0]
console.log('event keys', e && Object.keys(e))
console.log(JSON.stringify(e, (k, v) => (v?.type === 'Buffer' ? `<buf ${v.data?.length}>` : v), 2).slice(0, 2500))
console.log('page cursors', { hasNextPage: ev.hasNextPage, cursor: ev.cursor, endCursor: ev.endCursor, startCursor: ev.startCursor })

const tx = await c.listTransactions({
	filter: { sender: WALLET },
	limit: 1,
	order: 'descending',
	include: { effects: true, events: true, transaction: true, balanceChanges: true },
})
const t = tx.transactions?.[0]
console.log('\ntx kind', t?.$kind)
console.log('tx page', { hasNextPage: tx.hasNextPage, endCursor: tx.endCursor, cursor: tx.cursor })
const body = t?.Transaction ?? t?.FailedTransaction
console.log('body keys', body && Object.keys(body))
console.log('effects keys', body?.effects && Object.keys(body.effects))
