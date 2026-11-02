/**
 * Client persistence for Auto Withdraw rules.
 * Server is source of truth when synced. LocalStorage is draft/cache only.
 * Never stores keys. Never claims unattended execution.
 */
import type { AutoWithdrawRule } from '@autopilot/engine'
import {
	AUTO_WITHDRAW_EXECUTION_MODE,
	AW_DEFAULT_EXECUTION_PERMISSION,
	disableBeforeSubmit,
	normalizeAutoWithdrawRule,
	newCycleId,
	newRuleId,
} from '@autopilot/engine'

const KEY = 'sui-lp-autopilot.auto-withdraw.v1'
const AUTH_KEY = 'sui-lp-autopilot.aw-auth.v1'
const SYNC_KEY = 'sui-lp-autopilot.auto-withdraw.synced.v1'

/** Per-position write generation — ignores stale GET/PUT after a newer local mutation. */
const writeGenByPos = new Map<string, number>()
const pendingWriteByPos = new Set<string>()

/** External-store version so table badges re-render when Watching changes (no cascade toggle needed). */
type AwRulesListener = () => void
const awRulesListeners = new Set<AwRulesListener>()
let awRulesVersion = 0

function notifyAutoWithdrawRulesChanged(): void {
	awRulesVersion += 1
	for (const listener of awRulesListeners) listener()
}

export function subscribeAutoWithdrawRules(listener: AwRulesListener): () => void {
	awRulesListeners.add(listener)
	return () => {
		awRulesListeners.delete(listener)
	}
}

export function getAutoWithdrawRulesVersion(): number {
	return awRulesVersion
}

export type PersistRuleResult = {
	ok: boolean
	rule: AutoWithdrawRule | null
	error?: string
	code?: string
	serverSynced: boolean
	/** True when a newer mutation superseded this response. */
	stale?: boolean
}

function posKey(positionId: string): string {
	return positionId.toLowerCase()
}

function bumpWriteGen(positionId: string): number {
	const id = posKey(positionId)
	const next = (writeGenByPos.get(id) ?? 0) + 1
	writeGenByPos.set(id, next)
	pendingWriteByPos.add(id)
	return next
}

function clearPendingWrite(positionId: string, gen: number): void {
	const id = posKey(positionId)
	if (writeGenByPos.get(id) === gen) pendingWriteByPos.delete(id)
}

function writeLocalRule(rule: AutoWithdrawRule): AutoWithdrawRule {
	const all = read().rules
	const next = normalizeAutoWithdrawRule({ ...rule, updatedAtMs: Date.now() })
	const i = all.findIndex((r) => r.positionId.toLowerCase() === next.positionId.toLowerCase())
	if (i >= 0) all[i] = next
	else all.unshift(next)
	write(all)
	return next
}

type StoreShape = {
	rules: AutoWithdrawRule[]
}

type AuthShape = {
	token: string
	address: string
	expiresAtMs: number
}

function read(): StoreShape {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return { rules: [] }
		const parsed = JSON.parse(raw) as StoreShape
		return {
			rules: Array.isArray(parsed.rules)
				? parsed.rules.map((r) => normalizeAutoWithdrawRule(r as AutoWithdrawRule))
				: [],
		}
	} catch {
		return { rules: [] }
	}
}

function write(rules: AutoWithdrawRule[]): void {
	localStorage.setItem(KEY, JSON.stringify({ rules: rules.slice(0, 200) }))
	notifyAutoWithdrawRulesChanged()
}

function readSyncedIds(): Set<string> {
	try {
		const raw = localStorage.getItem(SYNC_KEY)
		if (!raw) return new Set()
		const arr = JSON.parse(raw) as string[]
		return new Set(Array.isArray(arr) ? arr.map((s) => s.toLowerCase()) : [])
	} catch {
		return new Set()
	}
}

function writeSyncedIds(ids: Set<string>): void {
	localStorage.setItem(SYNC_KEY, JSON.stringify([...ids].slice(0, 500)))
}

