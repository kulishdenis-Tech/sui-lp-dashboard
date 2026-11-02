import { useMemo } from 'react'
import {
	geckoTerminalTokenEmbedWebUrl,
	geckoTerminalTokenWebUrl,
} from '@/lib/geckoPoolOhlcvCore'
import { geckoTokenAddressCandidates } from '@/services/tokenChartPool'
import { GECKO_NETWORK } from '@/utils/constants'

/**
 * Spot chart for a balance token — GeckoTerminal **token** embed.
 * Token pages always chart that asset in USD (e.g. NS ≈ $0.012), unlike pool
 * embeds where STABLE/TOKEN pools show the inverted axis (USD/NS ≈ 83).
 * @see https://about.geckoterminal.com/embed-charts
 */
export function TokenSpotChart({
	coinType,
	symbol,
}: {
	coinType: string
	symbol: string
}) {
	const tokenAddr = useMemo(
		() => geckoTokenAddressCandidates(coinType)[0] ?? coinType,
		[coinType],
	)
	const embedUrl = geckoTerminalTokenEmbedWebUrl(GECKO_NETWORK, tokenAddr, { dark: true })
	const tokenUrl = geckoTerminalTokenWebUrl(GECKO_NETWORK, tokenAddr)

	return (
		<div className="w-full py-2">
			<p className="mb-2 text-xs font-medium text-slate-400">
				{symbol}
				<span className="ml-1.5 font-normal text-slate-600">· USD</span>
			</p>
			<div className="w-full overflow-hidden rounded-lg border border-slate-800/90 bg-slate-950/50">
				<iframe
					title={`GeckoTerminal chart — ${symbol} / USD`}
					src={embedUrl}
					className="h-[420px] w-full border-0"
					referrerPolicy="strict-origin-when-cross-origin"
					allow="fullscreen"
				/>
			</div>
			<p className="mt-1.5 text-[11px] text-slate-600">
				Chart by{' '}
				<a
					href={tokenUrl}
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
