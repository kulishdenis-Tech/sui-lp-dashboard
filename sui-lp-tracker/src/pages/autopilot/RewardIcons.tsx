import type { ReactNode } from 'react'

/** Compact reward coin badges — known icons + letter fallback. */

const ICON_BY_SYMBOL: Record<string, string> = {
	SUI: 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
	CETUS: 'https://assets.coingecko.com/coins/images/30256/small/cetus.png',
	USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
}

export type RewardIconItem = {
	symbol: string
	coinType?: string
	aprPercent?: number | null
	rewardUsdPerDay?: number | null
}

export function RewardIcons({
	rewarders,
	empty = null,
	/** Markets: icon + reward APR % only (no symbol chip text). */
	showApr = false,
}: {
	rewarders: RewardIconItem[] | null | undefined
	empty?: ReactNode
	showApr?: boolean
}) {
	const list = rewarders ?? []
	if (list.length === 0) return <>{empty}</>

	return (
		<span className={`reward-icons${showApr ? ' reward-icons-apr' : ''}`} aria-label="Rewards">
			{list.map((rw) => {
				const sym = (rw.symbol || '?').toUpperCase()
				const src = ICON_BY_SYMBOL[sym]
				const tip = [
					sym,
					rw.aprPercent != null && Number.isFinite(rw.aprPercent) ? `APR ${rw.aprPercent.toFixed(1)}%` : null,
					rw.rewardUsdPerDay != null && rw.rewardUsdPerDay > 0
						? `≈ $${rw.rewardUsdPerDay.toFixed(2)}/day`
						: null,
					rw.coinType,
				]
					.filter(Boolean)
					.join(' · ')
				const apr =
					showApr && rw.aprPercent != null && Number.isFinite(rw.aprPercent)
						? `${rw.aprPercent.toFixed(1)}%`
						: null
				const icon = (
					<span className="reward-icon" aria-hidden={!showApr}>
						{src ? (
							<img
								src={src}
								alt={showApr ? '' : sym}
								width={18}
								height={18}
								loading="lazy"
								referrerPolicy="no-referrer"
								onError={(e) => {
									;(e.currentTarget as HTMLImageElement).style.display = 'none'
									const fallback = e.currentTarget.nextElementSibling
									if (fallback instanceof HTMLElement) fallback.hidden = false
								}}
							/>
						) : null}
						<span className="reward-icon-fallback" hidden={!!src}>
							{sym.slice(0, 1)}
						</span>
					</span>
				)
				if (!showApr) {
					return (
						<span key={`${rw.coinType ?? ''}-${sym}`} title={tip}>
							{icon}
						</span>
					)
				}
				return (
					<span key={`${rw.coinType ?? ''}-${sym}`} className="reward-apr-item" title={tip}>
						{icon}
						{apr ? <span className="reward-icon-apr">{apr}</span> : null}
					</span>
				)
			})}
		</span>
	)
}
