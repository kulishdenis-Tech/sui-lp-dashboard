import { geckoTerminalPoolEmbedWebUrl, geckoTerminalPoolWebUrl } from '@/lib/geckoPoolOhlcvCore'
import type { OpenPosition } from '@/types'
import { GECKO_NETWORK } from '@/utils/constants'

/**
 * Pool chart — GeckoTerminal embedded iframe only.
 * Mounting is deferred by the parent (PositionDetailPage) until the user expands
 * the chart section, so the iframe loads lazily on first open.
 */
export function PositionPoolChart({
	position,
	pairLabel,
}: {
	position: OpenPosition
	pairLabel?: string
}) {
	const poolId = position.poolId
	const label = pairLabel ?? `${position.tokenA} / ${position.tokenB}`

	if (!poolId) {
		return <p className="text-sm text-slate-500">No pool chart available (missing pool id).</p>
	}

	const embedUrl = geckoTerminalPoolEmbedWebUrl(GECKO_NETWORK, poolId, { dark: true })
	const poolUrl = geckoTerminalPoolWebUrl(GECKO_NETWORK, poolId)

	return (
		<div className="w-full">
			<div className="w-full overflow-hidden rounded-lg border border-slate-800/90 bg-slate-950/50">
				<iframe
					title={`GeckoTerminal chart — ${label}`}
					src={embedUrl}
					className="h-[480px] w-full border-0"
					referrerPolicy="strict-origin-when-cross-origin"
					allow="fullscreen"
				/>
			</div>
			<p className="mt-1.5 text-[11px] text-slate-600">
				Chart by{' '}
				{poolUrl ? (
					<a
						href={poolUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="text-slate-500 hover:text-sky-400"
					>
						GeckoTerminal
					</a>
				) : (
					'GeckoTerminal'
				)}{' '}
				· {GECKO_NETWORK}
			</p>
		</div>
	)
}

