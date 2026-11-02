import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isMonitoredWallet, normalizeNickname, resolveNicknames } from '../../src/config/walletNicknames.js'

/**
 * Shared nicknames for every browser that opens this dashboard process.
 * localhost and the phone hostname are different origins, so the file —
 * not localStorage — is the copy both of them read. `_local/` stays untracked.
 */
export function nicknameFilePath(start = process.cwd()): string {
	let dir = path.resolve(start)
	for (let i = 0; i < 6; i++) {
		const trackerPkg = path.join(dir, 'sui-lp-tracker', 'package.json')
		const rootPkg = path.join(dir, 'package.json')
		if (existsSync(trackerPkg) && existsSync(rootPkg)) {
			return path.join(dir, '_local', 'wallet-nicknames.json')
		}
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return path.resolve(start, '../_local/wallet-nicknames.json')
}

export function readNicknameOverrides(file: string): Record<string, string> {
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
		const out: Record<string, string> = {}
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value !== 'string') continue
			const address = key.trim().toLowerCase()
			if (!isMonitoredWallet(address)) continue
			const name = normalizeNickname(value)
			if (name) out[address] = name
		}
		return out
	} catch {
		return {}
	}
}

export function writeNicknameOverrides(file: string, overrides: Record<string, string>): void {
	const clean = Object.fromEntries(resolveNicknames(overrides).map((row) => [row.address, row.nickname]))
	mkdirSync(path.dirname(file), { recursive: true })
	const tmp = `${file}.${process.pid}.tmp`
	writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
	renameSync(tmp, file)
}
