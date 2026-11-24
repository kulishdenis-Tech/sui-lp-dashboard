/**
 * Reload-proof completion for OKX mobile signing.
 *
 * Mobile browsers often unload the tab while the user is in the OKX app, and the OKX SDK keeps
 * pending requests only in page memory, so the wallet's reply is lost. Instead the wallet signs
 * AND executes, and we confirm by the transaction digest, which we compute ourselves from the
 * exact bytes we sent. The result is then read from chain, not from a reply that may never arrive.
 */
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient'
import { okxLog } from '@/wallet/okxDebugLog'

const KEY = 'okx-connect-pending-tx'
const MAX_AGE_MS = 10 * 60_000

export type PendingOkxTx = { digest: string; owner: string; ts: number }

export function savePending(p: PendingOkxTx): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(p))
	} catch {
		/* best-effort */
	}
}

export function clearPending(): void {
	try {
		localStorage.removeItem(KEY)
	} catch {
		/* best-effort */
	}
}

export function readPending(now = Date.now()): PendingOkxTx | null {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return null
		const p = JSON.parse(raw) as PendingOkxTx
		if (!p?.digest || typeof p.ts !== 'number' || now - p.ts > MAX_AGE_MS) {
			clearPending()
			return null
		}
		return p
	} catch {
		return null
	}
}

export type LandedTx = { digest: string; signature: string | null; success: boolean }

/** Poll the chain until the digest shows up. Resolves null when it does not within `timeoutMs`. */
export async function waitForDigestOnChain(
	digest: string,
	opts: { timeoutMs?: number; intervalMs?: number; isCancelled?: () => boolean } = {},
): Promise<LandedTx | null> {
	const { timeoutMs = 120_000, intervalMs = 2_500, isCancelled } = opts
	const client = getDashboardGrpcClient()
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (isCancelled?.()) return null
		try {
			const res = await client.getTransaction({ digest })
			const tx = res.Transaction ?? res.FailedTransaction
			if (tx) {
				return { digest, signature: tx.signatures?.[0] ?? null, success: res.$kind === 'Transaction' }
			}
		} catch {
			/* not found yet (or transient): keep polling */
		}
		await new Promise((r) => setTimeout(r, intervalMs))
	}
	return null
}

/** After a reload: if a request was pending, tell the user whether it landed and refresh data. */
export async function resumePendingOkxTx(): Promise<void> {
	const p = readPending()
	if (!p) return
	okxLog(`resume: waiting for ${p.digest.slice(0, 8)}…`)
	const landed = await waitForDigestOnChain(p.digest, { timeoutMs: 3 * 60_000 })
	clearPending()
	if (!landed) {
		okxLog('resume: not found on chain (rejected or never sent)')
		return
	}
	okxLog(`resume: landed ${landed.success ? 'ok' : 'FAILED'}`)
	const { pushToast } = await import('@/services/toastBus')
	pushToast(
		landed.success ? 'Transaction confirmed' : 'Transaction failed on chain',
		`${p.digest.slice(0, 10)}…`,
	)
	const { useAppStore } = await import('@/store/appStore')
	void useAppStore.getState().loadAll(p.owner, { forceRefreshPrices: true })
}
