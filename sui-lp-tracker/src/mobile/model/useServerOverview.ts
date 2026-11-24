import { useEffect, useState } from 'react'
import { apiUrl } from '@/utils/deploymentOrigin'
import type { OverviewApiResponse, WalletOverview } from '@/services/server/overviewTypes'

type State = {
	overview: WalletOverview | null
	computedAt: number | null
	stale: boolean
	status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
}

const idle: State = { overview: null, computedAt: null, stale: true, status: 'idle' }

/**
 * One-shot fetch of the worker cache for Home. Does not replace live store updates.
 */
export function useServerOverview(walletAddr: string | null | undefined): State {
	const [state, setState] = useState<State>(idle)

	useEffect(() => {
		const wallet = walletAddr?.trim().toLowerCase() ?? ''
		if (!wallet.startsWith('0x') || wallet.length < 66) {
			setState(idle)
			return
		}
		let cancelled = false
		setState((prev) => ({ ...prev, status: 'loading' }))
		const url = apiUrl(`/api/overview?wallet=${encodeURIComponent(wallet)}`)
		void fetch(url)
			.then(async (res) => {
				if (cancelled) return
				if (res.status === 404) {
					setState({ overview: null, computedAt: null, stale: true, status: 'missing' })
					return
				}
				if (!res.ok) {
					setState({ overview: null, computedAt: null, stale: true, status: 'error' })
					return
				}
				const body = (await res.json()) as OverviewApiResponse
				if (cancelled) return
				if (!body?.overview || typeof body.computedAt !== 'number') {
					setState({ overview: null, computedAt: null, stale: true, status: 'error' })
					return
				}
				setState({
					overview: body.overview,
					computedAt: body.computedAt,
					stale: Boolean(body.stale),
					status: 'ready',
				})
			})
			.catch(() => {
				if (!cancelled) setState({ overview: null, computedAt: null, stale: true, status: 'error' })
			})
		return () => {
			cancelled = true
		}
	}, [walletAddr])

	return state
}

export function formatOverviewAge(computedAt: number | null, now = Date.now()): string | null {
	if (computedAt == null || !Number.isFinite(computedAt)) return null
	const mins = Math.max(0, Math.round((now - computedAt) / 60_000))
	if (mins <= 0) return 'updated just now'
	if (mins === 1) return 'updated 1 min ago'
	return `updated ${mins} min ago`
}
