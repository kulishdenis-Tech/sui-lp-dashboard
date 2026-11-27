/**
 * N08: deposit/withdraw evidence (amount vs fixture ctokens).
 * N14: −28% supply breakdown per asset (amount Δ vs price Δ).
 */
import fixture from '../harness/regression_fixture_v2.json'
import { getSuilendPositions } from '../src/services/suilendService'
import { getLlamaCurrentPrices } from '../src/services/llamaHistorical'

type FixObl = {
	obligation: string
	lending_market: string
	deposited_value_usd_lastRefresh: number
	borrowed_value_usd_lastRefresh: number
	deposits: { coin: string; ctokens?: string; amount?: number; mv: number }[]
	borrows: { coin: string; amount?: number; mv: number }[]
}

const wallets = (fixture as { wallets: Record<string, { address: string; suilend: FixObl[]; expect?: { suilend?: { supply_usd: number } }; snapshotAtUTC?: string }> }).wallets

function coinTail(ct: string): string {
	const c = ct.startsWith('0x') ? ct : `0x${ct}`
	return c.split('::').pop() ?? c
}

function normCoin(ct: string): string {
	return (ct.startsWith('0x') ? ct : `0x${ct}`).toLowerCase()
}

for (const id of ['N08', 'N14'] as const) {
	const w = wallets[id]!
	const live = await getSuilendPositions(w.address)
	const fixByCoin = new Map<string, { ctokens?: string; mv: number }>()
	for (const o of w.suilend) {
		for (const d of o.deposits) {
			const k = normCoin(d.coin)
			const prev = fixByCoin.get(k)
			fixByCoin.set(k, {
				ctokens: d.ctokens,
				mv: (prev?.mv ?? 0) + d.mv,
			})
		}
	}
	const types = [...new Set(live.supplies.map((s) => s.coinType))]
	const llama = await getLlamaCurrentPrices(types).catch(() => new Map<string, number>())

	console.log(`\n======== ${id} snapFix=${w.snapshotAtUTC} liveNow=${new Date().toISOString()} ========`)
	console.log(
		JSON.stringify(
			{
				live_supply: live.totalSuppliedUSD,
				anchor_supply: w.expect?.suilend?.supply_usd,
				delta_pct:
					w.expect?.suilend?.supply_usd && w.expect.suilend.supply_usd > 0
						? ((live.totalSuppliedUSD - w.expect.suilend.supply_usd) /
								w.expect.suilend.supply_usd) *
							100
						: null,
				live_borrow: live.totalBorrowedUSD,
			},
			null,
			2,
		),
	)

	const rows = []
	for (const s of live.supplies) {
		const fix = fixByCoin.get(s.coinType.toLowerCase())
		const llamaPx = [...llama.entries()].find(([k]) => k.toLowerCase() === s.coinType.toLowerCase())?.[1]
		const impliedFixPx =
			fix && s.suppliedAmount > 0 && fix.mv > 0 ? fix.mv / s.suppliedAmount : null
		const usdDeltaPct =
			fix && fix.mv > 0 ? ((s.currentValueUSD - fix.mv) / fix.mv) * 100 : null
		// Rough amount signal: if implied fix px >> live px, amounts fell (or unit mismatch).
		const priceOnlyUsd =
			impliedFixPx != null && llamaPx != null && impliedFixPx > 0
				? fix!.mv * (llamaPx / impliedFixPx)
				: null
		rows.push({
			asset: s.asset,
			coin: coinTail(s.coinType),
			live_amount: s.suppliedAmount,
			live_usd: s.currentValueUSD,
			fix_mv: fix?.mv ?? null,
			fix_ctokens: fix?.ctokens ?? null,
			usd_delta_pct: usdDeltaPct != null ? Number(usdDeltaPct.toFixed(3)) : null,
			llama_px: llamaPx ?? null,
			implied_fix_px_if_same_amount: impliedFixPx,
			price_ratio_live_vs_implied:
				impliedFixPx && llamaPx ? Number((llamaPx / impliedFixPx).toFixed(4)) : null,
			hypothetical_usd_if_only_price_moved: priceOnlyUsd,
			verdict:
				impliedFixPx && llamaPx && Math.abs(llamaPx / impliedFixPx - 1) < 0.15
					? 'amount_change_dominates'
					: impliedFixPx && llamaPx && Math.abs(usdDeltaPct ?? 0) > 10
						? 'price_and_or_amount'
						: 'unclear',
		})
	}
	const missing = [...fixByCoin.entries()]
		.filter(([k]) => !live.supplies.some((s) => s.coinType.toLowerCase() === k))
		.map(([k, v]) => ({ coin: coinTail(k), ...v }))

	console.log('per_asset', JSON.stringify(rows, null, 2))
	console.log('missing_vs_fixture', JSON.stringify(missing, null, 2))
	if (id === 'N08') {
		console.log(
			'N08_note: if live_amount<<fixture and borrow gone → withdrawn/repaid on-chain since snap; ctokens in fixture are not re-fetched as event history here.',
		)
	}
}

process.exit(0)
