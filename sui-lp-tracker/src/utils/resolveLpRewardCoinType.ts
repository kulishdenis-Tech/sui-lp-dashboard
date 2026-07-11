import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins'
import type { OpenPosition, PositionEvent } from '@/types'
import { normalizeCoinTypeForMatch, NATIVE_SUI_COIN_TYPE } from '@/utils/suiCoinType'

function symEq(a: string, b: string): boolean {
	return a.trim().toUpperCase() === b.trim().toUpperCase()
}

function symbolTailFromCoinType(coinType: string): string {
	const parts = coinType.split('::')
	return (parts[parts.length - 1] ?? coinType).trim()
}

/**
 * Повний coin type для collect_reward, коли в події лише символ (BLUE, stSUI, …).
 * Не підставляє ціну пулової пари (xBTC/wBTC) для сторонніх reward-токенів.
 */
export function resolveLpRewardCoinType(
	e: Pick<PositionEvent, 'rewardCoinType' | 'rewardToken'>,
	p: Pick<OpenPosition, 'tokenA' | 'tokenB' | 'tokenAAddress' | 'tokenBAddress' | 'bluefinUnclaimed'>,
): string | null {
	const fromEvent = e.rewardCoinType?.trim()
	if (fromEvent && fromEvent.includes('::')) {
		try {
			return normalizeCoinTypeForMatch(fromEvent)
		} catch {
			return fromEvent
		}
	}

	const sym = (e.rewardToken || '').trim()
	if (!sym) return null
	if (sym.includes('::')) {
		try {
			return normalizeCoinTypeForMatch(sym)
		} catch {
			return sym
		}
	}

	if (symEq(sym, p.tokenA)) return p.tokenAAddress || null
	if (symEq(sym, p.tokenB)) return p.tokenBAddress || null
	if (symEq(sym, 'SUI')) return NATIVE_SUI_COIN_TYPE

	for (const r of p.bluefinUnclaimed?.unclaimed_rewards ?? []) {
		if (symEq(r.token, sym) && r.coinType?.includes('::')) return r.coinType
	}
	for (const ct of p.bluefinUnclaimed?.poolRewardCoinTypes ?? []) {
		if (ct.includes('::') && symEq(symbolTailFromCoinType(ct), sym)) return ct
	}

	for (const c of HARDCODED_VERIFIED) {
		if (symEq(c.symbol, sym)) return c.type
	}

	return null
}
