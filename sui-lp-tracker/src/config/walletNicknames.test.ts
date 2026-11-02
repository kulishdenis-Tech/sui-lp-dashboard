import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { WATCH_WALLET_SEED } from '@/config/watchWallets'
import {
	normalizeNickname,
	resolveNicknames,
	walletsFromPayload,
} from '@/config/walletNicknames'
import {
	nicknameFilePath,
	readNicknameOverrides,
	writeNicknameOverrides,
} from '../../api/_lib/walletNicknameFile.ts'

const trackerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dirs: string[] = []

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('wallet nicknames', () => {
	it('seeds Slush for the 8da6 account and OKX for the other', () => {
		const rows = resolveNicknames(null)
		expect(rows.map((row) => row.address)).toEqual([...WATCH_WALLET_SEED])
		expect(rows.map((row) => row.nickname)).toEqual(['Slush', 'OKX'])
		expect(rows[0]?.address.endsWith('8da6')).toBe(true)
		expect(rows[1]?.address.endsWith('44b9')).toBe(true)
	})

	it('keeps a saved name and ignores an unknown address or a blank one', () => {
		const [first, second] = resolveNicknames(null)
		expect(first).toBeTruthy()
		expect(second).toBeTruthy()
		const rows = resolveNicknames({
			[first!.address]: 'Desk',
			[second!.address]: '   ',
			'0xnot-a-wallet': 'Nope',
		})
		expect(rows.map((row) => row.nickname)).toEqual(['Desk', 'OKX'])
		expect(normalizeNickname('0x925e')).toBeNull()
		expect(normalizeNickname('a'.repeat(25))).toBeNull()
		expect(normalizeNickname('OKX 2')).toBe('OKX 2')
	})

	it('fills a partial payload back to the two seed names', () => {
		const [first] = resolveNicknames(null)
		const rows = walletsFromPayload([{ address: first!.address, nickname: 'Desk' }, { address: 'nope' }])
		expect(rows?.map((row) => row.nickname)).toEqual(['Desk', 'OKX'])
		expect(walletsFromPayload({ wallets: [] })).toBeNull()
	})

	it('round-trips the two names through the shared file', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'wallet-nicknames-'))
		dirs.push(dir)
		const file = path.join(dir, 'wallet-nicknames.json')
		const [first] = resolveNicknames(null)
		writeNicknameOverrides(file, { [first!.address]: 'Desk' })
		expect(readNicknameOverrides(file)[first!.address]).toBe('Desk')
		const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
		expect(Object.keys(stored)).toHaveLength(2)
		expect(stored[first!.address]).toBe('Desk')
		expect(nicknameFilePath(trackerRoot).replace(/\\/g, '/')).toMatch(/\/_local\/wallet-nicknames\.json$/)
	})
})
