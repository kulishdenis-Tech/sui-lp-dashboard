import { useEffect, useMemo, useState } from 'react'
import { resolveCoinMetadata } from '@/services/coinMetadata'
import { resolveSpots } from '@/services/spotPrice/resolveSpots'
import { suiClient } from '@/services/suiClient'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { MetricValueWithPartial } from '@/components/ui/PartialDataMark'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import {
	estimateNetworkFee,
	formatSuiAmount,
	formatTokenAmount,
	formatUsdDisplay,
	mistToSui,
	remainingAfterRemove,
	suiUsdFromHint,
	type GasPreviewInput,
} from './manageAmounts'
import {
	aggregateOwnerReceives,
	aggregateOwnerSpends,
	rawToHuman,
	symbolFromType,
	type BalanceChangeRow,
	type PositionHint,
	type ReceiveLine,
} from './previewReceiveSummary'

type DisplayLine = ReceiveLine & {
	priced: boolean
	/** Missing decimals — amount unknown */
	unavailable: boolean
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

function shortCoinType(ct: string): string {
	if (ct.length < 16) return ct
	return `${ct.slice(0, 8)}…${ct.slice(-6)}`
}

function TokenLabel({ symbol, coinType }: { symbol: string; coinType: string }) {
	const looksGeneric = !symbol || symbol === '—' || /^0x/i.test(symbol) || symbol.length > 12
	const label = looksGeneric ? shortCoinType(coinType) : symbol
	return (
		<span className="inline-flex items-center gap-0.5 text-left text-slate-300">
			{label}
			{looksGeneric ? (
				<TooltipIconButton tip={coinType} aria-label="Coin type" leadingClassName="ml-0" />
			) : null}
		</span>
	)
}

export function PreviewReceiveBlock({
	kind,
	owner,
	balanceChanges,
	gas,
	positionHint,
	removePercent,
}: {
	kind: string
	owner: string
	balanceChanges?: BalanceChangeRow[]
	gas?: GasPreviewInput
	positionHint: PositionHint | null
	removePercent: number | null
}) {
	const [lines, setLines] = useState<DisplayLine[]>([])
	const [spendLines, setSpendLines] = useState<DisplayLine[]>([])
	const [loading, setLoading] = useState(false)

	const fee = useMemo(() => estimateNetworkFee(gas ?? null), [gas])
	const gasMistStr = fee ? fee.netMist.toString() : null

	const aggregated = useMemo(
		() => aggregateOwnerReceives(balanceChanges, owner, gasMistStr),
		[balanceChanges, owner, gasMistStr],
	)
	const aggregatedSpends = useMemo(
		() => (kind === 'add' ? aggregateOwnerSpends(balanceChanges, owner, gasMistStr) : []),
		[kind, balanceChanges, owner, gasMistStr],
	)

	useEffect(() => {
		async function hydrate(
			rows: { coinType: string; raw: bigint }[],
			setOut: (v: DisplayLine[]) => void,
		) {
			if (!rows.length) {
				setOut([])
				return
			}
			const metas = await Promise.all(
				rows.map(async (row) => {
					const meta = await resolveCoinMetadata(suiClient, row.coinType).catch(() => null)
					return { row, meta }
				}),
			)
			const symbolBy = (ct: string) => {
				const hit = metas.find(
					(m) => normalizeCoinTypeForMatch(m.row.coinType) === normalizeCoinTypeForMatch(ct),
				)
				return hit?.meta?.symbol || symbolFromType(ct)
			}
			const withDecimals = metas.filter(({ row, meta }) => {
				const dec = meta?.decimals ?? hintDecimals(positionHint, row.coinType)
				return dec != null && Number.isInteger(dec) && dec >= 0
			})
			const spots = await resolveSpots(
				withDecimals.map((u) => u.row.coinType),
				symbolBy,
				{ forceRefresh: false },
			).catch(() => new Map())
			const spotOf = (coinType: string): number | null => {
				const direct = spots.get(coinType)?.price
				if (direct != null && direct > 0) return direct
				const want = normalizeCoinTypeForMatch(coinType)
				for (const [k, v] of spots) {
					if (normalizeCoinTypeForMatch(k) === want && v.price > 0) return v.price
				}
				return hintPrice(positionHint, coinType)
			}
			const next: DisplayLine[] = metas.map(({ row, meta }) => {
				const decimals = meta?.decimals ?? hintDecimals(positionHint, row.coinType)
				const symbol = meta?.symbol || symbolFromType(row.coinType)
				if (decimals == null || !Number.isInteger(decimals) || decimals < 0) {
					return {
						coinType: row.coinType,
						symbol,
						amount: NaN,
						amountUsd: null,
						priced: false,
						unavailable: true,
					}
				}
				const amount = rawToHuman(row.raw, decimals)
				if (amount == null) {
					return {
						coinType: row.coinType,
						symbol,
						amount: NaN,
						amountUsd: null,
						priced: false,
						unavailable: true,
					}
				}
				const spot = spotOf(row.coinType)
				const priced = spot != null && spot > 0
				return {
					coinType: row.coinType,
					symbol,
					amount,
					amountUsd: priced ? amount * spot! : null,
					priced,
					unavailable: false,
				}
			})
			next.sort((a, b) => {
				if (a.unavailable !== b.unavailable) return a.unavailable ? 1 : -1
				return (b.amountUsd ?? 0) - (a.amountUsd ?? 0)
			})
			setOut(next)
		}

		let cancelled = false
		setLoading(true)
		void (async () => {
			await hydrate(aggregated, (v) => {
				if (!cancelled) setLines(v)
			})
			await hydrate(aggregatedSpends, (v) => {
				if (!cancelled) setSpendLines(v)
			})
			if (!cancelled) setLoading(false)
		})()
		return () => {
			cancelled = true
		}
	}, [aggregated, aggregatedSpends, positionHint])

	const pct = removePercent != null && removePercent > 0 && removePercent <= 1 ? removePercent : null
	const showRemain =
		(kind === 'remove' || kind === 'remove_converted') && positionHint && pct != null && pct < 1
	const showReceive = kind !== 'add' || lines.length > 0
	const pricedLines = lines.filter((l) => !l.unavailable && l.priced && l.amountUsd != null)
	const unavailableCount = lines.filter((l) => l.unavailable).length
	const unpricedCount = lines.filter((l) => !l.unavailable && !l.priced).length
	/** Completeness over the full expected asset set — not only successfully decimal-parsed lines. */
	const allValued =
		lines.length > 0 && unavailableCount === 0 && unpricedCount === 0 && pricedLines.length === lines.length
	const partialValued = pricedLines.length > 0 && !allValued
	const nothingValued = lines.length > 0 && pricedLines.length === 0
	const totalUsd = pricedLines.reduce((s, l) => s + (l.amountUsd ?? 0), 0)

	const remainA = showRemain ? remainingAfterRemove(positionHint!.tokenAAmount, pct!) : null
	const remainB = showRemain ? remainingAfterRemove(positionHint!.tokenBAmount, pct!) : null
	const remainUsdA =
		remainA && positionHint?.currentPriceA_USD != null && positionHint.currentPriceA_USD > 0
			? remainA.left * positionHint.currentPriceA_USD
			: null
	const remainUsdB =
		remainB && positionHint?.currentPriceB_USD != null && positionHint.currentPriceB_USD > 0
			? remainB.left * positionHint.currentPriceB_USD
			: null
	const remainFullyPriced = remainUsdA != null && remainUsdB != null
	const remainPartial = (remainUsdA != null || remainUsdB != null) && !remainFullyPriced
	const remainUsd =
		remainUsdA != null || remainUsdB != null ? (remainUsdA ?? 0) + (remainUsdB ?? 0) : null

	const suiUsd = suiUsdFromHint(positionHint)
	const grossSui = fee ? mistToSui(fee.grossMist) : null
	const grossUsd =
		grossSui != null && suiUsd != null && suiUsd > 0 ? grossSui * suiUsd : null
	const netSui = fee ? mistToSui(fee.netMist) : null
	const netAfterRebate =
		fee != null && fee.storageRebateMist > 0n
			? {
					sui: Math.abs(netSui ?? 0),
					isCredit: fee.netMist < 0n,
					usd:
						netSui != null && suiUsd != null && suiUsd > 0
							? Math.abs(netSui) * suiUsd
							: null,
				}
			: null
	const isZeroFee = fee != null && fee.grossMist === 0n
	const spendPriced = spendLines.filter((l) => !l.unavailable && l.priced && l.amountUsd != null)
	const spendTotalUsd = spendPriced.reduce((s, l) => s + (l.amountUsd ?? 0), 0)

	return (
		<div className="preview-recv space-y-3">
			{kind === 'add' ? (
				<section>
					<div className="text-xs font-medium text-slate-200">You Deposit</div>
					{loading && !spendLines.length ? <p className="mode">Estimating amounts…</p> : null}
					{!loading && !spendLines.length ? (
						<p className="mode">Deposit estimate pending.</p>
					) : null}
					{spendLines.length ? (
						<ul className="space-y-1">
							{spendLines.map((l) => (
								<li key={`spend-${l.coinType}`} className="flex justify-between gap-2 text-sm">
									<TokenLabel symbol={l.symbol} coinType={l.coinType} />
									<span className="font-mono text-right text-slate-100 tabular-money">
										{l.unavailable ? (
											<span className="text-amber-300/90">Estimate unavailable</span>
										) : (
											<>
												−{formatTokenAmount(l.amount)}
												<span className="ml-2 text-slate-400">
													{formatUsdDisplay(l.amountUsd)}
												</span>
											</>
										)}
									</span>
								</li>
							))}
							{spendPriced.length > 0 ? (
								<li className="flex justify-between border-t border-slate-700 pt-1 text-sm">
									<span className="text-left text-slate-400">Deposit ≈</span>
									<span className="font-mono text-slate-100 tabular-money">
										{formatUsdDisplay(spendTotalUsd)}
									</span>
								</li>
							) : null}
						</ul>
					) : null}
				</section>
			) : null}

			{showReceive ? (
				<section>
					<div className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-200">
						{kind === 'add' ? 'Refunds' : 'Expected to Receive'}
						{kind === 'add' ? (
							<TooltipIconButton
								tip="Leftover coins returned from the transaction, if any."
								aria-label="About refunds"
							/>
						) : null}
					</div>
					{loading && !lines.length ? <p className="mode">Estimating amounts…</p> : null}
					{!loading && !lines.length && kind !== 'add' ? (
						<p className="mode">No receive amounts in the estimate yet.</p>
					) : null}
					{lines.length ? (
						<ul className="space-y-1">
							{lines.map((l) => (
								<li key={l.coinType} className="flex justify-between gap-2 text-sm">
									<TokenLabel symbol={l.symbol} coinType={l.coinType} />
									<span className="font-mono text-right text-slate-100 tabular-money">
										{l.unavailable ? (
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
							{nothingValued ? (
								<li className="border-t border-slate-700 pt-1 text-sm text-amber-300/90">
									Estimate unavailable
								</li>
							) : pricedLines.length > 0 ? (
								<li className="flex justify-between border-t border-slate-700 pt-1 text-sm">
									<span className="text-left text-slate-400">Total ≈</span>
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
			) : null}

			{showRemain && remainA && remainB ? (
				<section>
					<div className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-200">
						Remaining in Position
						<TooltipIconButton
							tip="Estimate from current balances × remaining share. Not a guarantee."
							aria-label="About remaining amounts"
						/>
					</div>
					<ul className="mt-1 space-y-1 text-sm">
						<li className="flex justify-between gap-2">
							<span className="text-left text-slate-300">{positionHint!.tokenA}</span>
							<span className="font-mono text-slate-100 tabular-money">
								{formatTokenAmount(remainA.left)}
							</span>
						</li>
						<li className="flex justify-between gap-2">
							<span className="text-left text-slate-300">{positionHint!.tokenB}</span>
							<span className="font-mono text-slate-100 tabular-money">
								{formatTokenAmount(remainB.left)}
							</span>
						</li>
						<li className="flex justify-between border-t border-slate-700 pt-1">
							<span className="text-left text-slate-400">≈ USD</span>
							<MetricValueWithPartial
								value={remainUsd != null ? formatUsdDisplay(remainUsd) : null}
								partial={remainPartial}
								tip="Partial data — some values are unavailable."
								className="font-mono text-slate-100 tabular-money"
							/>
						</li>
					</ul>
				</section>
			) : null}

			<section>
				<div className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-200">
					Estimated Network Fee
					<TooltipIconButton
						tip="Computation + storage from dry-run (similar to the wallet gas line). Storage rebate, if any, is shown separately below — wallets usually show fee before rebate."
						aria-label="About network fee"
					/>
				</div>
				<p className="text-sm text-slate-100">
					{fee && formatSuiAmount(grossSui) != null ? (
						<>
							{isZeroFee ? '' : '≈ '}
							{formatSuiAmount(grossSui)} SUI
							{grossUsd != null ? (
								<span className="ml-2 text-slate-400">({formatUsdDisplay(grossUsd)})</span>
							) : (
								<span className="ml-2 text-slate-500">· SUI price unavailable</span>
							)}
						</>
					) : (
						<span className="text-slate-500">Estimate unavailable</span>
					)}
				</p>
				{netAfterRebate && formatSuiAmount(netAfterRebate.sui) != null ? (
					<p className="mt-0.5 text-[11px] text-slate-400">
						After storage rebate:{' '}
						<span className="font-mono text-slate-300">
							{netAfterRebate.isCredit ? '+' : '≈ '}
							{formatSuiAmount(netAfterRebate.sui)} SUI
						</span>
						{netAfterRebate.usd != null ? (
							<span className="ml-1">({formatUsdDisplay(netAfterRebate.usd)})</span>
						) : null}
					</p>
				) : null}
			</section>
		</div>
	)
}
