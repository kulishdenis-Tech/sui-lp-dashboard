import { useEffect, useState } from 'react'
import { geckoTerminalPoolEmbedWebUrl, geckoTerminalPoolWebUrl } from '@/lib/geckoPoolOhlcvCore'
import { resolveTokenChartPool, type TokenChartPool } from '@/services/tokenChartPool'
import { GECKO_NETWORK } from '@/utils/constants'

/**
 * Spot chart for a balance token — GeckoTerminal pool embed (same as LP PositionPoolChart).
 * Prefers TOKEN/USDC (then other stables) via {@link resolveTokenChartPool}.
 */
export function TokenSpotChart({
	coinType,
	symbol,
}: {
	coinType: string
	symbol: string
}) {
	const [pool, setPool] = useState<TokenChartPool | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		setError(null)
		setPool(null)
		void resolveTokenChartPool(coinType, symbol).then((p) => {
			if (cancelled) return
			if (!p) {
				setError('No pool chart found for this token')
				setLoading(false)
				return
			}
			setPool(p)
			setLoading(false)
		})
		return () => {
			cancelled = true
		}
	}, [coinType, symbol])

	if (loading) {
		return (
			<div className="h-[320px] animate-pulse rounded-lg border border-slate-800/90 bg-slate-950/40" />
		)
	}
	if (error || !pool) {
		return <p className="py-3 text-sm text-slate-500">{error ?? 'No pool chart available'}</p>
	}

	const embedUrl = geckoTerminalPoolEmbedWebUrl(GECKO_NETWORK, pool.poolId, { dark: true })
	const poolUrl = geckoTerminalPoolWebUrl(GECKO_NETWORK, pool.poolId)

	return (
		<div className="w-full py-2">
			<p className="mb-2 text-xs font-medium text-slate-400">
				{pool.pairLabel}
				{pool.quoteSymbol && pool.quoteSymbol !== '—' ? (
					<span className="ml-1.5 font-normal text-slate-600">· quote {pool.quoteSymbol}</span>
				) : null}
			</p>
			<div className="w-full overflow-hidden rounded-lg border border-slate-800/90 bg-slate-950/50">
				<iframe
					title={`GeckoTerminal chart — ${pool.pairLabel}`}
					src={embedUrl}
					className="h-[420px] w-full border-0"
					referrerPolicy="strict-origin-when-cross-origin"
					allow="fullscreen"
				/>
			</div>
			<p className="mt-1.5 text-[11px] text-slate-600">
				Chart by{' '}
				<a
					href={poolUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="text-slate-500 hover:text-sky-400"
				>
					GeckoTerminal
				</a>{' '}
				· {GECKO_NETWORK}
			</p>
		</div>
	)
}
