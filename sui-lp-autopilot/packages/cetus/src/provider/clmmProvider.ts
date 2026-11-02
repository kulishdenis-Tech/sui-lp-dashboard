import { listClmmOwnerPositions, listClmmSuiUsdcPools, readClmmPool } from '../readClmmPools.js'
import type { LiquidityProvider } from './types.js'

export const cetusClmmProvider: LiquidityProvider = {
	protocol: 'clmm',
	listPools: (maxPages = 4) => listClmmSuiUsdcPools(maxPages),
	readPool: (poolId) => readClmmPool(poolId),
	listOwnerPositions: (owner) => listClmmOwnerPositions(owner),
}
