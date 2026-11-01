import { collectFeesExplicitlyZero, type ActivityTransaction } from '@/services/activity/activityModel'
import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'

export type ActivityExportCoverage = {
	loadedOnly: true
	oldestMs: number | null
	newestMs: number | null
	exhausted: boolean
	count: number
	parserVersion?: number
	gaps?: string
}

function csvCell(value: string): string {
	let s = value
	if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
	if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
	return s
}

function negateInt(raw: string): string {
	if (raw === '0') return '0'
	return raw.startsWith('-') ? raw.slice(1) : `-${raw}`
}

function coinMeta(coinType: string): { symbol: string; decimals: number | null } {
	const norm = normalizeCoinTypeForMatch(coinType)
	const hit = HARDCODED_VERIFIED.find((c) => normalizeCoinTypeForMatch(c.type) === norm)
	return { symbol: hit?.symbol ?? '', decimals: hit ? hit.decimals : null }
}

export type HistoricalPriceNote =
	| { usd: string; source: 'pyth'; timeUtc: string }
	| { unavailable: true }

/** Missing or non-finite price stays unavailable. Never substituted with 0 or 1. */
export function historicalPriceNote(
	usd: number | null | undefined,
	timeUtc: string,
): HistoricalPriceNote {
	if (usd == null || !Number.isFinite(usd)) return { unavailable: true }
	return { usd: String(usd), source: 'pyth', timeUtc }
}

export function humanRaw(amountRaw: string | null, decimals: number | null): string {
	if (amountRaw == null || decimals == null || !/^-?\d+$/.test(amountRaw)) return ''
	const neg = amountRaw.startsWith('-')
	const abs = neg ? amountRaw.slice(1) : amountRaw
	const padded = abs.padStart(decimals + 1, '0')
	const whole = padded.slice(0, padded.length - decimals)
	const frac = padded.slice(padded.length - decimals).replace(/0+$/, '')
	const human = frac ? `${whole}.${frac}` : whole
	return neg && human !== '0' ? `-${human}` : human
}

export type ExportRow = Record<string, string>

/** One row per activity leg. Network fee is its own row when this address paid it. */
export function displayAmount(amountRaw: string | null, decimals: number | null): string {
	if (amountRaw == null || decimals == null) return 'Amount unavailable'
	return humanRaw(amountRaw, decimals) || 'Amount unavailable'
}

