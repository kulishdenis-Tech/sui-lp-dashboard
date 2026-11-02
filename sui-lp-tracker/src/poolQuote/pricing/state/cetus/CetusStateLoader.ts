import { ClmmStateCache } from '@/poolQuote/pricing/state/ClmmStateCache'

export class CetusStateLoader {
	constructor(private readonly _cache: ClmmStateCache) {}

	async load(_poolId: string): Promise<void> {
		throw new Error('CetusStateLoader: use pool-quote bundle in production')
	}
}
