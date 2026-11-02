import {
	listBluefinOwnerPositions,
	listBluefinSuiUsdcPools,
	readBluefinPool,
} from '../readBluefinPools.js'
import type { LiquidityProvider } from './types.js'

export const bluefinProvider: LiquidityProvider = {
	protocol: 'bluefin',
	listPools: (maxPages = 4) => listBluefinSuiUsdcPools(maxPages),
	readPool: (poolId) => readBluefinPool(poolId),
	listOwnerPositions: (owner) => listBluefinOwnerPositions(owner),
}
