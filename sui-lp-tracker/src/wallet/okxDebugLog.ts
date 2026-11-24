/**
 * Tiny persistent event log for the OKX mobile flow. A phone has no console, and the page can be
 * reloaded while the user is in the OKX app, so the log lives in localStorage and survives that.
 * Never stores keys, signatures or transaction bytes: only step names and short messages.
 */
const KEY = 'okx-connect-debug'
const MAX = 80

type Entry = { t: number; m: string }

function read(): Entry[] {
	try {
		const raw = localStorage.getItem(KEY)
		const arr = raw ? (JSON.parse(raw) as Entry[]) : []
		return Array.isArray(arr) ? arr : []
	} catch {
		return []
	}
}

export function okxLog(message: string): void {
	try {
		const next = [...read(), { t: Date.now(), m: message.slice(0, 160) }].slice(-MAX)
		localStorage.setItem(KEY, JSON.stringify(next))
	} catch {
		/* storage unavailable: logging is best-effort */
	}
}

export function okxLogLines(): string[] {
	return read().map((e) => {
		const d = new Date(e.t)
		const hh = String(d.getHours()).padStart(2, '0')
		const mm = String(d.getMinutes()).padStart(2, '0')
		const ss = String(d.getSeconds()).padStart(2, '0')
		return `${hh}:${mm}:${ss} ${e.m}`
	})
}

export function okxLogClear(): void {
	try {
		localStorage.removeItem(KEY)
	} catch {
		/* ignore */
	}
}

/** Page lifecycle markers: they show whether the tab was hidden or reloaded during signing. */
export function installOkxLifecycleLog(): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return
	okxLog('page loaded')
	document.addEventListener('visibilitychange', () => okxLog(`page ${document.visibilityState}`))
	window.addEventListener('pageshow', (e) => okxLog(`pageshow${(e as PageTransitionEvent).persisted ? ' (restored)' : ''}`))
}
