import type { StrategyConfig, StrategySlot } from './types.js'

/** In-memory registry enforcing at most one BUY and one SELL. */
export class StrategySlotRegistry {
	private readonly bySlot = new Map<StrategySlot, StrategyConfig>()

	get(slot: StrategySlot): StrategyConfig | undefined {
		return this.bySlot.get(slot)
	}

	list(): StrategyConfig[] {
		return [...this.bySlot.values()]
	}

	upsert(config: StrategyConfig): void {
		if (config.slot !== 'BUY' && config.slot !== 'SELL') {
			throw new Error(`invalid slot ${String(config.slot)}`)
		}
		this.bySlot.set(config.slot, config)
	}

	/** Create only if slot empty — rejects second BUY/SELL. */
	create(config: StrategyConfig): void {
		if (this.bySlot.has(config.slot)) {
			throw new Error(`slot ${config.slot} already exists — only one instance allowed`)
		}
		this.upsert(config)
	}

	pause(slot: StrategySlot): void {
		const c = this.require(slot)
		c.status = 'paused'
	}

	resume(slot: StrategySlot): void {
		const c = this.require(slot)
		if (c.status === 'completed') throw new Error(`${slot} is completed`)
		c.status = 'active'
	}

	private require(slot: StrategySlot): StrategyConfig {
		const c = this.bySlot.get(slot)
		if (!c) throw new Error(`slot ${slot} not found`)
		return c
	}
}
