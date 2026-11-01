export interface LatencyStats {
	count: number
	min: number
	max: number
	mean: number
	p50: number
	p90: number
	p95: number
	p99: number
}

/** Bounded ring buffer for RPC latency samples. */
export class RollingLatency {
	private buf: number[]
	private i = 0
	private filled = 0
	readonly name: string

	constructor(name: string, capacity = 512) {
		this.name = name
		this.buf = new Array(Math.max(16, capacity))
	}

	push(ms: number): void {
		if (!Number.isFinite(ms) || ms < 0) return
		this.buf[this.i] = ms
		this.i = (this.i + 1) % this.buf.length
		this.filled = Math.min(this.filled + 1, this.buf.length)
	}

	samples(): number[] {
		if (this.filled < this.buf.length) return this.buf.slice(0, this.filled)
		const out: number[] = []
		for (let k = 0; k < this.filled; k++) {
			out.push(this.buf[(this.i + k) % this.buf.length]!)
		}
		return out
	}

	stats(): LatencyStats {
		const s = this.samples().sort((a, b) => a - b)
		if (s.length === 0) {
			return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0 }
		}
		const sum = s.reduce((a, b) => a + b, 0)
		return {
			count: s.length,
			min: s[0]!,
			max: s[s.length - 1]!,
			mean: sum / s.length,
			p50: percentile(s, 0.5),
			p90: percentile(s, 0.9),
			p95: percentile(s, 0.95),
			p99: percentile(s, 0.99),
		}
	}
}

export function percentile(sortedAsc: number[], p: number): number {
	if (sortedAsc.length === 0) return 0
	if (sortedAsc.length === 1) return sortedAsc[0]!
	const idx = (sortedAsc.length - 1) * p
	const lo = Math.floor(idx)
	const hi = Math.ceil(idx)
	if (lo === hi) return sortedAsc[lo]!
	const w = idx - lo
	return sortedAsc[lo]! * (1 - w) + sortedAsc[hi]! * w
}
