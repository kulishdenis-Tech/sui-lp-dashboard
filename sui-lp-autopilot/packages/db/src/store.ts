import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import {
	normalizeAutoWithdrawRule,
	type AutoWithdrawRule,
	type RuntimeMode,
	type StrategyConfig,
	type StrategySlot,
} from '@autopilot/engine'

/**
 * On-chain positionId bound to a strategy level.
 * `binding: 'confirmed'` is set only from a successful settlement whose created
 * position ids line up with a stored open intent. A geometry overlap is not a binding.
 */
export type PositionMapEntry = {
	strategySlot: StrategySlot
	levelId: string
	poolId: string
	protocol: string
	network: string
	binding?: 'confirmed'
	digest?: string
}

export type OpenIntentStatus = 'awaiting_settlement' | 'confirmed' | 'incomplete'

/** Server-side open intent. Incomplete means the digest did not prove the binding. It is not a closed level. */
export type OpenIntent = {
	id: number
	slot: StrategySlot
	levelIds: string[]
	poolId: string
	protocol: string
	network: string
	digest: string
	status: OpenIntentStatus
}

export type OperationRow = {
	id: number
	slot: StrategySlot
	kind: string
	status: 'pending' | 'submitted' | 'finalized' | 'failed'
	digest: string | null
	request: unknown
	result: unknown
	error: string | null
	createdAt: string
	finalizedAt: string | null
}

type DbShape = {
	strategies: Partial<Record<StrategySlot, StrategyConfig>>
	operations: OperationRow[]
	settings: Record<string, string>
	nextOpId: number
	/** Maps on-chain positionId → strategy level. Confirmed entries carry binding + digest. */
	positionMap: Record<string, PositionMapEntry>
	openIntents: OpenIntent[]
	nextIntentId: number
	/** Auto Withdraw monitoring rules (no unattended sign). Keyed by positionId in upsert. */
	autoWithdrawRules: AutoWithdrawRule[]
	/** Last successful Auto Withdraw monitor tick (ms). */
	autoWithdrawLastCheckMs: number | null
}

const EMPTY: DbShape = {
	strategies: {},
	operations: [],
	settings: {
		runtime_mode: 'MONITOR_ONLY',
		emergency_stop: '0',
	},
	nextOpId: 1,
	positionMap: {},
	openIntents: [],
	nextIntentId: 1,
	autoWithdrawRules: [],
	autoWithdrawLastCheckMs: null,
}

/** File-backed store with unique BUY/SELL slots (SQL schema in migrations/ for Postgres later). */
/**
 * Live bot store is the JSON file under packages/bot/data.
 * packages/db/migrations/*.sql is not the runtime database while one operator
 * stays on MONITOR_ONLY. sui-lp-autopilot/data/autopilot.db.json is an empty stub.
 */
export function isEmptyStubDbPath(absPath: string): boolean {
	const norm = absPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
	return /\/sui-lp-autopilot\/data\/autopilot\.db\.json$/.test(norm)
}

export class AutopilotStore {
	constructor(private readonly path: string) {}

	private read(): DbShape {
		if (!existsSync(this.path)) return structuredClone(EMPTY)
		const raw = readFileSync(this.path, 'utf8')
		const parsed = JSON.parse(raw) as DbShape
		return {
			...structuredClone(EMPTY),
			...parsed,
			openIntents: parsed.openIntents ?? [],
			nextIntentId: parsed.nextIntentId ?? 1,
			positionMap: parsed.positionMap ?? {},
			autoWithdrawRules: parsed.autoWithdrawRules ?? [],
			autoWithdrawLastCheckMs: parsed.autoWithdrawLastCheckMs ?? null,
		}
	}

	private write(data: DbShape): void {
		mkdirSync(dirname(this.path), { recursive: true })
		const tmp = `${this.path}.tmp`
		writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
		renameSync(tmp, this.path)
	}

	getMode(): RuntimeMode {
		return (this.read().settings.runtime_mode as RuntimeMode) ?? 'MONITOR_ONLY'
	}

