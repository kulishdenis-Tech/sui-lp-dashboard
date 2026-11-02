import { PYTH_USD_FEEDS } from '@/config/priceSources'

type PythKey = keyof typeof PYTH_USD_FEEDS

const ALIAS: Record<string, PythKey> = {
	SUI: 'SUI',
	USDC: 'USDC',
	USDT: 'USDT',
	BTC: 'BTC',
	ETH: 'ETH',
	WETH: 'ETH',
	WBTC: 'WBTC',
	BSUI: 'SUI',
	/* LST / обгортки ≈ SUI для Pyth feed */
	AFSUI: 'SUI',
	STSUI: 'SUI',
	VSUI: 'SUI',
	XSUI: 'SUI',
	X_SUI: 'SUI',
	HASUI: 'SUI',
	FSUI: 'SUI',
}

const LST_VIA_SUI: Set<string> = new Set(
	['AFSUI', 'STSUI', 'VSUI', 'XSUI', 'X_SUI', 'HASUI', 'FSUI', 'BSUI'],
)

function normSymbol(symbol: string): string {
	return symbol.toUpperCase().split(/[/]|[\s-]/)[0] ?? ''
}

/**
 * Статична мапа + аліаси, без localStorage discovery.
 */
export function getPythStaticFeedId(symbol: string): `0x${string}` | null {
	const raw = normSymbol(symbol)
	const k = (ALIAS[raw] ?? (raw in PYTH_USD_FEEDS ? (raw as PythKey) : null)) as PythKey | null
	if (!k) return null
	return PYTH_USD_FEEDS[k] ?? null
}

/** Токен котирується як S/USD (алиас на SUI), LST/обгортки. */
export function pythPriceUsesSuiProxy(symbol: string): boolean {
	const raw = normSymbol(symbol)
	if (LST_VIA_SUI.has(raw)) return true
	if (ALIAS[raw] === 'SUI' && raw !== 'SUI') return true
	return false
}
