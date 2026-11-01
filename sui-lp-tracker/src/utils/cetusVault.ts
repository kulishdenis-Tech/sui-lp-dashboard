import type { OpenPosition } from '@/types'
import Decimal from 'decimal.js'

/** Official Cetus Vaults mainnet (`packages/vaults/src/config/mainnet.ts`). */
export const CETUS_VAULTS_PACKAGE =
	'0xd3453d9be7e35efe222f78a810bb3af1859fd1600926afced8b4936d825c9a05'
export const CETUS_VAULTS_POOL_HANDLE =
	'0x9036bcc5aa7fd2cceec1659a6a1082871f45bc400c743f50063363457d1738bd'

export function isCetusVaultPosition(
	p: Pick<OpenPosition, 'cetusVault'> | null | undefined,
): boolean {
	return p?.cetusVault != null
}

export function isCetusVaultLpCoinType(coinType: string): boolean {
	const t = coinType.trim()
	// Cetus native vaults mint `::lp_token::LP_TOKEN`; Haedal Liquidity mints `::lpcoin::LPCOIN`.
	return /::lp_token::LP_TOKEN$/i.test(t) || /::lpcoin::LPCOIN$/i.test(t)
}

/**
 * User share of vault CLMM liquidity:
 * `delta_liq = lp_token_amount * vault.liquidity / vault.total_supply`
 * (Cetus `VaultsUtils.getShareLiquidityByAmount`).
 */
export function shareLiquidityByLpAmount(
	lpTokenRaw: string,
	vaultLiquidity: string,
	totalSupply: string,
): string {
	if (totalSupply === '0' || totalSupply === '') return '0'
	try {
		const out = new Decimal(lpTokenRaw || '0')
			.mul(vaultLiquidity || '0')
			.div(totalSupply)
			.toFixed(0, Decimal.ROUND_DOWN)
		return out === '' ? '0' : out
	} catch {
		return '0'
	}
}

/** Split `Pkg::Mod::T<A, B<C, D>>` type arguments (comma at depth 0). */
export function typeArguments(structType: string): string[] {
	const lt = structType.indexOf('<')
	const gt = structType.lastIndexOf('>')
	if (lt < 0 || gt <= lt) return []
	const inner = structType.slice(lt + 1, gt)
	const out: string[] = []
	let depth = 0
	let cur = ''
	for (const ch of inner) {
		if (ch === '<') {
			depth++
			cur += ch
		} else if (ch === '>') {
			depth--
			cur += ch
		} else if (ch === ',' && depth === 0) {
			const t = cur.trim()
			if (t) out.push(t)
			cur = ''
		} else {
			cur += ch
		}
	}
	const last = cur.trim()
	if (last) out.push(last)
	return out
}

export function firstTypeArgument(structType: string): string | null {
	return typeArguments(structType)[0] ?? null
}

/** User ownership of vault LP supply as percent (0–100). */
export function vaultLpSharePct(lpTokenRaw: string, totalSupply: string): number | null {
	if (!totalSupply || totalSupply === '0') return null
	try {
		const pct = new Decimal(lpTokenRaw || '0').div(totalSupply).mul(100).toNumber()
		return Number.isFinite(pct) && pct >= 0 ? pct : null
	} catch {
		return null
	}
}

/**
 * Forward reward APR (%) for Earn auto-stake farm:
 * (Σ rate_per_sec × price × seconds/year) / farm_TVL × 100.
 * `farmLpStakedRaw` must be LP-token raw units (same scale as vault total_supply),
 * not incentive `total_share` (often amount × 1000).
 */
export function vaultFarmRewardAprPct(opts: {
	vaultTvlUsd: number
	vaultTotalSupply: string
	farmLpStakedRaw: string
	emissions: Array<{ ratePerSec: string; decimals: number; priceUsd: number }>
}): number | null {
	const { vaultTvlUsd, vaultTotalSupply, farmLpStakedRaw, emissions } = opts
	if (!(vaultTvlUsd > 0) || !vaultTotalSupply || vaultTotalSupply === '0') return null
	if (!farmLpStakedRaw || farmLpStakedRaw === '0') return null
	try {
		const farmTvl = new Decimal(vaultTvlUsd).mul(farmLpStakedRaw).div(vaultTotalSupply)
		if (farmTvl.lte(0)) return null
		const secYear = new Decimal(365).mul(86_400)
		let usdPerYear = new Decimal(0)
		for (const e of emissions) {
			if (!(e.priceUsd > 0) || !e.ratePerSec || e.ratePerSec === '0') continue
			const humanPerSec = new Decimal(e.ratePerSec).div(new Decimal(10).pow(e.decimals))
			usdPerYear = usdPerYear.plus(humanPerSec.mul(secYear).mul(e.priceUsd))
		}
		if (usdPerYear.lte(0)) return null
		const apr = usdPerYear.div(farmTvl).mul(100).toNumber()
		return Number.isFinite(apr) && apr >= 0 ? apr : null
	} catch {
		return null
	}
}

/**
 * Child object id from a dynamic-field entry.
 * Vault registries (Cetus / Haedal) key by `0x2::object::ID` — the vault id is
 * `name.value`. The DF `objectId` is only the wrapper field object.
 * For bags/tables keyed by other types, prefer `objectId`.
 */
export function dynamicFieldChildId(item: {
	objectId?: string | null
	name?: unknown
}): string | null {
	const name = item.name
	const nameType =
		name && typeof name === 'object' && 'type' in name
			? String((name as { type?: unknown }).type ?? '')
			: ''
	const fromName = (() => {
		if (typeof name === 'string' && name.startsWith('0x')) return name
		if (!name || typeof name !== 'object') return null
		const n = name as { value?: unknown }
		if (typeof n.value === 'string' && n.value.startsWith('0x')) return n.value
		if (n.value && typeof n.value === 'object') {
			const v = n.value as { id?: unknown }
			if (typeof v.id === 'string' && v.id.startsWith('0x')) return v.id
		}
		return null
	})()
	if (/::object::ID$/i.test(nameType) && fromName) return fromName
	if (typeof item.objectId === 'string' && item.objectId.startsWith('0x')) return item.objectId
	return fromName
}