	setMode(mode: RuntimeMode): void {
		const db = this.read()
		db.settings.runtime_mode = mode
		this.write(db)
	}

	isEmergencyStop(): boolean {
		return this.read().settings.emergency_stop === '1'
	}

	setEmergencyStop(on: boolean): void {
		const db = this.read()
		db.settings.emergency_stop = on ? '1' : '0'
		this.write(db)
	}

	getStrategy(slot: StrategySlot): StrategyConfig | undefined {
		return this.read().strategies[slot]
	}

	listStrategies(): StrategyConfig[] {
		const s = this.read().strategies
		return [s.BUY, s.SELL].filter(Boolean) as StrategyConfig[]
	}

	/** Insert-only — rejects second instance of same slot. */
	createStrategy(config: StrategyConfig): void {
		const db = this.read()
		if (db.strategies[config.slot]) {
			throw new Error(`slot ${config.slot} already exists`)
		}
		db.strategies[config.slot] = config
		this.write(db)
	}

	updateStrategy(config: StrategyConfig): void {
		const db = this.read()
		if (!db.strategies[config.slot]) throw new Error(`slot ${config.slot} missing`)
		db.strategies[config.slot] = config
		this.write(db)
	}

	beginOperation(slot: StrategySlot, kind: string, request: unknown): OperationRow {
		const db = this.read()
		const row: OperationRow = {
			id: db.nextOpId++,
			slot,
			kind,
			status: 'pending',
			digest: null,
			request,
			result: null,
			error: null,
			createdAt: new Date().toISOString(),
			finalizedAt: null,
		}
		db.operations.push(row)
		this.write(db)
		return row
	}

	/** Idempotency: if digest already finalized, return existing. */
	attachDigest(id: number, digest: string): OperationRow {
		const db = this.read()
		const existing = db.operations.find((o) => o.digest === digest)
		if (existing) return existing
		const row = db.operations.find((o) => o.id === id)
		if (!row) throw new Error(`operation ${id} not found`)
		row.digest = digest
		row.status = 'submitted'
		this.write(db)
		return row
	}

	finalizeOperation(id: number, result: unknown, error?: string): void {
		const db = this.read()
		const row = db.operations.find((o) => o.id === id)
		if (!row) throw new Error(`operation ${id} not found`)
		row.result = result ?? null
		row.error = error ?? null
		row.status = error ? 'failed' : 'finalized'
		row.finalizedAt = new Date().toISOString()
		this.write(db)
	}

	pendingUnfinalized(): OperationRow[] {
		return this.read().operations.filter((o) => o.status === 'pending' || o.status === 'submitted')
	}

	// ─── Position map ────────────────────────────────────────────────────────

	getPositionMapping(positionId: string): PositionMapEntry | undefined {
		return this.read().positionMap[positionId]
	}

	setPositionMapping(positionId: string, entry: PositionMapEntry): void {
		const db = this.read()
		db.positionMap[positionId] = entry
		this.write(db)
	}

	deletePositionMapping(positionId: string): void {
		const db = this.read()
		delete db.positionMap[positionId]
		this.write(db)
	}

	/** Operations whose createdAt falls on the current UTC day. Server-owned counter. */
	countOpsToday(now = new Date()): number {
		const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
		return this.read().operations.filter((o) => {
			const t = Date.parse(o.createdAt)
			return Number.isFinite(t) && t >= start
		}).length
	}

	/** Returns all entries as an array with the positionId included. */
	listPositionMappings(): Array<{ positionId: string } & PositionMapEntry> {
		const map = this.read().positionMap
		return Object.entries(map).map(([positionId, entry]) => ({ positionId, ...entry }))
	}

	recordOpenIntent(input: Omit<OpenIntent, 'id' | 'status'>): OpenIntent {
		const db = this.read()
		const row: OpenIntent = {
			id: db.nextIntentId++,
			status: 'awaiting_settlement',
			slot: input.slot,
			levelIds: [...input.levelIds],
			poolId: input.poolId,
			protocol: input.protocol,
			network: input.network,
			digest: input.digest,
		}
		db.openIntents.push(row)
		this.write(db)
		return row
	}

