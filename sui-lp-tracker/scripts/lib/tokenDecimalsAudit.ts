/**
 * Quick token decimals audit for F5.2 parity (SUI / USDC / DEEP / WAL).
 * Logs RPC getCoinMetadata vs expected hardcoded decimals — no writes.
 */
import { executeWithFailover } from '@/poolQuote/rpc'
import {
	NATIVE_SUI_COIN_TYPE,
	normalizeCoinTypeForMatch,
} from '@/utils/suiCoinType'
import { USDC_COIN_TYPE_MAINNET, SUI_DECIMALS, USDC_DECIMALS } from '@/poolQuote/coins'

export const DEEP_COIN_TYPE_MAINNET =
	'0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'

export const WAL_COIN_TYPE_MAINNET =
	'0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'

export const DEEP_DECIMALS_EXPECTED = 6
export const WAL_DECIMALS_EXPECTED = 9

export interface TokenDecimalsRow {
	symbol: string
	coinType: string
	expected: number
	rpcDecimals: number | null
	rpcSymbol: string | null
	ok: boolean
	note?: string
}

const AUDIT_TOKENS: { symbol: string; coinType: string; expected: number }[] = [
	{ symbol: 'SUI', coinType: NATIVE_SUI_COIN_TYPE, expected: SUI_DECIMALS },
	{ symbol: 'USDC', coinType: USDC_COIN_TYPE_MAINNET, expected: USDC_DECIMALS },
	{ symbol: 'DEEP', coinType: DEEP_COIN_TYPE_MAINNET, expected: DEEP_DECIMALS_EXPECTED },
	{ symbol: 'WAL', coinType: WAL_COIN_TYPE_MAINNET, expected: WAL_DECIMALS_EXPECTED },
]

export async function auditTokenDecimals(opts?: {
	extra?: { symbol: string; coinType: string; expected: number }[]
}): Promise<TokenDecimalsRow[]> {
	const list = [...AUDIT_TOKENS, ...(opts?.extra ?? [])]
	const rows: TokenDecimalsRow[] = []
	for (const t of list) {
		const coinType = normalizeCoinTypeForMatch(t.coinType)
		try {
			const { result } = await executeWithFailover(
				(c) => c.getCoinMetadata({ coinType }),
				{ label: `getCoinMetadata:${t.symbol}` },
			)
			const rpcDecimals = result?.decimals ?? null
			const rpcSymbol = result?.symbol ?? null
			const ok = rpcDecimals === t.expected
			rows.push({
				symbol: t.symbol,
				coinType,
				expected: t.expected,
				rpcDecimals,
				rpcSymbol,
				ok,
				note: ok ? undefined : 'MISMATCH',
			})
		} catch (e) {
			rows.push({
				symbol: t.symbol,
				coinType,
				expected: t.expected,
				rpcDecimals: null,
				rpcSymbol: null,
				ok: false,
				note: e instanceof Error ? e.message : String(e),
			})
		}
	}
	return rows
}

export function printTokenDecimalsAudit(rows: TokenDecimalsRow[]): void {
	console.log('--- TOKEN_DECIMALS_AUDIT ---')
	for (const r of rows) {
		console.log(
			`  ${r.symbol} expected=${r.expected} rpc=${r.rpcDecimals ?? 'n/a'} ` +
				`sym=${r.rpcSymbol ?? '?'} ok=${r.ok}${r.note ? ` note=${r.note}` : ''}`,
		)
	}
}
