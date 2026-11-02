import { useEffect, useMemo, useState } from 'react'
import { resolveCoinMetadata } from '@/services/coinMetadata'
import { resolveSpots } from '@/services/spotPrice/resolveSpots'
import { suiClient } from '@/services/suiClient'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { MetricValueWithPartial, PartialDataMark } from '@/components/ui/PartialDataMark'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import {
	formatSuiAmount,
	formatTokenAmount,
	formatUsdDisplay,
	mistToSui,
	suiUsdFromHint,
	type GasPreviewInput,
} from './manageAmounts'
import {
	aggregateCascadeNetworkFees,
	aggregateCascadeReceives,
	humanizeAggregatedReceives,
	type CascadeDryRunSlice,
} from './cascadeManageAggregate'
import { symbolFromType, type BalanceChangeRow, type PositionHint } from './previewReceiveSummary'

type BuiltLike = {
	balanceChanges?: BalanceChangeRow[]
	gas?: GasPreviewInput
	dryRunOk?: boolean
	error?: string
}

type Props = {
	owner: string
	previews: (BuiltLike | null)[]
	positionHints: (PositionHint | null)[]
	consequence: string | null
}

function hintDecimals(hint: PositionHint | null, coinType: string): number | null {
	if (!hint) return null
	const ct = normalizeCoinTypeForMatch(coinType)
	if (normalizeCoinTypeForMatch(hint.tokenAAddress) === ct) {
		return Number.isInteger(hint.tokenADecimals) && hint.tokenADecimals >= 0
			? hint.tokenADecimals
			: null
	}
	if (normalizeCoinTypeForMatch(hint.tokenBAddress) === ct) {
		return Number.isInteger(hint.tokenBDecimals) && hint.tokenBDecimals >= 0
			? hint.tokenBDecimals
			: null
	}
	return null
}

function hintPrice(hint: PositionHint | null, coinType: string): number | null {
	if (!hint) return null
	const ct = normalizeCoinTypeForMatch(coinType)
	if (
		normalizeCoinTypeForMatch(hint.tokenAAddress) === ct &&
		hint.currentPriceA_USD != null &&
		hint.currentPriceA_USD > 0
	) {
		return hint.currentPriceA_USD
	}
	if (
		normalizeCoinTypeForMatch(hint.tokenBAddress) === ct &&
		hint.currentPriceB_USD != null &&
		hint.currentPriceB_USD > 0
	) {
		return hint.currentPriceB_USD
	}
	return null
}

