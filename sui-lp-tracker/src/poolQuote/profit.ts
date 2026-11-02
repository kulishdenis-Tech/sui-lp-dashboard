import { rawToHuman } from '@/poolQuote/coins'
import {
	ARB_MIN_NET_PROFIT_BPS,
	ARB_MIN_NET_PROFIT_USD,
} from '@/poolQuote/config'

/**
 * Gross profit in SUI mist (raw). Gas is NOT subtracted here.
 * DEX swap fees must already be inside leg amountOut — do not subtract again.
 */
export function calcGrossProfitSui(amountInSui: bigint, finalSui: bigint): bigint {
	return finalSui - amountInSui
}

export function calcGrossProfitBps(amountInSui: bigint, grossProfitSui: bigint): number {
	if (amountInSui <= 0n) return 0
	return (Number(grossProfitSui) / Number(amountInSui)) * 10_000
}

export function grossProfitUsd(
	grossProfitSuiRaw: bigint,
	suiUsd: number,
	suiDecimals = 9,
): number | null {
	if (!Number.isFinite(suiUsd) || suiUsd <= 0) return null
	return rawToHuman(grossProfitSuiRaw, suiDecimals) * suiUsd
}

/** net = gross - gas. flashLoanFee = 0. Do not subtract DEX fees again. */
export function calcNetProfitSui(grossProfitSui: bigint, gasMist: bigint): bigint {
	return grossProfitSui - gasMist
}

export function calcNetProfitBps(amountInSui: bigint, netProfitSui: bigint): number {
	if (amountInSui <= 0n) return 0
	return (Number(netProfitSui) / Number(amountInSui)) * 10_000
}

export type NetClass = 'NET_POSITIVE' | 'NET_NEGATIVE' | 'GROSS_ONLY' | 'STALE' | 'PARTIAL_FILL' | 'QUOTE_ERROR'

export function classifyNet(params: {
	grossProfitBps: number
	netProfitBps: number
	netProfitUsd: number | null
	state: 'ok' | 'stale' | 'partial' | 'error'
	minNetUsd?: number
	minNetBps?: number
}): NetClass {
	if (params.state === 'error') return 'QUOTE_ERROR'
	if (params.state === 'partial') return 'PARTIAL_FILL'
	if (params.state === 'stale') return 'STALE'
	const minUsd = params.minNetUsd ?? ARB_MIN_NET_PROFIT_USD
	const minBps = params.minNetBps ?? ARB_MIN_NET_PROFIT_BPS
	const usdOk = params.netProfitUsd != null && params.netProfitUsd >= minUsd
	const bpsOk = params.netProfitBps >= minBps
	if (usdOk && bpsOk) return 'NET_POSITIVE'
	if (params.grossProfitBps > 0 && params.netProfitBps < minBps) return 'GROSS_ONLY'
	return 'NET_NEGATIVE'
}

/**
 * Price impact vs pre-trade mid (diagnostics). Mid from sqrtPrice path;
 * executable quote amountOut is authoritative for PnL.
 */
export function calcPriceImpactPct(params: {
	amountInHuman: number
	amountOutHuman: number
	/** Expected out/in at mid before trade. */
	midOutPerIn: number
}): number | null {
	const { amountInHuman, amountOutHuman, midOutPerIn } = params
	if (!(amountInHuman > 0) || !(midOutPerIn > 0)) return null
	const expectedOut = amountInHuman * midOutPerIn
	if (!(expectedOut > 0)) return null
	return ((expectedOut - amountOutHuman) / expectedOut) * 100
}

export function effectivePrice(amountInHuman: number, amountOutHuman: number): number {
	if (!(amountInHuman > 0)) return 0
	return amountOutHuman / amountInHuman
}