export function isRuleServerSynced(positionId: string): boolean {
	return readSyncedIds().has(positionId.toLowerCase())
}

export function markRuleSynced(positionId: string, synced: boolean): void {
	const ids = readSyncedIds()
	const id = positionId.toLowerCase()
	if (synced) ids.add(id)
	else ids.delete(id)
	writeSyncedIds(ids)
	notifyAutoWithdrawRulesChanged()
}

export function listAutoWithdrawRules(): AutoWithdrawRule[] {
	return read().rules
}

export function getAutoWithdrawRule(positionId: string): AutoWithdrawRule | undefined {
	const id = positionId.toLowerCase()
	return read().rules.find((r) => r.positionId.toLowerCase() === id)
}

function readAuth(): AuthShape | null {
	try {
		const raw = sessionStorage.getItem(AUTH_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw) as AuthShape
		if (!parsed.token || !parsed.address || !(parsed.expiresAtMs > Date.now())) return null
		return parsed
	} catch {
		return null
	}
}

function writeAuth(auth: AuthShape | null): void {
	if (!auth) sessionStorage.removeItem(AUTH_KEY)
	else sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth))
}

export function getAwAuthToken(): string | null {
	return readAuth()?.token ?? null
}

export function getAwAuthAddress(): string | null {
	return readAuth()?.address ?? null
}

/** Clear local Bearer. Does not cancel already-signed chain transactions. */
export function clearAwAuth(): void {
	writeAuth(null)
}

/** Revoke server session + clear local Bearer (disconnect / account change). */
export async function revokeAwSession(): Promise<void> {
	const token = getAwAuthToken()
	writeAuth(null)
	if (!token) return
	try {
		await fetch('/api/autopilot/auth/session', {
			method: 'DELETE',
			headers: { authorization: `Bearer ${token}` },
		})
	} catch {
		/* offline — local clear is enough */
	}
}

export async function ensureAwAuth(address: string, signPersonalMessage: (args: {
	message: Uint8Array
}) => Promise<{ signature: string }>): Promise<string> {
	const existing = readAuth()
	if (existing && existing.address.toLowerCase() === address.toLowerCase()) {
		return existing.token
	}
	const nonceRes = await fetch(
		`/api/autopilot/auth/nonce?address=${encodeURIComponent(address)}`,
	)
	if (!nonceRes.ok) throw new Error('Could not start wallet authorization for Auto Withdraw.')
	const issued = (await nonceRes.json()) as { message: string; nonce: string; expiresAtMs: number }
	const signed = await signPersonalMessage({
		message: new TextEncoder().encode(issued.message),
	})
	const verifyRes = await fetch('/api/autopilot/auth/verify', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			address,
			nonce: issued.nonce,
			signature: signed.signature,
		}),
	})
	if (!verifyRes.ok) {
		const err = (await verifyRes.json().catch(() => null)) as { error?: string } | null
		throw new Error(err?.error ?? 'Wallet authorization failed.')
	}
	const session = (await verifyRes.json()) as {
		token: string
		address: string
		expiresAtMs: number
	}
	writeAuth(session)
	return session.token
}

/**
 * Local cache write + fire-and-forget sync (non-Manage paths, e.g. attempt phase).
 * Manage enable/disable must use {@link persistAutoWithdrawRule} instead.
 */
export function upsertAutoWithdrawRule(rule: AutoWithdrawRule): AutoWithdrawRule {
	const next = writeLocalRule(rule)
	markRuleSynced(next.positionId, false)
	void syncRuleToServer(next).catch(() => {
		/* bot may be offline — local draft remains; UI shows Not synced */
	})
	return next
}

/**
 * Server-confirmed persist. Awaits PUT; on failure reverts optimistic local change
 * and surfaces auth/network errors. Protects against stale GET/PUT races.
 */