	listOpenIntents(): OpenIntent[] {
		return this.read().openIntents ?? []
	}

	setOpenIntentStatus(id: number, status: OpenIntentStatus): void {
		const db = this.read()
		const row = db.openIntents.find((intent) => intent.id === id)
		if (!row) throw new Error(`open intent ${id} not found`)
		row.status = status
		this.write(db)
	}

	// ─── Auto Withdraw (monitor only — never signs) ──────────────────────────

	listAutoWithdrawRules(): AutoWithdrawRule[] {
		return (this.read().autoWithdrawRules ?? []).map(normalizeAutoWithdrawRule)
	}

	getAutoWithdrawRule(positionId: string): AutoWithdrawRule | undefined {
		const id = positionId.toLowerCase()
		return this.listAutoWithdrawRules().find((r) => r.positionId.toLowerCase() === id)
	}

	/**
	 * Upsert by positionId. Validates required fields; does not trust client success claims.
	 * Bumps revision on every write. HTTP callers must authenticate as rule.owner.
	 */
	upsertAutoWithdrawRule(rule: AutoWithdrawRule): AutoWithdrawRule {
		if (!rule.positionId || !rule.poolId || !rule.owner) {
			throw new Error('auto withdraw rule requires owner, poolId, positionId')
		}
		if (rule.direction !== 'down' && rule.direction !== 'up') {
			throw new Error('direction must be down or up')
		}
		if (!['clmm', 'dlmm', 'bluefin'].includes(rule.protocol)) {
			throw new Error('protocol must be clmm, dlmm, or bluefin')
		}
		if (rule.network !== 'mainnet' && rule.network !== 'testnet') {
			throw new Error('network must be mainnet or testnet')
		}
		const db = this.read()
		const rules = db.autoWithdrawRules ?? []
		const i = rules.findIndex((r) => r.positionId.toLowerCase() === rule.positionId.toLowerCase())
		const prev = i >= 0 ? normalizeAutoWithdrawRule(rules[i]!) : null
		const base = normalizeAutoWithdrawRule(rule)
		const next: AutoWithdrawRule = {
			...base,
			revision: (prev?.revision ?? 0) + 1,
			updatedAtMs: Date.now(),
		}
		if (i >= 0) rules[i] = next
		else rules.unshift(next)
		db.autoWithdrawRules = rules.slice(0, 500)
		this.write(db)
		return next
	}

	/**
	 * Compare-and-set for monitor ticks. Returns null when cycle/revision/enabled no longer match
	 * (Disable, Stop, direction change, or a newer client write won).
	 */
	casUpdateAutoWithdrawRule(
		positionId: string,
		expected: Pick<AutoWithdrawRule, 'cycleId' | 'revision' | 'enabled'>,
		updater: (current: AutoWithdrawRule) => AutoWithdrawRule | null,
	): AutoWithdrawRule | null {
		const db = this.read()
		const rules = db.autoWithdrawRules ?? []
		const i = rules.findIndex((r) => r.positionId.toLowerCase() === positionId.toLowerCase())
		if (i < 0) return null
		const current = normalizeAutoWithdrawRule(rules[i]!)
		if (
			current.cycleId !== expected.cycleId ||
			current.revision !== expected.revision ||
			current.enabled !== expected.enabled
		) {
			return null
		}
		const patched = updater(current)
		if (!patched) return null
		const next = normalizeAutoWithdrawRule({
			...patched,
			positionId: current.positionId,
			updatedAtMs: Date.now(),
		})
		rules[i] = next
		db.autoWithdrawRules = rules
		this.write(db)
		return next
	}

	/** Service heartbeat only — must not touch per-position lastSuccessfulCheckAtMs. */
	touchAutoWithdrawCheck(now = Date.now()): void {
		const db = this.read()
		db.autoWithdrawLastCheckMs = now
		this.write(db)
	}

	getAutoWithdrawLastCheckMs(): number | null {
		return this.read().autoWithdrawLastCheckMs ?? null
	}
}
