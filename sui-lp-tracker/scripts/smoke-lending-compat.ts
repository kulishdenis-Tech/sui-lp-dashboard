/**
 * Smoke Current obligation read + Navi-style devInspect via gRPC compat.
 */
import { createJsonRpcCompatClient, createDashboardGrpcClient } from '../src/services/suiData'
import { Transaction } from '@mysten/sui/transactions'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const OB = '0x19603190459187e0b03d94c3b54edff3f26e93a47e1646edf59c5aef2c695755'

const client = createJsonRpcCompatClient(createDashboardGrpcClient())

const obj = await client.getObject({ id: OB, options: { showContent: true } })
const fields = (obj.data?.content as { fields?: Record<string, unknown> } | null)?.fields
console.log('obligation', {
	ok: !!obj.data,
	lending_market_id: fields?.lending_market_id,
	keys: fields ? Object.keys(fields).slice(0, 12) : [],
})

// Navi config from public API
const cfgRes = await fetch('https://open-api.naviprotocol.io/api/navi/config')
const cfg = ((await cfgRes.json()) as { data: { uiGetter: string; storage: string } }).data
console.log('navi cfg', { uiGetter: cfg.uiGetter?.slice(0, 20), storage: cfg.storage?.slice(0, 20) })

const tx = new Transaction()
tx.moveCall({
	target: `${cfg.uiGetter}::getter_unchecked::get_user_state`,
	arguments: [tx.object(cfg.storage), tx.pure.address(WALLET)],
})
try {
	const insp = await client.devInspectTransactionBlock({
		sender: WALLET,
		transactionBlock: tx,
	})
	console.log('navi inspect', {
		error: insp.error,
		results: insp.results?.length,
		ret0len: insp.results?.[0]?.returnValues?.[0]?.[0]?.length,
	})
} catch (e) {
	console.error('navi inspect THROW', e instanceof Error ? e.message : e)
}

console.log('LENDING SMOKE DONE')
