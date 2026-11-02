/**
 * Async tick-window expansion requests (never blocks Stage1 quoteExactIn).
 */

import type { PoolId } from '@/poolQuote/core/types'

export type TickExpandReason = 'tick_window_insufficient' | 'manual' | 'reconcile'

export interface TickExpandRequest {
	poolId: PoolId
	reason: TickExpandReason
	requestedAtMs: number
	direction?: 'up' | 'down' | 'both'
}

/**
 * Queue-only expander. Quote path must call requestExpand() and return;
 * network work happens outside quoteExactIn.
 */
export class TickWindowExpander {
	private readonly pending = new Map<PoolId, TickExpandRequest>()
	expansionsQueued = 0
	expansionsStarted = 0
	private worker: ((req: TickExpandRequest) => Promise<void>) | null = null
	private running = false

	setWorker(fn: (req: TickExpandRequest) => Promise<void>): void {
		this.worker = fn
	}

	/** Non-blocking: record need for expansion. */
	requestExpand(poolId: PoolId, reason: TickExpandReason = 'tick_window_insufficient'): void {
		this.expansionsQueued++
		this.pending.set(poolId, {
			poolId,
			reason,
			requestedAtMs: Date.now(),
			direction: 'both',
		})
		void this.pump()
	}

	pendingCount(): number {
		return this.pending.size
	}

	drainPending(): TickExpandRequest[] {
		const out = [...this.pending.values()]
		this.pending.clear()
		return out
	}

	private async pump(): Promise<void> {
		if (this.running || !this.worker) return
		this.running = true
		try {
			while (this.pending.size > 0) {
				const [id, req] = this.pending.entries().next().value!
				this.pending.delete(id)
				this.expansionsStarted++
				try {
					await this.worker(req)
				} catch {
					/* isolate */
				}
			}
		} finally {
			this.running = false
		}
	}
}

export const defaultTickWindowExpander = new TickWindowExpander()
