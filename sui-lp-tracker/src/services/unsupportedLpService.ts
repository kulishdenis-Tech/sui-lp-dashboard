/**
 * Unsupported / staking inventory stubs (TZ §5 / P1-2).
 * Classifier matches package::module::Struct (prefix-safe for truncated TZ ids).
 * Partial owned scan → incomplete + reason for snapshot / UI «scan incomplete».
 */
import type { OpenPosition } from '@/types'
import { suiClient } from '@/services/suiClient'
import { normalizeSuiAddress } from '@mysten/sui/utils'

export type UnsupportedScanResult = {
	positions: OpenPosition[]
	/** Grouped label for UI: Unsupported (Type, N) */
	groups: Array<{ typeLabel: string; count: number }>
	staking: OpenPosition[]
	incomplete: boolean
	reason?: string
}

type TypeRef = { pkg: string; module: string; struct: string; bare: string }

/** Known DeFi inventory types — package prefix (hex without 0x) + module + struct. */
const TYPE_RULES: Array<{
	pkgPrefix: string
	module: string
	struct: string
	label: string
	kind: 'unsupported' | 'staking'
}> = [
	{ pkgPrefix: '25929e7f', module: 'position', struct: 'Position', label: 'CLMM Position', kind: 'unsupported' },
	{ pkgPrefix: '943535', module: 'position', struct: 'Position', label: 'Farm Position', kind: 'unsupported' },
	{ pkgPrefix: 'ba0dd78b', module: 'farm', struct: 'StakeReceipt', label: 'Kriya StakeReceipt', kind: 'unsupported' },
	{ pkgPrefix: '3d5653b0', module: 'staking', struct: 'Position', label: 'Haedal staking::Position', kind: 'unsupported' },
	{ pkgPrefix: 'cd86f775', module: 'receipt', struct: 'Receipt', label: 'Vault Receipt', kind: 'unsupported' },
	{ pkgPrefix: '2c8d603b', module: 'balance_manager', struct: 'TradeCap', label: 'DeepBook TradeCap', kind: 'unsupported' },
	{ pkgPrefix: '97d94737', module: 'margin_pool', struct: 'SupplierCap', label: 'DeepBook SupplierCap', kind: 'unsupported' },
	{ pkgPrefix: 'e87f1b2d', module: 'spool_account', struct: 'SpoolAccount', label: 'Scallop SpoolAccount', kind: 'unsupported' },
	{
		pkgPrefix: '042a1a41',
		module: 'leverage_obligation',
		struct: 'LeverageMarketOwnerCap',
		label: 'LeverageMarketOwnerCap',
		kind: 'unsupported',
	},
	{
		pkgPrefix: '41b1def4',
		module: 'alphalend_slush_pool',
		struct: 'PositionCap',
		label: 'alphalend_slush PositionCap',
		kind: 'unsupported',
	},
	{ pkgPrefix: '3', module: 'staking_pool', struct: 'StakedSui', label: 'StakedSui', kind: 'staking' },
	{ pkgPrefix: '', module: 'staking_pool', struct: 'StakedWal', label: 'StakedWal', kind: 'staking' },
	{ pkgPrefix: '', module: 'staked_wal', struct: 'StakedWal', label: 'StakedWal', kind: 'staking' },
]

/** Legacy struct-name tails (TZ §5 original). */
const STRUCT_TAILS = new Set([
	'AlphaFiReceipt',
	'WrappedPositionNFT',
	'CetusVaultVester',
	'LBPosition',
	'PyPosition',
	'MarketPosition',
	'Farm',
	'StakeReceipt',
	'Receipt',
	'TradeCap',
	'SupplierCap',
	'SpoolAccount',
	'Spool',
	'StakingPosition',
	'VaultShare',
	'PositionNFT',
	'LeverageMarketOwnerCap',
	'PositionCap',
	'StakedSui',
	'StakedWal',
])

function parseTypeRef(typeStr: string): TypeRef | null {
	const bare = typeStr.includes('<') ? typeStr.slice(0, typeStr.indexOf('<')) : typeStr
	const parts = bare.split('::')
	if (parts.length < 3) return null
	const struct = parts[parts.length - 1] ?? ''
	const module = parts[parts.length - 2] ?? ''
	const pkg = (parts[0] ?? '').toLowerCase().replace(/^0x0+/, '0x')
	return { pkg, module, struct, bare }
}

function pkgHex(pkg: string): string {
	return pkg.replace(/^0x/i, '').replace(/^0+/, '') || '0'
}

export function classifyOwnedMoveType(
	typeStr: string,
): { label: string; kind: 'unsupported' | 'staking' } | null {
	const ref = parseTypeRef(typeStr)
	if (!ref) return null
	const hex = pkgHex(ref.pkg)

	for (const rule of TYPE_RULES) {
		if (ref.module !== rule.module || ref.struct !== rule.struct) continue
		if (!rule.pkgPrefix) return { label: rule.label, kind: rule.kind }
		const pref = rule.pkgPrefix.toLowerCase()
		if (hex.startsWith(pref) || pref.startsWith(hex)) {
			return { label: rule.label, kind: rule.kind }
		}
		if (
			pref === '3' &&
			(hex === '3' ||
				ref.pkg === '0x3' ||
				ref.pkg === '0x0000000000000000000000000000000000000000000000000000000000000003')
		) {
			return { label: rule.label, kind: rule.kind }
		}
	}

	if (STRUCT_TAILS.has(ref.struct)) {
		const kind = ref.struct === 'StakedSui' || ref.struct === 'StakedWal' ? 'staking' : 'unsupported'
		return { label: ref.struct, kind }
	}
	return null
}

