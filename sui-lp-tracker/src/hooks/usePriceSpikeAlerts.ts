import { useEffect, useRef } from 'react'
import type { TokenBalance } from '@/types'
import { evaluatePriceSpikes } from '@/services/priceSpikeAlerts'

/**
 * Після оновлення балансів з цінами OKX — тост + browser Notification при +5% за 5м/1г.
 */
export function usePriceSpikeAlerts(tokenBalances: TokenBalance[], isLoading: boolean) {
	const lastSig = useRef<string>('')

	useEffect(() => {
		if (isLoading || tokenBalances.length === 0) return

		const sig = tokenBalances
			.map(
				(t) =>
					`${t.coinType}:${t.change5m ?? ''}:${t.change1h ?? ''}:${t.priceUSD ?? ''}`,
			)
			.join('|')
		if (sig === lastSig.current) return
		lastSig.current = sig

		evaluatePriceSpikes(tokenBalances)
	}, [tokenBalances, isLoading])
}
