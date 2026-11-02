import { ClmmStateCache } from '@/poolQuote/pricing/state/ClmmStateCache'

export class TurbosStateLoader {
	constructor(private readonly _cache: ClmmStateCache) {}

	async load(_poolId: string): Promise<void> {
		throw new Error('TurbosStateLoader: use pool-quote bundle in production')
	}
}
