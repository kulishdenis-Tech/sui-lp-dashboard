import { getBluefinSpotPositions } from '../src/services/bluefinService'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const rows = await getBluefinSpotPositions(WALLET, { includeUnclaimed: false })
for (const r of rows) {
	console.log({
		pair: r.pair,
		value: r.currentValueUSD,
		liq: r.liquidity,
		status: r.status,
		amtA: r.tokenAAmount,
		amtB: r.tokenBAmount,
		pxA: r.currentPriceA_USD,
		pxB: r.currentPriceB_USD,
		sqrt: r.currentSqrtPrice?.slice?.(0, 20) ?? r.currentSqrtPrice,
		tick: r.currentTick,
		lo: r.tickLower,
		hi: r.tickUpper,
		tA: r.tokenAAddress?.slice(0, 24),
		decA: r.tokenADecimals,
	})
}
console.log('count', rows.length, 'sum', rows.reduce((s, r) => s + (r.currentValueUSD ?? 0), 0))