export async function persistAutoWithdrawRule(rule: AutoWithdrawRule): Promise<PersistRuleResult> {
	const previous = getAutoWithdrawRule(rule.positionId) ?? null
	const prepared =
		previous && rule.enabled === false
			? disableBeforeSubmit({
					...previous,
					collectFeesWithWithdraw: rule.collectFeesWithWithdraw,
					direction: rule.direction,
					targetAsset: rule.targetAsset,
					directionSource: rule.directionSource,
				})
			: normalizeAutoWithdrawRule({ ...rule, updatedAtMs: Date.now() })

	const gen = bumpWriteGen(prepared.positionId)
	writeLocalRule(prepared)
	markRuleSynced(prepared.positionId, false)

	try {
		const token = getAwAuthToken()
		if (!token) {
			if (writeGenByPos.get(posKey(prepared.positionId)) === gen && previous) {
				writeLocalRule(previous)
			}
			clearPendingWrite(prepared.positionId, gen)
			return {
				ok: false,
				rule: getAutoWithdrawRule(prepared.positionId) ?? previous,
				error: 'Authorize the owner wallet to save Watching changes.',
				code: 'AUTH_REQUIRED',
				serverSynced: false,
			}
		}

		const r = await fetch('/api/autopilot/auto-withdraw', {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ rule: prepared }),
		})

		const body = (await r.json().catch(() => ({}))) as {
			rule?: AutoWithdrawRule
			error?: string
			code?: string
		}

		if (writeGenByPos.get(posKey(prepared.positionId)) !== gen) {
			clearPendingWrite(prepared.positionId, gen)
			return {
				ok: true,
				rule: getAutoWithdrawRule(prepared.positionId) ?? null,
				serverSynced: isRuleServerSynced(prepared.positionId),
				stale: true,
			}
		}

		if (r.status === 401 || body.code === 'AUTH_REQUIRED') {
			clearAwAuth()
			if (previous) writeLocalRule(previous)
			markRuleSynced(prepared.positionId, false)
			clearPendingWrite(prepared.positionId, gen)
			return {
				ok: false,
				rule: previous,
				error: 'Session expired. Sign again to save Watching changes.',
				code: 'AUTH_EXPIRED',
				serverSynced: false,
			}
		}

		if (!r.ok) {
			if (previous) writeLocalRule(previous)
			markRuleSynced(prepared.positionId, false)
			clearPendingWrite(prepared.positionId, gen)
			return {
				ok: false,
				rule: previous,
				error: body.error ?? `Could not save Watching (HTTP ${r.status}).`,
				code: body.code ?? `HTTP_${r.status}`,
				serverSynced: false,
			}
		}

		const saved = body.rule
			? normalizeAutoWithdrawRule(body.rule)
			: prepared
		writeLocalRule(saved)
		markRuleSynced(saved.positionId, true)
		clearPendingWrite(prepared.positionId, gen)
		return { ok: true, rule: saved, serverSynced: true }
	} catch (e) {
		if (writeGenByPos.get(posKey(prepared.positionId)) === gen) {
			if (previous) writeLocalRule(previous)
			markRuleSynced(prepared.positionId, false)
			clearPendingWrite(prepared.positionId, gen)
		}
		return {
			ok: false,
			rule: previous,
			error:
				e instanceof Error
					? e.message
					: 'Network error while saving Watching. Changes were not confirmed on the server.',
			code: 'NETWORK',
			serverSynced: false,
		}
	}
}

export function applyServerRules(rules: AutoWithdrawRule[]): void {
	const byId = new Map(read().rules.map((r) => [r.positionId.toLowerCase(), r]))
	const synced = readSyncedIds()
	for (const raw of rules) {
		const rule = normalizeAutoWithdrawRule(raw)
		const id = rule.positionId.toLowerCase()
		/* Do not clobber an in-flight or newer unconfirmed local mutation. */
		if (pendingWriteByPos.has(id)) continue
		byId.set(id, rule)
		synced.add(id)
	}
	write([...byId.values()])
	writeSyncedIds(synced)
}

