import { useEffect, useState } from 'react'
import { MarketsPage } from './MarketsPage'
import './autopilot.css'

export function MarketsRoutePage() {
	const [marketPriceUsdcPerSui, setMarketPriceUsdcPerSui] = useState<number | null>(null)
	const [marketPriceSource, setMarketPriceSource] = useState<string | null>(null)

	useEffect(() => {
		let alive = true
		void (async () => {
			try {
				const r = await fetch('/api/autopilot/market?protocol=clmm')
				const j = (await r.json()) as {
					marketPriceUsdcPerSui?: number | null
					marketPriceSource?: string | null
				}
				if (!alive) return
				setMarketPriceUsdcPerSui(
					typeof j.marketPriceUsdcPerSui === 'number' && j.marketPriceUsdcPerSui > 0
						? j.marketPriceUsdcPerSui
						: null,
				)
				setMarketPriceSource(typeof j.marketPriceSource === 'string' ? j.marketPriceSource : null)
			} catch {
				/* keep null */
			}
		})()
		return () => {
			alive = false
		}
	}, [])

	return (
		<div className="autopilot-root mx-auto min-w-0 max-w-6xl px-4 py-8">
			<MarketsPage
				marketPriceUsdcPerSui={marketPriceUsdcPerSui}
				marketPriceSource={marketPriceSource}
			/>
		</div>
	)
}
