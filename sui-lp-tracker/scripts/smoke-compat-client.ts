/**
 * Smoke the real JSON-RPC compat client (vite-node).
 */
import { createJsonRpcCompatClient, createDashboardGrpcClient } from '../src/services/suiData'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const POS = '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267::position::Position'

const client = createJsonRpcCompatClient(createDashboardGrpcClient())

const bals = await client.getAllBalances({ owner: WALLET })
console.log('getAllBalances', bals.length, bals[0]?.coinType?.slice(0, 40), bals[0]?.totalBalance)

const meta = await client.getCoinMetadata({ coinType: '0x2::sui::SUI' })
console.log('getCoinMetadata', meta?.symbol, meta?.decimals)

const owned = await client.getOwnedObjects({
	owner: WALLET,
	filter: { StructType: POS },
	options: { showContent: true, showType: true },
	limit: 2,
})
console.log(
	'getOwnedObjects',
	owned.data.length,
	(owned.data[0]?.data?.content as { fields?: { pool_id?: string } } | null | undefined)?.fields
		?.pool_id
		? 'fields ok'
		: 'no fields',
)

const events = await client.queryEvents({
	query: { Sender: WALLET },
	order: 'descending',
	limit: 2,
})
console.log(
	'queryEvents',
	events.data.length,
	events.data[0]?.type?.slice(0, 60),
	events.data[0]?.timestampMs,
	'next',
	typeof events.nextCursor,
)

const oid = owned.data[0]?.data?.objectId
if (oid) {
	const txs = await client.queryTransactionBlocks({
		filter: { ChangedObject: oid },
		order: 'descending',
		limit: 1,
		options: { showEvents: true },
	})
	console.log('ChangedObject txs', txs.data.length, txs.data[0]?.digest)
}

console.log('COMPAT SMOKE OK')