export function activityExportRows(
	txs: ActivityTransaction[],
	wallet: string,
	coverage: ActivityExportCoverage,
	timeZone: string,
	prices: Record<string, HistoricalPriceNote> = {},
): ExportRow[] {
	const rows: ExportRow[] = []
	for (const tx of txs) {
		const utc = tx.timestampMs != null ? new Date(tx.timestampMs).toISOString() : ''
		const local =
			tx.timestampMs != null
				? new Date(tx.timestampMs).toLocaleString('en-US', { timeZone })
				: ''
		const base = {
			network: tx.network,
			wallet,
			timestampUtc: utc,
			localTime: local,
			timezone: timeZone,
			checkpoint: tx.checkpoint ?? '',
			digest: tx.digest,
			status: tx.status,
			completeness: tx.completeness,
			coverageOldestUtc:
				coverage.oldestMs != null ? new Date(coverage.oldestMs).toISOString() : '',
			coverageNewestUtc:
				coverage.newestMs != null ? new Date(coverage.newestMs).toISOString() : '',
			coverageExhausted: coverage.exhausted ? 'indexer cursor exhausted' : 'loaded range only',
			parserVersion: coverage.parserVersion != null ? String(coverage.parserVersion) : '',
			truncation: [tx.balanceTruncated ? 'balances' : '', tx.eventsTruncated ? 'events' : '', tx.objectsTruncated ? 'objects' : '']
				.filter(Boolean)
				.join(' '),
			gaps: coverage.gaps ?? (coverage.exhausted ? '' : 'older pages not loaded'),
		}
		tx.activities.forEach((leg) => {
			const amounts = leg.actionAmounts.length
				? leg.actionAmounts
				: [{ coinType: '', amountRaw: null, role: 'amount', unit: 'unknown' as const, flow: 'unknown' as const }]
			amounts.forEach((amt, index) => {
				const meta = coinMeta(amt.coinType)
				const priceKey = tx.timestampMs != null ? `${amt.coinType}|${Math.floor(tx.timestampMs / 1000)}` : ''
				const price = priceKey ? prices[priceKey] : undefined
				rows.push({
					...base,
					rowRole: 'activity',
					activityId: `${leg.id}:${amt.role}:${index}`,
					activityType: leg.kind,
					protocol: leg.protocol ?? '',
					coinType: amt.coinType,
					symbol: meta.symbol,
					decimals: meta.decimals != null ? String(meta.decimals) : '',
					amountRaw: amt.amountRaw ?? '',
					amountHuman: amt.amountRaw != null && meta.decimals != null ? humanRaw(amt.amountRaw, meta.decimals) : '',
					amountUnit: amt.unit,
					direction: amt.flow,
					historicalUsd: price && 'usd' in price ? price.usd : 'unavailable',
					priceSource: price && 'usd' in price ? price.source : '',
					priceTimeUtc: price && 'usd' in price ? price.timeUtc : '',
					feeRaw: '',
					feePayer: '',
					includesNetworkFee: 'no',
					reconciliation: collectFeesExplicitlyZero(leg)
						? 'explicit zero collect; missing coin types are not a collected amount'
						: 'semantic action amount; not a wallet delta',
					positionOrObjectIds: leg.objectIds.join(' '),
				})
			})
		})
		for (const change of tx.walletChanges) {
			const meta = coinMeta(change.coinType)
			const includesFee = tx.suiDeltaIncludesFee && meta.symbol === 'SUI'
			rows.push({
				...base,
				rowRole: 'wallet_change',
				activityId: `${tx.network}:${tx.digest}:wallet:${change.coinType}`,
				activityType: 'wallet_change',
				protocol: '',
				coinType: change.coinType,
				symbol: meta.symbol,
				decimals: meta.decimals != null ? String(meta.decimals) : '',
				amountRaw: change.amountRaw,
				amountHuman: meta.decimals != null ? humanRaw(change.amountRaw, meta.decimals) : '',
				amountUnit: 'raw_coin',
				direction: tx.status === 'unknown' ? 'unknown' : change.amountRaw.startsWith('-') ? 'out' : change.amountRaw === '0' ? 'unknown' : 'in',
				historicalUsd: 'unavailable',
				priceSource: '',
				priceTimeUtc: '',
				feeRaw: '',
				feePayer: '',
				includesNetworkFee: includesFee ? 'yes' : 'no',
				reconciliation: includesFee
					? 'SUI wallet delta already includes the network fee. Do not add the fee row to this delta.'
					: 'net wallet change',
				positionOrObjectIds: '',
			})
		}
		if (tx.feePaidByWallet && tx.netFeeRaw) {
			const impact = negateInt(tx.netFeeRaw)
			rows.push({
				...base,
				rowRole: 'network_fee',
				activityId: `${tx.network}:${tx.digest}:network_fee`,
				activityType: 'network_fee',
				protocol: '',
				coinType: '0x2::sui::SUI',
				symbol: 'SUI',
				decimals: '9',
				amountRaw: impact,
				amountHuman: humanRaw(impact, 9),
				amountUnit: 'raw_coin',
				direction: impact.startsWith('-') ? 'out' : impact === '0' ? 'unknown' : 'in',
				historicalUsd: 'unavailable',
				priceSource: '',
				priceTimeUtc: '',
				feeRaw: tx.netFeeRaw,
				feePayer: tx.feePayer ?? '',
				includesNetworkFee: 'fee row',
				reconciliation: 'signed net fee; a negative feeRaw is a storage refund',
				positionOrObjectIds: '',
			})
		}
	}
	return rows
}

export function activityRowsToCsv(rows: ExportRow[]): string {
	const headers = [
		'network',
		'wallet',
		'timestampUtc',
		'localTime',
		'timezone',
		'checkpoint',
		'digest',
		'rowRole',
		'activityId',
		'activityType',
		'protocol',
		'status',
		'coinType',
		'symbol',
		'decimals',
		'amountRaw',
		'amountHuman',
		'amountUnit',
		'direction',
		'historicalUsd',
		'priceSource',
		'priceTimeUtc',
		'feeRaw',
		'feePayer',
		'includesNetworkFee',
		'reconciliation',
		'positionOrObjectIds',
		'completeness',
		'parserVersion',
		'truncation',
		'gaps',
		'coverageOldestUtc',
		'coverageNewestUtc',
		'coverageExhausted',
	]
	const lines = [headers.join(',')]
	for (const row of rows) {
		lines.push(headers.map((h) => csvCell(row[h] ?? '')).join(','))
	}
	return lines.join('\n')
}

export function activityExportJson(
	txs: ActivityTransaction[],
	coverage: ActivityExportCoverage,
): string {
	return JSON.stringify({ coverage, transactions: txs }, null, 2)
}
