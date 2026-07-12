import type { TokenBalance } from '@/types'
import { pushToast } from '@/services/toastBus'

/** Алерт, якщо OKX % росту за 5м або 1г перевищує цей поріг. */
export const PRICE_SPIKE_THRESHOLD_PCT = 5

const COOLDOWN_MS = 30 * 60 * 1000
const LS_COOLDOWN = 'sui_lp_price_spike_cooldown_v1'

/** Fallback when sessionStorage is unavailable (SSR / vitest node). */
const memCooldown = new Map<string, number>()

const STABLE_SYMBOLS = /^(USDC|USDT|DAI|BUSD|FDUSD|USDZ|PYUSD|TUSD|FRAX|USDD)$/

type WindowKey = '5m' | '1h'

function isStable(symbol: string): boolean {
	return STABLE_SYMBOLS.test(symbol.toUpperCase())
}

function readCooldown(): Record<string, number> {
	if (typeof sessionStorage === 'undefined') {
		return Object.fromEntries(memCooldown)
	}
	try {
		const raw = sessionStorage.getItem(LS_COOLDOWN)
		if (!raw) return {}
		const o = JSON.parse(raw) as Record<string, number>
		return o && typeof o === 'object' ? o : {}
	} catch {
		return {}
	}
}

function writeCooldown(map: Record<string, number>) {
	memCooldown.clear()
	for (const [k, t] of Object.entries(map)) memCooldown.set(k, t)
	if (typeof sessionStorage === 'undefined') return
	try {
		const now = Date.now()
		const pruned: Record<string, number> = {}
		for (const [k, t] of Object.entries(map)) {
			if (now - t < COOLDOWN_MS * 2) pruned[k] = t
		}
		sessionStorage.setItem(LS_COOLDOWN, JSON.stringify(pruned))
	} catch {
		/* private mode */
	}
}

/** @internal tests */
export function clearPriceSpikeCooldownsForTests() {
	memCooldown.clear()
	if (typeof sessionStorage !== 'undefined') {
		try {
			sessionStorage.removeItem(LS_COOLDOWN)
		} catch {
			/* */
		}
	}
}

function cooldownKey(coinType: string, w: WindowKey): string {
	return `${coinType}|${w}`
}

function inCooldown(coinType: string, w: WindowKey): boolean {
	const t = readCooldown()[cooldownKey(coinType, w)]
	return t != null && Date.now() - t < COOLDOWN_MS
}

function markCooldown(coinType: string, w: WindowKey) {
	const map = readCooldown()
	map[cooldownKey(coinType, w)] = Date.now()
	writeCooldown(map)
}

async function ensureNotificationPermission(): Promise<boolean> {
	if (typeof window === 'undefined' || !('Notification' in window)) return false
	if (Notification.permission === 'granted') return true
	if (Notification.permission === 'denied') return false
	try {
		const r = await Notification.requestPermission()
		return r === 'granted'
	} catch {
		return false
	}
}

function showBrowserNotification(title: string, body: string) {
	void ensureNotificationPermission().then((ok) => {
		if (!ok) return
		try {
			new Notification(title, { body, silent: false })
		} catch {
			/* ignore */
		}
	})
}

function fmtPct(n: number): string {
	const sign = n > 0 ? '+' : ''
	return `${sign}${n.toFixed(1)}%`
}

export type PriceSpikeHit = {
	symbol: string
	coinType: string
	window: WindowKey
	pct: number
}

/**
 * Перевіряє токени гаманця на OKX 5m/1h > порогу (лише ріст).
 * Тост + browser Notification; cooldown 30 хв на пару (токен, вікно).
 */
export function evaluatePriceSpikes(tokens: TokenBalance[]): PriceSpikeHit[] {
	const hits: PriceSpikeHit[] = []
	for (const t of tokens) {
		if (isStable(t.symbol)) continue
		if (t.humanBalance <= 0) continue

		const c5 = t.change5m
		if (c5 != null && Number.isFinite(c5) && c5 >= PRICE_SPIKE_THRESHOLD_PCT) {
			if (!inCooldown(t.coinType, '5m')) {
				hits.push({ symbol: t.symbol, coinType: t.coinType, window: '5m', pct: c5 })
				markCooldown(t.coinType, '5m')
			}
		}

		const c1 = t.change1h
		if (c1 != null && Number.isFinite(c1) && c1 >= PRICE_SPIKE_THRESHOLD_PCT) {
			if (!inCooldown(t.coinType, '1h')) {
				hits.push({ symbol: t.symbol, coinType: t.coinType, window: '1h', pct: c1 })
				markCooldown(t.coinType, '1h')
			}
		}
	}

	for (const h of hits) {
		const windowLabel = h.window === '5m' ? '5 хв' : '1 год'
		const title = `${h.symbol} ${fmtPct(h.pct)}`
		const body = `Зріс більше ніж на ${PRICE_SPIKE_THRESHOLD_PCT}% за ${windowLabel}`
		pushToast(title, body)
		showBrowserNotification(title, body)
	}

	return hits
}
