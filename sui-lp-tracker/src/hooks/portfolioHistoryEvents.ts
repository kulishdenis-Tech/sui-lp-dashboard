/**
 * Tiny event bus for portfolio history refresh — no React imports.
 * Keeps read hooks from importing the snapshot writer (avoids HMR/hook cycles).
 */

const HISTORY_CHANGED = 'sui-portfolio-history-changed'

export function emitPortfolioHistoryChanged(walletAddr: string) {
	if (typeof window === 'undefined') return
	window.dispatchEvent(new CustomEvent(HISTORY_CHANGED, { detail: { walletAddr } }))
}

export function subscribePortfolioHistoryChanged(cb: (walletAddr: string) => void): () => void {
	const handler = (e: Event) => {
		const addr = (e as CustomEvent<{ walletAddr: string }>).detail?.walletAddr
		if (addr) cb(addr)
	}
	window.addEventListener(HISTORY_CHANGED, handler)
	return () => window.removeEventListener(HISTORY_CHANGED, handler)
}