/** Test helper — reset write-generation guards between cases. */
export function _resetAwWriteGuardsForTests(): void {
	writeGenByPos.clear()
	pendingWriteByPos.clear()
}

export function removeAutoWithdrawRule(positionId: string): void {
	write(read().rules.filter((r) => r.positionId.toLowerCase() !== positionId.toLowerCase()))
	markRuleSynced(positionId, false)
}

/** Background sync for non-Manage writers. Skips apply when a confirmed persist is in flight. */
export async function syncRuleToServer(rule: AutoWithdrawRule): Promise<boolean> {
	const id = posKey(rule.positionId)
	if (pendingWriteByPos.has(id)) return false
	try {
		const token = getAwAuthToken()
		if (!token) {
			markRuleSynced(rule.positionId, false)
			return false
		}
		const r = await fetch('/api/autopilot/auto-withdraw', {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ rule }),
		})
		if (!r.ok) {
			markRuleSynced(rule.positionId, false)
			return false
		}
		if (pendingWriteByPos.has(id)) return false
		const body = (await r.json()) as { rule?: AutoWithdrawRule }
		if (body.rule) {
			writeLocalRule(normalizeAutoWithdrawRule(body.rule))
			markRuleSynced(rule.positionId, true)
		} else {
			markRuleSynced(rule.positionId, true)
		}
		return true
	} catch {
		markRuleSynced(rule.positionId, false)
		return false
	}
}

export async function fetchServerRules(owner: string): Promise<AutoWithdrawRule[] | null> {
	try {
		const r = await fetch(`/api/autopilot/auto-withdraw?owner=${encodeURIComponent(owner)}`)
		if (!r.ok) return null
		const body = (await r.json()) as { rules?: AutoWithdrawRule[] }
		const rules = Array.isArray(body.rules) ? body.rules.map(normalizeAutoWithdrawRule) : []
		applyServerRules(rules)
		return rules
	} catch {
		return null
	}
}

export async function fetchServerHeartbeat(): Promise<{
	ok: boolean
	lastCheckedAtMs: number | null
	executionMode: string
	service?: string
} | null> {
	try {
		const r = await fetch('/api/autopilot/auto-withdraw/status')
		if (!r.ok) return null
		return (await r.json()) as {
			ok: boolean
			lastCheckedAtMs: number | null
			executionMode: string
			service?: string
		}
	} catch {
		return null
	}
}

export async function reviewWithdrawAllOnServer(rule: AutoWithdrawRule): Promise<{
	ok: boolean
	message?: string
	preview?: Record<string, unknown>
	unsignedTx?: unknown
	rule?: AutoWithdrawRule
}> {
	const token = getAwAuthToken()
	if (!token) return { ok: false, message: 'Authorize the owner wallet to review Withdraw All.' }
	const r = await fetch('/api/autopilot/auto-withdraw/review', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			positionId: rule.positionId,
			cycleId: rule.cycleId,
			revision: rule.revision,
		}),
	})
	const body = (await r.json().catch(() => ({}))) as {
		ok?: boolean
		message?: string
		preview?: Record<string, unknown>
		unsignedTx?: unknown
		rule?: AutoWithdrawRule
	}
	if (body.rule) {
		const saved = normalizeAutoWithdrawRule(body.rule)
		const all = read().rules
		const i = all.findIndex((x) => x.positionId.toLowerCase() === saved.positionId.toLowerCase())
		if (i >= 0) all[i] = saved
		write(all)
		markRuleSynced(saved.positionId, true)
	}
	if (!r.ok || body.ok === false) {
		return {
			ok: false,
			message: body.message ?? 'The withdrawal condition is no longer met.',
			rule: body.rule,
		}
	}
	return {
		ok: true,
		preview: body.preview,
		unsignedTx: body.unsignedTx,
		rule: body.rule,
	}
}

