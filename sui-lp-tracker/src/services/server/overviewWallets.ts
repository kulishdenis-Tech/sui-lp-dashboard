import { existsSync, readFileSync } from 'node:fs'
import { WATCH_WALLET_SEED } from '@/config/watchWallets'
import { overviewCachePath } from '@/services/server/overviewCache'

function parseAddressList(raw: string | undefined): string[] {
	if (!raw) return []
	return raw
		.split(/[,;\s]+/)
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.startsWith('0x') && s.length >= 66)
}

function nicknamesPath(): string {
	return overviewCachePath().replace(/overview-cache\.json$/, 'wallet-nicknames.json')
}

function addressesFromNicknamesFile(): string[] {
	const file = nicknamesPath()
	if (!existsSync(file)) return []
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
		return Object.keys(parsed)
			.map((k) => k.trim().toLowerCase())
			.filter((s) => s.startsWith('0x') && s.length >= 66)
	} catch {
		return []
	}
}

/**
 * Addresses the overview worker should refresh.
 * Prefer WORKER_ADDRESSES; else nicknames file keys; else the monitored seed.
 */
export function resolveWorkerAddresses(env: NodeJS.ProcessEnv = process.env): string[] {
	const fromEnv = parseAddressList(env.WORKER_ADDRESSES)
	if (fromEnv.length > 0) return [...new Set(fromEnv)]

	const fromFile = addressesFromNicknamesFile()
	if (fromFile.length > 0) return [...new Set(fromFile)]

	return [...WATCH_WALLET_SEED]
}
