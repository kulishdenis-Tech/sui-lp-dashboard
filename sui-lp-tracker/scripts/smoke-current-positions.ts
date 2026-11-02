import { getCurrentPositions } from '../src/services/currentService'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
try {
	const snap = await getCurrentPositions(WALLET)
	console.log({
		supplies: snap.supplies?.length,
		borrows: snap.borrows?.length,
		netUSD: snap.netValueUSD ?? snap.totalSuppliedUSD,
		sample: snap.supplies?.[0]
			? {
					symbol: snap.supplies[0].symbol,
					usd: snap.supplies[0].valueUSD,
				}
			: null,
	})
} catch (e) {
	console.error('Current FAIL', e instanceof Error ? e.message : e)
}