export function createDraftRule(input: {
	owner: string
	protocol: AutoWithdrawRule['protocol']
	poolId: string
	positionId: string
	direction: AutoWithdrawRule['direction']
	targetAsset: AutoWithdrawRule['targetAsset']
	directionSource: AutoWithdrawRule['directionSource']
	collectFeesWithWithdraw?: boolean
}): AutoWithdrawRule {
	const now = Date.now()
	return normalizeAutoWithdrawRule({
		id: newRuleId(input.positionId, now),
		owner: input.owner,
		network: 'mainnet',
		protocol: input.protocol,
		poolId: input.poolId,
		positionId: input.positionId,
		cycleId: newCycleId(now),
		revision: 0,
		direction: input.direction,
		targetAsset: input.targetAsset,
		directionSource: input.directionSource,
		enabled: false,
		status: 'disabled',
		collectFeesWithWithdraw: input.collectFeesWithWithdraw === true,
		armedWhileAlreadyMet: false,
		createdAtMs: now,
		updatedAtMs: now,
		lastCheckedAtMs: null,
		lastSuccessfulCheckAtMs: null,
		lastCheckError: null,
		observationSource: null,
		observationFetchedAtMs: null,
		lastTriggerReason: null,
		activeAttempt: null,
		uiNote: null,
		executionPermission: { ...AW_DEFAULT_EXECUTION_PERMISSION },
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
	})
}

export async function acceptWithdrawOnServer(rule: AutoWithdrawRule, acceptNonce?: string): Promise<{
	ok: boolean
	message?: string
	code?: string
	progress?: string[]
	rule?: AutoWithdrawRule
	preview?: Record<string, unknown>
	unsignedTx?: Record<string, unknown>
	intent?: { attemptId?: string; nonce?: string }
	walletApprovalRequired?: boolean
	unattendedExecution?: boolean
	signed?: boolean
	submitted?: boolean
}> {
	const token = getAwAuthToken()
	if (!token) return { ok: false, message: 'Authorize the owner wallet to Accept.' }
	const r = await fetch('/api/autopilot/auto-withdraw/accept', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			positionId: rule.positionId,
			cycleId: rule.cycleId,
			revision: rule.revision,
			acceptNonce,
		}),
	})
	const body = (await r.json().catch(() => ({}))) as {
		ok?: boolean
		message?: string
		code?: string
		progress?: string[]
		rule?: AutoWithdrawRule
		preview?: Record<string, unknown>
		unsignedTx?: Record<string, unknown>
		intent?: { attemptId?: string; nonce?: string }
		walletApprovalRequired?: boolean
		unattendedExecution?: boolean
		signed?: boolean
		submitted?: boolean
	}
	if (body.rule) {
		const saved = normalizeAutoWithdrawRule(body.rule)
		const all = read().rules
		const i = all.findIndex((x) => x.positionId.toLowerCase() === saved.positionId.toLowerCase())
		if (i >= 0) all[i] = saved
		write(all)
		markRuleSynced(saved.positionId, true)
	}
	return {
		ok: body.ok === true,
		message: body.message,
		code: body.code,
		progress: body.progress,
		rule: body.rule,
		preview: body.preview,
		unsignedTx: body.unsignedTx,
		intent: body.intent,
		walletApprovalRequired: body.walletApprovalRequired === true,
		unattendedExecution: false,
		signed: false,
		submitted: false,
	}
}

export async function cancelWithdrawOnServer(
	rule: AutoWithdrawRule,
	followUp: 'keep' | 'stop',
): Promise<{ ok: boolean; message?: string; rule?: AutoWithdrawRule }> {
	const token = getAwAuthToken()
	if (!token) return { ok: false, message: 'Authorize the owner wallet to cancel.' }
	const r = await fetch('/api/autopilot/auto-withdraw/cancel', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			positionId: rule.positionId,
			cycleId: rule.cycleId,
			revision: rule.revision,
			followUp,
		}),
	})
	const body = (await r.json().catch(() => ({}))) as {
		ok?: boolean
		message?: string
		rule?: AutoWithdrawRule
	}
	if (body.rule) {
		const saved = normalizeAutoWithdrawRule(body.rule)
		const all = read().rules
		const i = all.findIndex((x) => x.positionId.toLowerCase() === saved.positionId.toLowerCase())
		if (i >= 0) all[i] = saved
		write(all)
		markRuleSynced(saved.positionId, true)
	}
	return { ok: body.ok === true || r.ok, message: body.message, rule: body.rule }
}

