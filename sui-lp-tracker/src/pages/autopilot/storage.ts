import type { HistoryEntry, ProtocolId, SavedConfiguration } from './types'

const CONFIG_KEY = 'sui-lp-autopilot.configs.v1'
const HISTORY_KEY = 'sui-lp-autopilot.history.v1'
const SETTINGS_KEY = 'sui-lp-autopilot.settings.v1'

/** Supported Build draft schema. Older drafts remain listed; load may warn. */
export const BUILD_DRAFT_SCHEMA_VERSION = 1

export type AppSettings = {
	rpcNote: string
	maxHardBuy: number | null
	maxHardSell: number | null
	theme: 'dark' | 'light'
}

export type DraftLoadIssue =
	| { ok: true; protocol: ProtocolId; schemaVersion: number }
	| { ok: false; reason: string; keep: true }

/** Validate named draft payload without deleting it. */
export function inspectDraftPayload(cfg: SavedConfiguration): DraftLoadIssue {
	const payload = cfg.payload as {
		schemaVersion?: number
		protocol?: string
		network?: string
		snapshot?: unknown
	} | null
	if (!payload || typeof payload !== 'object') {
		return { ok: false, reason: 'Missing draft payload', keep: true }
	}
	const schemaVersion =
		typeof payload.schemaVersion === 'number' ? payload.schemaVersion : 0
	if (schemaVersion > BUILD_DRAFT_SCHEMA_VERSION) {
		return {
			ok: false,
			reason: `Draft schema v${schemaVersion} is newer than this app (v${BUILD_DRAFT_SCHEMA_VERSION})`,
			keep: true,
		}
	}
	const protocol = payload.protocol
	if (protocol !== 'clmm' && protocol !== 'dlmm' && protocol !== 'bluefin') {
		return { ok: false, reason: 'Unknown or missing protocol in draft', keep: true }
	}
	if (payload.network != null && payload.network !== 'mainnet') {
		return { ok: false, reason: `Unsupported network “${payload.network}”`, keep: true }
	}
	return { ok: true, protocol, schemaVersion }
}

export function loadConfigs(): SavedConfiguration[] {
	try {
		const raw = localStorage.getItem(CONFIG_KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw) as SavedConfiguration[]
		// Keep all named drafts — never silently drop unknown schema/protocol.
		return Array.isArray(parsed) ? parsed.filter((c) => c && c.onChain === false) : []
	} catch {
		return []
	}
}

export function saveConfig(config: SavedConfiguration): void {
	const all = loadConfigs().filter((c) => c.id !== config.id)
	all.unshift(config)
	localStorage.setItem(CONFIG_KEY, JSON.stringify(all.slice(0, 50)))
}

export function deleteConfig(id: string): void {
	localStorage.setItem(CONFIG_KEY, JSON.stringify(loadConfigs().filter((c) => c.id !== id)))
}

export function renameConfig(id: string, name: string): SavedConfiguration | null {
	const label = name.trim().slice(0, 80)
	if (!label) return null
	const all = loadConfigs()
	const idx = all.findIndex((c) => c.id === id)
	if (idx < 0) return null
	const next = { ...all[idx]!, name: label }
	all[idx] = next
	localStorage.setItem(CONFIG_KEY, JSON.stringify(all))
	return next
}

export function loadHistory(): HistoryEntry[] {
	try {
		const raw = localStorage.getItem(HISTORY_KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw) as HistoryEntry[]
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

export function appendHistory(entry: HistoryEntry): void {
	const all = [entry, ...loadHistory()].slice(0, 100)
	localStorage.setItem(HISTORY_KEY, JSON.stringify(all))
}

export function loadSettings(): AppSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY)
		if (!raw) {
			return { rpcNote: 'https://fullnode.mainnet.sui.io:443', maxHardBuy: null, maxHardSell: null, theme: 'dark' }
		}
		const parsed = JSON.parse(raw) as Partial<AppSettings>
		return {
			rpcNote: parsed.rpcNote ?? 'https://fullnode.mainnet.sui.io:443',
			maxHardBuy: parsed.maxHardBuy ?? null,
			maxHardSell: parsed.maxHardSell ?? null,
			theme: parsed.theme === 'light' ? 'light' : 'dark',
		}
	} catch {
		return { rpcNote: 'https://fullnode.mainnet.sui.io:443', maxHardBuy: null, maxHardSell: null, theme: 'dark' }
	}
}

export function saveSettings(settings: AppSettings): void {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
