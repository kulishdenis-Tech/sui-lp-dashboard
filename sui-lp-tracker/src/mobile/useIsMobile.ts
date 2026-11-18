import { useSyncExternalStore } from 'react'

/**
 * Мобільна оболонка вмикається за шириною екрана (<768px, як Tailwind `md`).
 * Для тестів: `?ui=mobile` / `?ui=desktop` фіксує режим у localStorage, `?ui=auto` скидає.
 */
const QUERY = '(max-width: 767px)'
const KEY = 'sui-lp-ui-mode'

type UiMode = 'mobile' | 'desktop' | null

function readOverride(): UiMode {
	if (typeof window === 'undefined') return null
	try {
		const q = new URLSearchParams(window.location.search).get('ui')
		if (q === 'mobile' || q === 'desktop') {
			window.localStorage.setItem(KEY, q)
			return q
		}
		if (q === 'auto') {
			window.localStorage.removeItem(KEY)
			return null
		}
		const saved = window.localStorage.getItem(KEY)
		return saved === 'mobile' || saved === 'desktop' ? saved : null
	} catch {
		return null
	}
}

function subscribe(cb: () => void): () => void {
	const mq = window.matchMedia(QUERY)
	mq.addEventListener('change', cb)
	return () => mq.removeEventListener('change', cb)
}

function snapshot(): boolean {
	const o = readOverride()
	if (o) return o === 'mobile'
	return window.matchMedia(QUERY).matches
}

export function useIsMobile(): boolean {
	return useSyncExternalStore(subscribe, snapshot, () => false)
}
