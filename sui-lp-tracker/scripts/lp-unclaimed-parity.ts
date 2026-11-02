/**
 * Compare local CLMM fee-growth unclaimed vs on-chain inspect/SDK.
 *
 * Usage:
 *   npx vite-node --mode production scripts/lp-unclaimed-parity.ts -- --wallet 0x…
 *
 * Writes data/lp-unclaimed-parity.json (does not enable VITE_LOCAL_UNCLAIMED).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCetusPositions, fetchPools } from '@/services/cetusService'
import { fetchCetusAccruedFees } from '@/services/cetusAccruedInspect'
import { fetchCetusLocalAccrued } from '@/services/cetusLocalUnclaimed'
import { suiClient } from '@/services/suiClient'
import { getBluefinSpotPositions } from '@/services/bluefinService'
import { getTurbosPositions } from '@/services/turbosService'

const here = dirname(fileURLToPath(import.meta.url))

function argVal(flag: string): string | undefined {
	const i = process.argv.indexOf(flag)
	if (i < 0) return undefined
	return process.argv[i + 1]
}

function absDelta(a: string, b: string): bigint {
	try {
		const x = BigInt(a || '0')
		const y = BigInt(b || '0')
		return x > y ? x - y : y - x
	} catch {
		return 0n
	}
}

async function main() {
	const wallet =
		argVal('--wallet') ||
		process.env.WATCH_WALLETS?.split(',')[0]?.trim() ||
		''
	if (!wallet.startsWith('0x')) {
		console.error('Pass --wallet 0x… or set WATCH_WALLETS')
		process.exit(1)
	}

	const rows: Array<Record<string, unknown>> = []

	const cetus = await getCetusPositions(wallet)
	for (const p of cetus.slice(0, 50)) {
		const coinTypeA = p.cetusSwapped ? p.tokenBAddress : p.tokenAAddress
		const coinTypeB = p.cetusSwapped ? p.tokenAAddress : p.tokenBAddress
		const inspect = await fetchCetusAccruedFees(suiClient, {
			positionId: p.id,
			poolId: p.poolId,
			coinTypeA,
			coinTypeB,
			sender: wallet,
		})
		const pools = await fetchPools([p.poolId])
		const pool = pools.get(p.poolId)
		const origLower = p.cetusSwapped ? -p.tickUpper : p.tickLower
		const origUpper = p.cetusSwapped ? -p.tickLower : p.tickUpper
		const origTick = p.cetusSwapped ? -p.currentTick : p.currentTick
		const local = pool
			? await fetchCetusLocalAccrued(suiClient, {
					positionId: p.id,
					positionsHandle: pool.positionsHandle,
					ticksHandle: pool.ticksHandle,
					feeGrowthGlobalA: pool.feeGrowthGlobalA,
					feeGrowthGlobalB: pool.feeGrowthGlobalB,
					currentTick: origTick,
					lowerTick: origLower,
					upperTick: origUpper,
					liquidity: p.liquidity,
				})
			: { ok: false as const, error: 'no_pool' }

		let inspectA = inspect.ok ? inspect.feeOwedA : null
		let inspectB = inspect.ok ? inspect.feeOwedB : null
		if (p.cetusSwapped && inspectA != null && inspectB != null) {
			const t = inspectA
			inspectA = inspectB
			inspectB = t
		}

		rows.push({
			venue: 'cetus',
			id: p.id,
			pair: p.pair,
			inspectOk: inspect.ok,
			localOk: local.ok,
			inspectA,
			inspectB,
			localA: local.ok ? local.feeOwedA : null,
			localB: local.ok ? local.feeOwedB : null,
			deltaA: inspect.ok && local.ok ? absDelta(inspectA ?? '0', local.feeOwedA).toString() : null,
			deltaB: inspect.ok && local.ok ? absDelta(inspectB ?? '0', local.feeOwedB).toString() : null,
			localError: local.ok ? undefined : local.error,
		})
	}

	const turbos = await getTurbosPositions(wallet)
	for (const p of turbos.slice(0, 20)) {
		rows.push({
			venue: 'turbos',
			id: p.id,
			pair: p.pair,
			note: 'turbos already uses local fee-growth in getTurbosPositions',
			unclaimedFeeA: p.unclaimedFeeA,
			unclaimedFeeB: p.unclaimedFeeB,
		})
	}

	const bluefin = await getBluefinSpotPositions(wallet, { includeUnclaimed: false })
	for (const p of bluefin.slice(0, 20)) {
		rows.push({
			venue: 'bluefin',
			id: p.id,
			pair: p.pair,
			note: 'bluefin remains inspect/SDK; local exact not enabled (LOCAL_EXACT=false in arb)',
		})
	}

	const outPath = resolve(here, '../data/lp-unclaimed-parity.json')
	mkdirSync(dirname(outPath), { recursive: true })
	const summary = {
		wallet,
		at: new Date().toISOString(),
		cetusCompared: rows.filter((r) => r.venue === 'cetus').length,
		rows,
	}
	writeFileSync(outPath, JSON.stringify(summary, null, 2))
	console.log('Wrote', outPath)
	const cetusRows = rows.filter((r) => r.venue === 'cetus' && r.localOk && r.inspectOk) as Array<{
		deltaA: string
		deltaB: string
	}>
	if (cetusRows.length) {
		const maxA = cetusRows.reduce((m, r) => (BigInt(r.deltaA) > m ? BigInt(r.deltaA) : m), 0n)
		const maxB = cetusRows.reduce((m, r) => (BigInt(r.deltaB) > m ? BigInt(r.deltaB) : m), 0n)
		console.log(`Cetus local vs inspect max |Δ| raw A=${maxA} B=${maxB} (n=${cetusRows.length})`)
	} else {
		console.log('No Cetus local+inspect pairs — keep VITE_LOCAL_UNCLAIMED off until this is green.')
	}
}

void main().catch((e) => {
	console.error(e)
	process.exit(1)
})
