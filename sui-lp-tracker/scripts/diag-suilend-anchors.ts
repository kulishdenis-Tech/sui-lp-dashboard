/**
 * Suilend §8.1 diag for N01/N02/N04 — amounts / prices / time vs fixture anchors.
 * Does NOT change ±5% tolerance; prints price-drift vs missing-position conclusion.
 */
import fixture from '../harness/regression_fixture_v2.json'
import { getSuilendPositions } from '../src/services/suilendService'
import { getLlamaCurrentPrices } from '../src/services/llamaHistorical'
import { resolveSpots } from '../src/services/spotPrice/resolveSpots'

type FixObl = {
	obligation: string
	lending_market: string
	deposited_value_usd_lastRefresh: number
	borrowed_value_usd_lastRefresh: number
	deposits: { coin: string; ctokens?: string; amount?: number; mv: number }[]
	borrows: { coin: string; amount?: number; mv: number }[]
}

type WalletFix = {
	address: string
	snapshotAtUTC?: string
	suilend: FixObl[]
	expect?: { suilend?: { supply_usd: number; borrow_usd: number } }
}

const wallets = (fixture as { wallets: Record<string, WalletFix> }).wallets
const IDS = ['N01', 'N02', 'N04'] as const

function pctDelta(live: number, anchor: number): number | null {
	if (!(anchor > 0)) return live === 0 ? 0 : null
	return ((live - anchor) / anchor) * 100
}

function coinTail(ct: string): string {
	const bare = ct.includes('::') ? ct : ct
	return bare.split('::').pop() ?? bare
}

