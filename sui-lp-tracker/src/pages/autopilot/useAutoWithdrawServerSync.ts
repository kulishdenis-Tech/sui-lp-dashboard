/**
 * Owner-level Auto Withdraw server sync — one poller for Manage, badges, Accept.
 * localStorage timers alone are not server sync.
 */
import { useEffect, useRef, useState } from 'react'
import {
	fetchServerHeartbeat,
	fetchServerRules,
	getAutoWithdrawRulesVersion,
} from './autoWithdrawStore'

const DEFAULT_POLL_MS = 12_000

export type AwServerSyncState = {
	/** Last successful rules GET (ms). */
	lastRulesSyncAtMs: number | null
	/** Service heartbeat ok. */
	serverOnline: boolean
	/** Bot loop last check timestamp (not position observation). */
	serviceLastCheckedAtMs: number | null
	syncError: string | null
	rulesVersion: number
}

/**
 * Poll server rules + heartbeat for one owner. Safe to mount once near the LP table.
 * Cancels in-flight work on unmount / owner change (generation guard).
 */
export function useAutoWithdrawServerSync(
	owner: string | null | undefined,
	opts?: { pollMs?: number; enabled?: boolean },
): AwServerSyncState {
	const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS
	const enabled = opts?.enabled !== false
	const [state, setState] = useState<AwServerSyncState>({
		lastRulesSyncAtMs: null,
		serverOnline: false,
		serviceLastCheckedAtMs: null,
		syncError: null,
		rulesVersion: getAutoWithdrawRulesVersion(),
	})
	const genRef = useRef(0)

	useEffect(() => {
		if (!enabled || !owner || !owner.startsWith('0x')) {
			return
		}
		const gen = ++genRef.current
		let cancelled = false

		async function tick() {
			if (cancelled || gen !== genRef.current) return
			try {
				const [rules, hb] = await Promise.all([
					fetchServerRules(owner!),
					fetchServerHeartbeat(),
				])
				if (cancelled || gen !== genRef.current) return
				setState({
					lastRulesSyncAtMs: rules ? Date.now() : null,
					serverOnline: !!hb?.ok,
					serviceLastCheckedAtMs: hb?.lastCheckedAtMs ?? null,
					syncError: rules == null ? 'Could not sync Watching from server.' : null,
					rulesVersion: getAutoWithdrawRulesVersion(),
				})
			} catch {
				if (cancelled || gen !== genRef.current) return
				setState((prev) => ({
					...prev,
					serverOnline: false,
					syncError: 'Could not sync Watching from server.',
					rulesVersion: getAutoWithdrawRulesVersion(),
				}))
			}
		}

		void tick()
		const id = window.setInterval(() => void tick(), pollMs)
		return () => {
			cancelled = true
			genRef.current += 1
			window.clearInterval(id)
		}
	}, [owner, pollMs, enabled])

	return state
}