function stubRow(
	id: string,
	typeLabel: string,
	kind: 'unsupported' | 'staking',
	opts?: { amountHuman?: number; coinSymbol?: string },
): OpenPosition {
	const protocol = kind === 'staking' ? 'staking' : 'unsupported'
	const pair =
		kind === 'staking'
			? `Staking (${typeLabel}${opts?.amountHuman != null && opts.coinSymbol ? `, ${opts.amountHuman} ${opts.coinSymbol}` : ''})`
			: `Unsupported (${typeLabel})`
	return {
		id,
		protocol,
		poolId: '',
		pair,
		tokenA: opts?.coinSymbol ?? '—',
		tokenB: '—',
		tokenAAddress: '',
		tokenBAddress: '',
		tokenADecimals: 0,
		tokenBDecimals: 0,
		fee: 0,
		tickLower: 0,
		tickUpper: 0,
		currentTick: 0,
		currentSqrtPrice: '0',
		liquidity: '0',
		lifecycleStatus: 'unknown',
		status: 'unsupported',
		tokenAAmount: opts?.amountHuman ?? 0,
		tokenBAmount: 0,
		currentPriceA_USD: Number.NaN,
		currentPriceB_USD: Number.NaN,
		currentValueUSD: Number.NaN,
		depositedUSD: Number.NaN,
		pnlUSD: Number.NaN,
		pnlPct: Number.NaN,
		unclaimedFeeA: 0,
		unclaimedFeeB: 0,
		unclaimedFeeUSD: Number.NaN,
		unclaimedRewardUSD: Number.NaN,
		openedAt: 0,
		daysOpen: Number.NaN,
		lifetimeEarningsUSD: Number.NaN,
		vsHodlDeltaUSD: Number.NaN,
		aprEstimatePct: Number.NaN,
		historyPartial: true,
		unsupportedType: typeLabel,
	}
}

function groupLabels(positions: OpenPosition[]): Array<{ typeLabel: string; count: number }> {
	const m = new Map<string, number>()
	for (const p of positions) {
		const label = p.unsupportedType ?? 'Unknown'
		m.set(label, (m.get(label) ?? 0) + 1)
	}
	return [...m.entries()]
		.map(([typeLabel, count]) => ({ typeLabel, count }))
		.sort((a, b) => b.count - a.count || a.typeLabel.localeCompare(b.typeLabel))
}

function contentFields(obj: unknown): Record<string, unknown> | null {
	if (!obj || typeof obj !== 'object') return null
	const o = obj as Record<string, unknown>
	const data = (o.data ?? o) as Record<string, unknown>
	const content = data.content as Record<string, unknown> | undefined
	if (!content) return null
	return (content.fields ?? content) as Record<string, unknown>
}

function readPrincipalAmount(fields: Record<string, unknown> | null): number | null {
	if (!fields) return null
	const raw = fields.principal ?? fields.staked ?? fields.amount ?? fields.value
	if (typeof raw === 'string' && /^\d+$/.test(raw)) {
		const n = Number(raw) / 1e9
		return Number.isFinite(n) ? n : null
	}
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw / 1e9
	return null
}

/**
 * Full owned walk. Caps at 80 pages × 50; beyond → incomplete.
 */
export async function scanUnsupportedInventory(walletAddress: string): Promise<UnsupportedScanResult> {
	let owner: string
	try {
		owner = normalizeSuiAddress(walletAddress.trim())
	} catch {
		owner = walletAddress.trim()
	}

	const unsupported: OpenPosition[] = []
	const staking: OpenPosition[] = []
	const seen = new Set<string>()
	let incomplete = false
	let reason: string | undefined

	const ingest = (id: string, typ: string, fields: Record<string, unknown> | null) => {
		if (seen.has(id)) return
		const hit = classifyOwnedMoveType(typ)
		if (!hit) return
		seen.add(id)
		if (hit.kind === 'staking') {
			const amt = readPrincipalAmount(fields)
			const sym = hit.label === 'StakedWal' ? 'WAL' : 'SUI'
			staking.push(
				stubRow(id, hit.label, 'staking', {
					amountHuman: amt ?? undefined,
					coinSymbol: sym,
				}),
			)
		} else {
			unsupported.push(stubRow(id, hit.label, 'unsupported'))
		}
	}

	let cursor: string | null | undefined
	const MAX_PAGES = 80
	for (let page = 0; page < MAX_PAGES; page++) {
		try {
			const res = await suiClient.getOwnedObjects({
				owner,
				cursor: cursor ?? undefined,
				limit: 50,
				options: { showType: true, showContent: true },
			})
			for (const row of res.data) {
				const typ = row.data?.type
				const id = row.data?.objectId
				if (!typ || !id) continue
				ingest(id, typ, contentFields(row))
			}
			if (!res.hasNextPage || !res.nextCursor) break
			cursor = res.nextCursor
			if (page === MAX_PAGES - 1 && res.hasNextPage) {
				incomplete = true
				reason = `owned inventory truncated after ${MAX_PAGES * 50} objects`
			}
		} catch (e) {
			incomplete = true
			reason = e instanceof Error ? e.message : String(e)
			break
		}
	}

	return {
		positions: unsupported,
		groups: groupLabels(unsupported),
		staking,
		incomplete,
		reason,
	}
}

/** Flat OpenPosition[] (unsupported + staking). Prefer `scanUnsupportedInventory` for incomplete. */
export async function getUnsupportedLpStubs(walletAddress: string): Promise<OpenPosition[]> {
	const scan = await scanUnsupportedInventory(walletAddress)
	return [...scan.positions, ...scan.staking]
}