export async function reportAwAttemptOnServer(input: {
	positionId: string
	attemptId: string
	cycleId: string
	revision: number
	payloadSha256: string
	clientOutcome: 'preparing_submit' | 'submitted' | 'failed' | 'unknown' | 'success_claimed'
	digest?: string | null
	errorMessage?: string | null
}): Promise<{ ok: boolean; message?: string; code?: string; rule?: AutoWithdrawRule }> {
	const token = getAwAuthToken()
	if (!token) return { ok: false, message: 'Authorize the owner wallet to report attempt.' }
	const r = await fetch('/api/autopilot/auto-withdraw/attempt/report', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(input),
	})
	const body = (await r.json().catch(() => ({}))) as {
		ok?: boolean
		message?: string
		code?: string
		rule?: AutoWithdrawRule
	}
	if (body.rule) {
		const saved = normalizeAutoWithdrawRule(body.rule)
		const all = read().rules
		const i = all.findIndex((x) => x.positionId.toLowerCase() === saved.positionId.toLowerCase())
		if (i >= 0) all[i] = saved
		else all.unshift(saved)
		write(all)
		markRuleSynced(saved.positionId, true)
	}
	return {
		ok: body.ok === true && r.ok,
		message: body.message,
		code: body.code,
		rule: body.rule,
	}
}

export async function reconcileAwAttemptOnServer(input: {
	positionId: string
	digest?: string | null
}): Promise<{ ok: boolean; message?: string; code?: string; rule?: AutoWithdrawRule }> {
	const token = getAwAuthToken()
	if (!token) return { ok: false, message: 'Authorize the owner wallet to reconcile.' }
	const r = await fetch('/api/autopilot/auto-withdraw/attempt/reconcile', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(input),
	})
	const body = (await r.json().catch(() => ({}))) as {
		ok?: boolean
		message?: string
		code?: string
		rule?: AutoWithdrawRule
	}
	if (body.rule) {
		const saved = normalizeAutoWithdrawRule(body.rule)
		const all = read().rules
		const i = all.findIndex((x) => x.positionId.toLowerCase() === saved.positionId.toLowerCase())
		if (i >= 0) all[i] = saved
		else all.unshift(saved)
		write(all)
		markRuleSynced(saved.positionId, true)
	}
	return {
		ok: body.ok === true && r.ok,
		message: body.message,
		code: body.code,
		rule: body.rule,
	}
}

export async function reviewNowOnServer(rule: AutoWithdrawRule): Promise<{
	ok: boolean
	message?: string
	rule?: AutoWithdrawRule
}> {
	const token = getAwAuthToken()
	if (!token) return { ok: false, message: 'Authorize the owner wallet.' }
	const r = await fetch('/api/autopilot/auto-withdraw/review-now', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			positionId: rule.positionId,
			cycleId: rule.cycleId,
			revision: rule.revision,
		}),
	})
	const body = (await r.json().catch(() => ({}))) as {
		ok?: boolean
		message?: string
		rule?: AutoWithdrawRule
	}
	if (body.rule) {
		const saved = normalizeAutoWithdrawRule(body.rule)
		const all = read().rules
		const i = all.findIndex((x) => x.positionId.toLowerCase() === saved.positionId.toLowerCase())
		if (i >= 0) all[i] = saved
		write(all)
		markRuleSynced(saved.positionId, true)
	}
	return { ok: body.ok === true || r.ok, message: body.message, rule: body.rule }
}

export { AUTO_WITHDRAW_EXECUTION_MODE }
