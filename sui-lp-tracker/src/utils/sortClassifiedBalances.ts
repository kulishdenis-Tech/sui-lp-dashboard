import type { ClassifiedTokenBalance } from '@/types'

export type BalanceSortCol =
	| 'token'
	| 'price'
	| 'change5m'
	| 'change1h'
	| 'change24h'
	| 'balance'
	| 'value'

export type SortDir = 'asc' | 'desc'

function compareNum(
	a: number | null | undefined,
	b: number | null | undefined,
): number {
	const an = a != null && Number.isFinite(a) ? a : null
	const bn = b != null && Number.isFinite(b) ? b : null
	if (an == null && bn == null) return 0
	if (an == null) return 1
	if (bn == null) return -1
	return an - bn
}

function cmp(a: ClassifiedTokenBalance, b: ClassifiedTokenBalance, col: BalanceSortCol): number {
	switch (col) {
		case 'token': {
			const s = a.symbol.localeCompare(b.symbol, 'en', { sensitivity: 'base' })
			if (s !== 0) return s
			return (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' })
		}
		case 'price':
			return compareNum(a.priceUSD, b.priceUSD)
		case 'change5m':
			return compareNum(a.change5m, b.change5m)
		case 'change1h':
			return compareNum(a.change1h, b.change1h)
		case 'change24h':
			return compareNum(a.change24h, b.change24h)
		case 'balance':
			return a.humanBalance - b.humanBalance
		case 'value':
			return compareNum(a.valueUSD, b.valueUSD)
		default:
			return 0
	}
}

export function sortClassifiedBalances(
	rows: ClassifiedTokenBalance[],
	col: BalanceSortCol,
	dir: SortDir,
): ClassifiedTokenBalance[] {
	const m = dir === 'asc' ? 1 : -1
	// Rows with no value for the sorted column (unpriced tokens) always go last, in either direction.
	const missing = (r: ClassifiedTokenBalance): boolean => {
		const v =
			col === 'price' ? r.priceUSD
			: col === 'change5m' ? r.change5m
			: col === 'change1h' ? r.change1h
			: col === 'change24h' ? r.change24h
			: col === 'value' ? r.valueUSD
			: 0
		return v == null || !Number.isFinite(v)
	}
	return [...rows].sort((a, b) => {
		const ma = missing(a)
		const mb = missing(b)
		if (ma !== mb) return ma ? 1 : -1
		return m * cmp(a, b, col)
	})
}

/** Початковий напрямок після вибору колонки (для "чисел" — спочатку desc). */
export function defaultDirForCol(col: BalanceSortCol): SortDir {
	if (col === 'token') return 'asc'
	return 'desc'
}

export function nextSort(
	current: { col: BalanceSortCol; dir: SortDir },
	clicked: BalanceSortCol,
): { col: BalanceSortCol; dir: SortDir } {
	if (current.col !== clicked) {
		return { col: clicked, dir: defaultDirForCol(clicked) }
	}
	return { col: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}
