import { createJsonRpcCompatClient, createDashboardGrpcClient } from '../src/services/suiData'
import { listOwnedMoveObjects, multiGetObjectsHydrated, asRpcObjectClient } from '../src/services/objectVersionCache'
import { normalizeSuiAddress, normalizeStructTag } from '@mysten/sui/utils'
import { TickMath, Utils } from '@mmt-finance/clmm-sdk'
import BN from 'bn.js'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const POS = '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267::position::Position'

const client = createJsonRpcCompatClient(createDashboardGrpcClient())
const rpc = asRpcObjectClient(client as never)

const owned = await listOwnedMoveObjects(rpc, { owner: WALLET, filter: { StructType: POS } })
console.log('owned', owned.length)
for (const it of owned.slice(0, 2)) {
	const d = it.data
	const f = d?.content && (d.content as { fields?: Record<string, unknown> }).fields
	console.log({
		id: d?.objectId?.slice(0, 16),
		hasContent: !!d?.content,
		dataType: (d?.content as { dataType?: string })?.dataType,
		liq: f?.liquidity,
		pool: f?.pool_id,
		coinA: f?.coin_type_a,
	})
	const poolId = typeof f?.pool_id === 'string' ? normalizeSuiAddress(f.pool_id) : ''
	if (!poolId || !f) continue
	const [poolRes] = await multiGetObjectsHydrated(rpc, [poolId])
	const pf = (poolRes.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields
	console.log('pool content?', !!pf, 'sqrt', pf?.current_sqrt_price, 'tick', pf?.current_tick_index)
	const tA = normalizeStructTag(String(f.coin_type_a))
	const meta = await client.getCoinMetadata({ coinType: tA })
	console.log('meta', tA.slice(0, 40), meta?.symbol, meta?.decimals)
	const liqStr = String(f.liquidity ?? '0')
	const curSqrtStr = String(pf?.current_sqrt_price ?? '0')
	const lowerT = Number((f.lower_tick as { bits?: number })?.bits ?? 0)
	const upperT = Number((f.upper_tick as { bits?: number })?.bits ?? 0)
	// signed i32
	const i32 = (n: number) => (n > 0x7fffffff ? n - 0x1_0000_0000 : n)
	const lower = i32(lowerT)
	const upper = i32(upperT)
	try {
		const { coinA, coinB } = Utils.getCoinAmountFromLiquidity(
			new BN(liqStr, 10),
			new BN(curSqrtStr, 10),
			TickMath.tickIndexToSqrtPriceX64(lower),
			TickMath.tickIndexToSqrtPriceX64(upper),
			false,
		)
		const dec = meta?.decimals ?? 9
		const humA = Number(coinA.toString()) / 10 ** dec
		console.log('amounts', coinA.toString(), coinB.toString(), 'humA', humA)
	} catch (e) {
		console.error('amount calc failed', e)
	}
}
