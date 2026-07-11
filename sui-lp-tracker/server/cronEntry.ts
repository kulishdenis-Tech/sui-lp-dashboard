import './esbuild-env-setup.ts'
import { loadPortfolioSnapshotForAddress } from '../src/services/server/loadPortfolioSnapshot.ts'

export async function runPortfolioSnapshotForWallet(wallet: string) {
	return loadPortfolioSnapshotForAddress(wallet)
}
