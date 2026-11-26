import {
	invalidateBluefinMomentumScanCache,
	scanBluefinWalletAllPositionEvents,
	scanMomentumWalletAllPositionEvents,
	type BluefinWalletRawEvt,
	type MomentumWalletRawEvt,
} from '@/services/eventParser'
import { normalizeSuiAddress } from '@mysten/sui/utils'

export type LpWalletScanSession = {
	walletNorm: string
	bluefin: {
		rawByPositionId: Map<string, BluefinWalletRawEvt[]>
		historyPartial: boolean
	}
	momentum: {
		rawByPositionId: Map<string, MomentumWalletRawEvt[]>
		historyPartial: boolean
	}
}

let currentSession: LpWalletScanSession | null = null
let inflight: Promise<LpWalletScanSession> | null = null

function walletNormKey(wallet: string): string {
	try {
		return normalizeSuiAddress(wallet.trim())
	} catch {
		return wallet.trim()
	}
}

function emptyBluefinScan(): LpWalletScanSession['bluefin'] {
	return { rawByPositionId: new Map(), historyPartial: true }
}

function emptyMomentumScan(): LpWalletScanSession['momentum'] {
	return { rawByPositionId: new Map(), historyPartial: true }
}

/** Поточна сесія (після `ensureLpWalletScanSession`). */
export function getLpWalletScanSession(): LpWalletScanSession | null {
	return currentSession
}

export function clearLpWalletScanSession(): void {
	currentSession = null
	inflight = null
}

export function invalidateLpWalletScanSession(wallet: string): void {
	const k = walletNormKey(wallet)
	if (currentSession?.walletNorm === k) clearLpWalletScanSession()
	invalidateBluefinMomentumScanCache(wallet)
}

/**
 * Один cold/warm scan Bluefin + Momentum raw events на `loadAll` / Refresh.
 * Ніколи не кидає — при RPC/мережевій помилці повертає порожню сесію (enrichment має fallback).
 */
export async function ensureLpWalletScanSession(
	wallet: string,
	options?: { forceRefresh?: boolean },
): Promise<LpWalletScanSession> {
	const norm = walletNormKey(wallet)
	if (options?.forceRefresh) {
		invalidateLpWalletScanSession(wallet)
	}

	if (!options?.forceRefresh && currentSession?.walletNorm === norm) {
		return currentSession
	}

	if (!options?.forceRefresh && inflight) {
		const s = await inflight
		if (s.walletNorm === norm) return s
	}

	inflight = (async () => {
		// Parallel BF+MMT — shared Sender page cache + typed GraphQL concurrency cut wall time ~2×.
		const [bluefinSettled, momentumSettled] = await Promise.allSettled([
			scanBluefinWalletAllPositionEvents(wallet),
			scanMomentumWalletAllPositionEvents(wallet),
		])
		let bluefin = emptyBluefinScan()
		let momentum = emptyMomentumScan()
		if (bluefinSettled.status === 'fulfilled') {
			bluefin = bluefinSettled.value
		} else {
			console.warn(
				'[lpScanSession] Bluefin wallet scan failed — continuing with empty raw',
				bluefinSettled.reason,
			)
		}
		if (momentumSettled.status === 'fulfilled') {
			momentum = momentumSettled.value
		} else {
			console.warn(
				'[lpScanSession] Momentum wallet scan failed — continuing with empty raw',
				momentumSettled.reason,
			)
		}
		const session: LpWalletScanSession = {
			walletNorm: norm,
			bluefin,
			momentum,
		}
		currentSession = session
		return session
	})()

	try {
		return await inflight
	} finally {
		inflight = null
	}
}