for (const id of IDS) {
	const w = wallets[id]!
	const anchor = w.expect?.suilend
	const snapAt = w.snapshotAtUTC ?? '?'
	console.log(`\n======== ${id} ${w.address.slice(0, 16)}… snap=${snapAt} ========`)

	const t0 = Date.now()
	const live = await getSuilendPositions(w.address)
	const ms = Date.now() - t0

	const supplyAnchor = anchor?.supply_usd ?? 0
	const borrowAnchor = anchor?.borrow_usd ?? 0
	const dSup = pctDelta(live.totalSuppliedUSD, supplyAnchor)
	const dBor = pctDelta(live.totalBorrowedUSD, borrowAnchor)

	console.log(
		JSON.stringify(
			{
				ms,
				incomplete: live.incomplete ?? false,
				error: live.error,
				live_supply_usd: live.totalSuppliedUSD,
				anchor_supply_usd: supplyAnchor,
				delta_supply_pct: dSup != null ? Number(dSup.toFixed(3)) : null,
				live_borrow_usd: live.totalBorrowedUSD,
				anchor_borrow_usd: borrowAnchor,
				delta_borrow_pct: dBor != null ? Number(dBor.toFixed(3)) : null,
				live_supplies: live.supplies.length,
				live_borrows: live.borrows.length,
				fixture_obligations: w.suilend.length,
			},
			null,
			2,
		),
	)

	const coinTypes = [
		...new Set([
			...live.supplies.map((s) => s.coinType),
			...w.suilend.flatMap((o) => o.deposits.map((d) => (d.coin.startsWith('0x') ? d.coin : `0x${d.coin}`))),
		]),
	]

	let llama = new Map<string, number>()
	let spots = new Map<string, { price: number }>()
	try {
		llama = await getLlamaCurrentPrices(coinTypes)
	} catch {
		/* */
	}
	try {
		spots = (await resolveSpots(coinTypes, coinTail)) as Map<string, { price: number }>
	} catch {
		/* */
	}

	const fixByCoin = new Map<string, { ctokens?: string; mv: number; markets: string[] }>()
	for (const o of w.suilend) {
		for (const d of o.deposits) {
			const ct = d.coin.startsWith('0x') ? d.coin : `0x${d.coin}`
			const prev = fixByCoin.get(ct.toLowerCase())
			fixByCoin.set(ct.toLowerCase(), {
				ctokens: d.ctokens,
				mv: (prev?.mv ?? 0) + d.mv,
				markets: [...(prev?.markets ?? []), o.lending_market.slice(0, 12)],
			})
		}
	}

	const rows: Record<string, unknown>[] = []
	for (const s of live.supplies) {
		const fix = fixByCoin.get(s.coinType.toLowerCase())
		const amountLive = s.suppliedAmount
		const llamaPx = [...llama.entries()].find(([k]) => k.toLowerCase() === s.coinType.toLowerCase())?.[1]
		const spotPx = [...spots.entries()].find(([k]) => k.toLowerCase() === s.coinType.toLowerCase())?.[1]
			?.price
		const impliedFixPx =
			fix && amountLive > 0 && fix.mv > 0 ? fix.mv / amountLive : null
		const amountDeltaPct =
			fix?.ctokens && Number(fix.ctokens) > 0
				? null // ctokens vs depositedAmount — different units; note only
				: null
		rows.push({
			asset: s.asset,
			coin: coinTail(s.coinType),
			live_amount: amountLive,
			live_usd: s.currentValueUSD,
			fix_mv: fix?.mv ?? null,
			fix_ctokens: fix?.ctokens ?? null,
			usd_delta_pct:
				fix && fix.mv > 0 ? Number((((s.currentValueUSD - fix.mv) / fix.mv) * 100).toFixed(3)) : null,
			llama_px: llamaPx ?? null,
			spot_px: spotPx ?? null,
			implied_fix_px_if_same_amount: impliedFixPx,
			markets_fix: fix?.markets ?? [],
			amount_note: amountDeltaPct,
		})
	}

	// Fixture deposits missing from live
	const liveCoins = new Set(live.supplies.map((s) => s.coinType.toLowerCase()))
	const missingFix = [...fixByCoin.entries()]
		.filter(([ct]) => !liveCoins.has(ct))
		.map(([ct, v]) => ({ coin: coinTail(ct), ...v }))

	const marketsLive = [
		...new Set(
			w.suilend
				.filter((o) =>
					live.supplies.some((s) =>
						o.deposits.some((d) => {
							const ct = d.coin.startsWith('0x') ? d.coin : `0x${d.coin}`
							return ct.toLowerCase() === s.coinType.toLowerCase()
						}),
					),
				)
				.map((o) => o.lending_market),
		),
	]
	const marketsFix = w.suilend.map((o) => ({
		market: o.lending_market.slice(0, 18) + '…',
		obligation: o.obligation.slice(0, 18) + '…',
		dep_usd: o.deposited_value_usd_lastRefresh,
		bor_usd: o.borrowed_value_usd_lastRefresh,
		deposits: o.deposits.map((d) => coinTail(d.coin)),
	}))

	const amountsApprox =
		rows.length > 0 &&
		rows.every((r) => {
			const usd = r.usd_delta_pct as number | null
			// if USD moved a lot but we still have the asset, lean price-drift when amount present
			return typeof r.live_amount === 'number' && (r.live_amount as number) > 0
		})
	const missingPos = missingFix.length > 0 || live.supplies.length < w.suilend.flatMap((o) => o.deposits).length

	let conclusion = 'unclear'
	if (missingPos && (dSup == null || dSup < -5)) conclusion = 'missing_position_or_reserve'
	else if (amountsApprox && dSup != null && dSup < -5) conclusion = 'price_drift'
	else if (dSup != null && Math.abs(dSup) <= 5) conclusion = 'within_tolerance'
	else if (dSup != null && dSup < -5) conclusion = 'usd_under_likely_price_or_amount'

	console.log('per_asset', JSON.stringify(rows, null, 2))
	console.log('missing_vs_fixture_deposits', JSON.stringify(missingFix, null, 2))
	console.log('fixture_markets', JSON.stringify(marketsFix, null, 2))
	console.log('conclusion', conclusion, '| now=', new Date().toISOString())
}

console.log('\n[diag-suilend] done')
process.exit(0)
