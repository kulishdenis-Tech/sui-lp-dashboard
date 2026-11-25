import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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

const dirs: string[] = []

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('wallet nicknames', () => {
	it('resolveNicknames follows WATCH_WALLET_SEED (env-only; empty when unset)', () => {
		const rows = resolveNicknames(null)
		expect(rows.map((row) => row.address)).toEqual([...WATCH_WALLET_SEED])
		if (WATCH_WALLET_SEED.length >= 2) {
			expect(rows.map((row) => row.nickname)).toEqual(['Slush', 'OKX'])
		} else {
			expect(rows).toEqual([])
		}
	})

	it('keeps a saved name and ignores an unknown address or a blank one', () => {
		if (WATCH_WALLET_SEED.length < 2) {
			expect(resolveNicknames({ '0xabc': 'Desk' })).toEqual([])
			return
		}
		const [first, second] = resolveNicknames(null)
		expect(first).toBeTruthy()
		expect(second).toBeTruthy()
		const rows = resolveNicknames({
			[first!.address]: 'Desk',
			[second!.address]: '   ',
			'0xdead': 'Nope',
		})
		expect(rows.find((r) => r.address === first!.address)?.nickname).toBe('Desk')
		expect(rows.find((r) => r.address === second!.address)?.nickname).toBe('OKX')
	})

	it('normalizeNickname rejects addresses and blanks', () => {
		expect(normalizeNickname('')).toBeNull()
		expect(normalizeNickname('0xabc')).toBeNull()
		expect(normalizeNickname('Desk')).toBe('Desk')
	})

	it('walletsFromPayload keeps only monitored accounts', () => {
		if (WATCH_WALLET_SEED.length < 1) {
			expect(walletsFromPayload([{ address: '0x1', nickname: 'X' }])).toEqual([])
			return
		}
		const addr = WATCH_WALLET_SEED[0]!
		const rows = walletsFromPayload([{ address: addr, nickname: 'Lab' }, { address: '0xnope', nickname: 'X' }])
		expect(rows?.map((r) => r.address)).toEqual([addr])
		expect(rows?.[0]?.nickname).toBe('Lab')
	})

	it('reads and writes nickname overrides file for monitored wallets', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'nick-'))
		dirs.push(dir)
		const file = nicknameFilePath(dir)
		if (WATCH_WALLET_SEED.length === 0) {
			writeNicknameOverrides(file, { '0xabc': 'A' })
			// Without env watch list, non-monitored overrides are dropped.
			expect(readNicknameOverrides(file)).toEqual({})
			return
		}
		const addr = WATCH_WALLET_SEED[0]!
		writeNicknameOverrides(file, { [addr]: 'Lab' })
		expect(readFileSync(file, 'utf8')).toContain(addr)
		expect(readNicknameOverrides(file)).toEqual({ [addr]: 'Lab' })
	})
})
