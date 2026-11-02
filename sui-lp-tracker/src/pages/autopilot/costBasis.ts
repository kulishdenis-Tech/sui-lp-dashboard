/** Local cost basis for PnL — set when OWNER opens via Autopilot. */

export type CostBasisEntry = {
	positionId: string
	investedUsd: number
	atMs: number
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	digest?: string
}

const KEY = 'sui-lp-autopilot.cost-basis.v1'

export function loadCostBasisMap(): Record<string, CostBasisEntry> {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return {}
		const parsed = JSON.parse(raw) as Record<string, CostBasisEntry>
		return parsed && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

function saveMap(map: Record<string, CostBasisEntry>): void {
	const entries = Object.values(map)
		.sort((a, b) => b.atMs - a.atMs)
		.slice(0, 200)
	const next: Record<string, CostBasisEntry> = {}
	for (const e of entries) next[e.positionId] = e
	localStorage.setItem(KEY, JSON.stringify(next))
}

export function setCostBasis(entry: CostBasisEntry): void {
	if (!(entry.investedUsd > 0) || !entry.positionId) return
	const map = loadCostBasisMap()
	map[entry.positionId] = entry
	saveMap(map)
}

export function setCostBasisForPositions(
	positionIds: string[],
	investedUsdEach: number,
	meta: { protocol: 'clmm' | 'dlmm' | 'bluefin'; poolId: string; digest?: string },
): void {
	if (!(investedUsdEach > 0) || positionIds.length === 0) return
	const map = loadCostBasisMap()
	const atMs = Date.now()
	for (const positionId of positionIds) {
		map[positionId] = {
			positionId,
			investedUsd: investedUsdEach,
			atMs,
			protocol: meta.protocol,
			poolId: meta.poolId,
			digest: meta.digest,
		}
	}
	saveMap(map)
}

export function getCostBasis(positionId: string): CostBasisEntry | null {
	return loadCostBasisMap()[positionId] ?? null
}