/** Aggregated Expected to Receive + Network Fee across cascade dry-runs. */
export function CascadeBatchSummary({ owner, previews, positionHints, consequence }: Props) {
	const slices: CascadeDryRunSlice[] = useMemo(
		() =>
			previews.map((p) => ({
				owner,
				balanceChanges: p?.balanceChanges,
				gas: p?.gas ?? undefined,
				ok: !!p && p.dryRunOk === true && !p.error,
			})),
		[previews, owner],
	)

	const rawLines = useMemo(() => aggregateCascadeReceives(slices), [slices])
	const feeAgg = useMemo(() => aggregateCascadeNetworkFees(slices), [slices])

	const [lines, setLines] = useState<
		{ coinType: string; symbol: string; amount: number | null; unavailable: boolean; amountUsd: number | null; priced: boolean }[]
	>([])
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		let cancelled = false
		if (!rawLines.length) {
			setLines([])
			return
		}
		setLoading(true)
		void (async () => {
			const metas = await Promise.all(
				rawLines.map(async (row) => {
					const meta = await resolveCoinMetadata(suiClient, row.coinType).catch(() => null)
					return { row, meta }
				}),
			)
			const decimalsBy = new Map<string, number>()
			const symbolBy = new Map<string, string>()
			for (const { row, meta } of metas) {
				const key = normalizeCoinTypeForMatch(row.coinType)
				const fromMeta = meta?.decimals
				const fromHint =
					positionHints.map((h) => hintDecimals(h, row.coinType)).find((d) => d != null) ?? null
				const dec = fromMeta ?? fromHint
				if (dec != null && Number.isInteger(dec) && dec >= 0) decimalsBy.set(key, dec)
				symbolBy.set(key, meta?.symbol || symbolFromType(row.coinType))
			}
			const human = humanizeAggregatedReceives(rawLines, decimalsBy, symbolBy)
			const withDec = human.filter((h) => !h.unavailable && h.amount != null)
			const spots = await resolveSpots(
				withDec.map((h) => h.coinType),
				(ct) => symbolBy.get(normalizeCoinTypeForMatch(ct)) || symbolFromType(ct),
				{ forceRefresh: false },
			).catch(() => new Map())
			const spotOf = (coinType: string): number | null => {
				const direct = spots.get(coinType)?.price
				if (direct != null && direct > 0) return direct
				const want = normalizeCoinTypeForMatch(coinType)
				for (const [k, v] of spots) {
					if (normalizeCoinTypeForMatch(k) === want && v.price > 0) return v.price
				}
				for (const h of positionHints) {
					const p = hintPrice(h, coinType)
					if (p != null) return p
				}
				return null
			}
			if (cancelled) return
			setLines(
				human.map((h) => {
					if (h.unavailable || h.amount == null) {
						return { ...h, amountUsd: null, priced: false }
					}
					const spot = spotOf(h.coinType)
					const priced = spot != null && spot > 0
					return {
						...h,
						amountUsd: priced ? h.amount * spot! : null,
						priced,
					}
				}),
			)
			setLoading(false)
		})()
		return () => {
			cancelled = true
		}
	}, [rawLines, positionHints])

	const priced = lines.filter((l) => !l.unavailable && l.priced && l.amountUsd != null)
	const allValued =
		lines.length > 0 &&
		lines.every((l) => !l.unavailable && l.priced) &&
		priced.length === lines.length
	const partialValued = priced.length > 0 && !allValued
	const totalUsd = priced.reduce((s, l) => s + (l.amountUsd ?? 0), 0)

	const grossMist = feeAgg.grossMist
	const netMist = feeAgg.netMist
	const isZero = grossMist != null && grossMist === 0n
	const grossSui = grossMist != null ? mistToSui(grossMist) : null
	const suiUsd =
		positionHints.map((h) => suiUsdFromHint(h)).find((p) => p != null && p > 0) ?? null
	const grossUsd = grossSui != null && suiUsd != null ? grossSui * suiUsd : null
	const rebateLine =
		grossMist != null &&
		netMist != null &&
		netMist !== grossMist
			? {
					sui: mistToSui(netMist < 0n ? -netMist : netMist),
					isCredit: netMist < 0n,
					usd:
						suiUsd != null
							? mistToSui(netMist < 0n ? -netMist : netMist) * suiUsd
							: null,
				}
			: null

	const failedCount = slices.filter((s) => !s.ok).length

	return (
		<div className="preview-recv space-y-3">
			{consequence ? <p className="text-sm text-slate-300">{consequence}</p> : null}
			{failedCount > 0 ? (
				<p className="text-xs text-amber-200/90">
					{failedCount} estimate{failedCount === 1 ? '' : 's'} failed — totals exclude those LP.
				</p>
			) : null}

			<section>
				<div className="text-xs font-medium text-slate-200">Expected to Receive</div>
				<p className="mb-1 text-[11px] text-slate-500">All included positions combined</p>
				{loading && !lines.length ? <p className="mode">Estimating amounts…</p> : null}
				{!loading && !lines.length ? (
					<p className="mode">No receive amounts in the estimates yet.</p>
				) : null}
				{lines.length ? (
					<ul className="space-y-1">
						{lines.map((l) => (
							<li key={l.coinType} className="flex justify-between gap-2 text-sm">
								<span className="text-slate-300">{l.symbol}</span>
								<span className="font-mono text-slate-100 tabular-money">
									{l.unavailable || l.amount == null ? (
										<span className="text-amber-300/90">Estimate unavailable</span>
									) : (
										<>
											+{formatTokenAmount(l.amount)}
											<span className="ml-2 text-slate-400">
												{formatUsdDisplay(l.amountUsd)}
											</span>
										</>
									)}
								</span>
							</li>
						))}
						{priced.length > 0 ? (
							<li className="flex justify-between border-t border-slate-700 pt-1 text-sm">
								<span className="text-slate-400">Total ≈</span>
								<MetricValueWithPartial
									value={formatUsdDisplay(totalUsd)}
									partial={partialValued}
									tip="Partial data — some values are unavailable."
									className="font-mono text-slate-100 tabular-money"
								/>
							</li>
						) : null}
					</ul>
				) : null}
			</section>

			<section>
				<div className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-200">
					Estimated Network Fee
					<TooltipIconButton
						tip="Sum of computation + storage from dry-runs (similar to wallet gas). Storage rebate shown separately when present."
						aria-label="About network fee"
					/>
				</div>
				<p className="text-sm text-slate-100">
					{grossMist != null && formatSuiAmount(grossSui) != null ? (
						<span className="inline-flex items-baseline">
							{isZero ? '' : '≈ '}
							{formatSuiAmount(grossSui)} SUI
							{grossUsd != null ? (
								<span className="ml-2 text-slate-400">({formatUsdDisplay(grossUsd)})</span>
							) : (
								<span className="ml-2 text-slate-500">· SUI price unavailable</span>
							)}
							{feeAgg.anyMissing ? (
								<PartialDataMark
									className="ml-0.5"
									tip="Partial data — some values are unavailable. Some LP fee estimates are missing."
								/>
							) : null}
						</span>
					) : (
						<span className="text-slate-500">Estimate unavailable</span>
					)}
				</p>
				{rebateLine && formatSuiAmount(rebateLine.sui) != null ? (
					<p className="mt-0.5 text-[11px] text-slate-400">
						After storage rebate:{' '}
						<span className="font-mono text-slate-300">
							{rebateLine.isCredit ? '+' : '≈ '}
							{formatSuiAmount(rebateLine.sui)} SUI
						</span>
						{rebateLine.usd != null ? (
							<span className="ml-1">({formatUsdDisplay(rebateLine.usd)})</span>
						) : null}
					</p>
				) : null}
			</section>
		</div>
	)
}
