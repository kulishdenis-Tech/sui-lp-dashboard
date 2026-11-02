function envTruthy(v: string | undefined): boolean {
	if (v === undefined || v === '') return false
	const s = v.trim().toLowerCase()
	return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

/** `VITE_LP_LIFECYCLE_INDEXER=1` — Momentum закриті, harvest IndexedDB, додаткові метрики в ClosedPosition. */
export function isLpLifecycleIndexerEnabled(): boolean {
	try {
		return envTruthy(import.meta.env.VITE_LP_LIFECYCLE_INDEXER as string | undefined)
	} catch {
		return false
	}
}

/**
 * Другий прохід транзакцій ascending при `partial` (лише з увімкненим indexer / явним форсом RPC).
 */
export function shouldLpAscendingBackfill(partialHistory: boolean): boolean {
	if (!partialHistory) return false
	if (!isLpLifecycleIndexerEnabled()) {
		try {
			return envTruthy(import.meta.env.VITE_LP_LIFECYCLE_ASCENDING_FORCE as string | undefined)
		} catch {
			return false
		}
	}
	return true
}

/**
 * Скан глобальних `PositionClosed` + фільтр по `sender` транзакції (Sui RPC).
 * Фільтри `suix_queryEvents` не підтримують `And(Sender, MoveEventType)` для комбінованого запиту;
 * лише один критерій — тому гаманець з шумною Sender-стрічкою доповнюємо допоміжним проходом.
 * `0` — вимкнути assist; інакше 1…600 сторінок по 50 подій за сторінку.
 */
/**
 * `VITE_LP_LAZY_CLOSED=0` — завантажувати закриті LP одразу в `loadAll` (як раніше).
 * За замовчуванням закриті підвантажуються при першому відкритті вкладки Closed.
 */
export function isLpLazyClosedEnabled(): boolean {
	try {
		const raw = import.meta.env.VITE_LP_LAZY_CLOSED as string | undefined
		if (raw === undefined || raw === '') return true
		return envTruthy(raw)
	} catch {
		return true
	}
}

/** `VITE_BLUEFIN_LAZY_UNCLAIMED=0` — devInspect unclaimed у списку відкритих (повільніше). */
export function isBluefinLazyUnclaimedEnabled(): boolean {
	try {
		const raw = import.meta.env.VITE_BLUEFIN_LAZY_UNCLAIMED as string | undefined
		if (raw === undefined || raw === '') return true
		return envTruthy(raw)
	} catch {
		return true
	}
}

export function getBluefinPositionClosedAssistPages(): number {
	try {
		const raw = import.meta.env.VITE_BF_POSITION_CLOSED_ASSIST_PAGES as string | undefined
		if (raw === undefined || raw === '') return 100
		const n = parseInt(String(raw).trim(), 10)
		if (!Number.isFinite(n) || n <= 0) return 0
		return Math.min(600, n)
	} catch {
		return 100
	}
}

/** `VITE_LOCAL_UNCLAIMED=1` — Cetus fee-growth unclaimed (inspect fallback if ticks missing). Default off until parity. */
export function isLocalUnclaimedEnabled(): boolean {
	try {
		return envTruthy(import.meta.env.VITE_LOCAL_UNCLAIMED as string | undefined)
	} catch {
		return false
	}
}
