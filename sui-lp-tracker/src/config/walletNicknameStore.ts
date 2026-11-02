import { useSyncExternalStore } from 'react'
import {
	isMonitoredWallet,
	normalizeNickname,
	resolveNicknames,
	walletsFromPayload,
	type WalletNickname,
} from '@/config/walletNicknames'
import { shortAddress } from '@/utils/formatting'

let rows: readonly WalletNickname[] = resolveNicknames(null)
let revision = 0
let started = false
const listeners = new Set<() => void>()

function emit(): void {
	for (const listener of listeners) listener()
}

async function refreshWalletNicknames(): Promise<void> {
	const seen = revision
	try {
		const res = await fetch('/api/wallet-nicknames', { cache: 'no-store' })
		if (!res.ok) return
		const data = (await res.json()) as { wallets?: unknown }
		if (revision !== seen) return
		const next = walletsFromPayload(data.wallets)
		if (!next) return
		rows = next
		emit()
	} catch {
		// Keep the seed names when this dashboard process is briefly unreachable.
	}
}

function ensureLoaded(): void {
	if (started || typeof window === 'undefined') return
	started = true
	void refreshWalletNicknames()
	window.setInterval(() => {
		if (document.visibilityState === 'visible') void refreshWalletNicknames()
	}, 8000)
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') void refreshWalletNicknames()
	})
}

export function subscribeWalletNicknames(listener: () => void): () => void {
	listeners.add(listener)
	ensureLoaded()
	return () => listeners.delete(listener)
}

export function getWalletNicknames(): readonly WalletNickname[] {
	return rows
}

export async function saveWalletNickname(address: string, nickname: string): Promise<void> {
	const key = address.trim().toLowerCase()
	const name = normalizeNickname(nickname)
	if (!isMonitoredWallet(key) || !name) throw new Error('invalid nickname')
	revision += 1
	const mine = revision
	const prev = rows
	const overrides = Object.fromEntries(rows.map((row) => [row.address, row.nickname]))
	overrides[key] = name
	rows = resolveNicknames(overrides)
	emit()
	try {
		const res = await fetch('/api/wallet-nicknames', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ address: key, nickname: name }),
		})
		if (revision !== mine) return
		if (!res.ok) throw new Error('save failed')
		const data = (await res.json()) as { wallets?: unknown }
		const next = walletsFromPayload(data.wallets)
		if (next) {
			rows = next
			emit()
		}
	} catch (error) {
		if (revision === mine) {
			rows = prev
			emit()
		}
		throw error
	}
}

export function useWalletNicknames(): {
	wallets: readonly WalletNickname[]
	save: typeof saveWalletNickname
	nameFor: (address: string | null | undefined) => string | null
} {
	const wallets = useSyncExternalStore(subscribeWalletNicknames, getWalletNicknames, getWalletNicknames)
	return {
		wallets,
		save: saveWalletNickname,
		nameFor(address) {
			if (!address) return null
			const key = address.trim().toLowerCase()
			return wallets.find((row) => row.address === key)?.nickname ?? null
		},
	}
}

/** Nickname when this address is one of the two monitored accounts, otherwise the short address. */
export function useWalletLabel(
	address: string | null | undefined,
	start = 6,
	end = 4,
): { label: string; title?: string } {
	const { nameFor } = useWalletNicknames()
	if (!address) return { label: '' }
	const nickname = nameFor(address)
	const tail = shortAddress(address, start, end)
	if (!nickname) return { label: tail }
	return { label: nickname, title: tail }
}
