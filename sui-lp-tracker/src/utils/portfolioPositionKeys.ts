import type { OpenPosition } from '@/types'
import type { PortfolioLpSourceId } from '@/services/portfolioLpSources'

/** Stable id for parity checks (gRPC vs JSON-RPC). */
export function openPositionPortfolioKey(p: OpenPosition): string {
	return `${p.protocol}|${p.id}|${p.poolId}|${p.pair}`
}

export function sortedOpenPositionKeys(positions: OpenPosition[]): string[] {
	return positions.map(openPositionPortfolioKey).sort()
}

export function openPositionKeysMatch(a: OpenPosition[], b: OpenPosition[]): boolean {
	const ka = sortedOpenPositionKeys(a)
	const kb = sortedOpenPositionKeys(b)
	if (ka.length !== kb.length) return false
	return ka.every((k, i) => k === kb[i])
}

/** Map loaded row → registry id for STALE / errors. */
export function inferPortfolioLpSourceId(p: OpenPosition): PortfolioLpSourceId | null {
	if (p.lpTokenType === 'current-multiply') return 'current-multiply'
	switch (p.protocol) {
		case 'momentum':
			return 'momentum'
		case 'bluefin':
			return 'bluefin'
		case 'cetus':
			if (p.cetusDlmm) return 'cetus-dlmm'
			if (p.cetusVault) return 'cetus-vaults'
			return 'cetus-clmm'
		case 'turbos':
			return 'turbos'
		case 'aftermath':
			return 'aftermath'
		default:
			return null
	}
}
