import type { BalancePreview, GasPreview } from './buildTx.js'

/**
 * Mysten unified client: fields not listed in `include` are typed `undefined`.
 * Status is always on the transaction body; gas / balanceChanges require opt-in.
 * @see https://sdk.mystenlabs.com/sui/clients/executing
 * @see https://sdk.mystenlabs.com/sui/transactions/signing-and-execution
 */
export const SIMULATE_INCLUDE = {
	effects: true,
	balanceChanges: true,
} as const

export type SimOutcomeCode = 'ok' | 'failed' | 'unavailable' | 'unsupported'

export type SimDiag = {
	discriminator: string | null
	hasBodyStatus: boolean
	hasEffectsStatus: boolean
	hasEffects: boolean
	hasGas: boolean
	hasBalanceChanges: boolean
	statusSuccess: boolean | null
	errorSnippet: string | null
}

export type SimParseResult = {
	ok: boolean
	/** Fail-closed: only true when code === 'ok'. */
	code: SimOutcomeCode
	/**
	 * UI string. Prefixes:
	 * - `simulation failed:` explicit execution / Move abort
	 * - `simulation unavailable:` no confirmed status
	 * - `unsupported response:` incompatible / unknown shape
	 */
	error: string | null
	gas: GasPreview | null
	balanceChanges: BalancePreview[]
	diag: SimDiag
}

type SimStatus = {
	success?: boolean
	error?: { message?: string } | string | null
}

type SimBody = {
	effects?: {
		status?: SimStatus
		gasUsed?: GasPreview
	}
	balanceChanges?: BalancePreview[]
	status?: SimStatus
}

function emptyDiag(): SimDiag {
	return {
		discriminator: null,
		hasBodyStatus: false,
		hasEffectsStatus: false,
		hasEffects: false,
		hasGas: false,
		hasBalanceChanges: false,
		statusSuccess: null,
		errorSnippet: null,
	}
}

function statusMessage(status: SimStatus | undefined | null): string | null {
	if (!status) return null
	const err = status.error
	if (typeof err === 'string' && err) return err
	if (err && typeof err === 'object' && typeof err.message === 'string' && err.message) return err.message
	return null
}

function asGas(raw: unknown): GasPreview | null {
	if (!raw || typeof raw !== 'object') return null
	const g = raw as Record<string, unknown>
	const computationCost = g.computationCost
	const storageCost = g.storageCost
	const storageRebate = g.storageRebate
	const nonRefundableStorageFee = g.nonRefundableStorageFee
	if (
		typeof computationCost !== 'string' ||
		typeof storageCost !== 'string' ||
		typeof storageRebate !== 'string' ||
		typeof nonRefundableStorageFee !== 'string'
	) {
		return null
	}
	return { computationCost, storageCost, storageRebate, nonRefundableStorageFee }
}

function asBalanceChanges(raw: unknown): BalancePreview[] {
	if (!Array.isArray(raw)) return []
	const out: BalancePreview[] = []
	for (const row of raw) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r.coinType !== 'string' || typeof r.amount !== 'string') continue
		out.push({
			coinType: r.coinType,
			address: typeof r.address === 'string' ? r.address : '',
			amount: r.amount,
		})
	}
	return out
}

/**
 * Parse Mysten `simulateTransaction` / dry-run result.
 * Confirmed success requires `$kind === 'Transaction'` and status.success === true
 * (body-level and/or effects.status). Digest / gas / object presence alone never unlock.
 */
export function interpretSim(sim: unknown): SimParseResult {
	const empty = { gas: null as GasPreview | null, balanceChanges: [] as BalancePreview[] }
	const diag = emptyDiag()
	if (!sim || typeof sim !== 'object') {
		return {
			ok: false,
			code: 'unsupported',
			error: 'unsupported response: empty simulation',
			...empty,
			diag,
		}
	}
	const s = sim as { $kind?: string; FailedTransaction?: SimBody; Transaction?: SimBody }
	diag.discriminator = typeof s.$kind === 'string' ? s.$kind : null
	const body = s.$kind === 'FailedTransaction' ? s.FailedTransaction : s.Transaction
	const effects = body?.effects
	diag.hasEffects = !!effects
	diag.hasBodyStatus = !!body?.status && typeof body.status.success === 'boolean'
	diag.hasEffectsStatus = !!effects?.status && typeof effects.status.success === 'boolean'
	const gas = asGas(effects?.gasUsed)
	diag.hasGas = gas != null
	const balanceChanges = asBalanceChanges(body?.balanceChanges)
	diag.hasBalanceChanges = balanceChanges.length > 0
	const status = body?.effects?.status ?? body?.status
	if (status && typeof status.success === 'boolean') diag.statusSuccess = status.success
	const errSnippet = statusMessage(status)
	diag.errorSnippet = errSnippet ? errSnippet.slice(0, 240) : null

	if (s.$kind === 'FailedTransaction') {
		const reason = errSnippet ?? 'simulation failed'
		return {
			ok: false,
			code: 'failed',
			error: `simulation failed: ${reason}`,
			gas,
			balanceChanges,
			diag,
		}
	}
	if (s.$kind !== 'Transaction') {
		return {
			ok: false,
			code: 'unsupported',
			error: `unsupported response: simulation kind ${s.$kind ?? 'missing'}`,
			gas,
			balanceChanges,
			diag,
		}
	}
	if (!status || typeof status.success !== 'boolean') {
		return {
			ok: false,
			code: 'unavailable',
			error: 'simulation unavailable: no confirmed execution status in the RPC response',
			gas,
			balanceChanges,
			diag,
		}
	}
	if (status.success !== true) {
		const reason = errSnippet ?? 'effects not successful'
		return {
			ok: false,
			code: 'failed',
			error: `simulation failed: ${reason}`,
			gas,
			balanceChanges,
			diag,
		}
	}
	// Prefer effects.status when both present; body success already required above.
	const effectsStatus = effects?.status
	if (effectsStatus && typeof effectsStatus.success === 'boolean' && effectsStatus.success !== true) {
		const reason = statusMessage(effectsStatus) ?? 'effects not successful'
		return {
			ok: false,
			code: 'failed',
			error: `simulation failed: ${reason}`,
			gas,
			balanceChanges,
			diag,
		}
	}
	return { ok: true, code: 'ok', error: null, gas, balanceChanges, diag }
}

/** Map thrown RPC/transport errors to the same fail-closed preview contract. */
export function interpretSimTransportError(e: unknown): SimParseResult {
	const msg = e instanceof Error ? e.message : String(e)
	return {
		ok: false,
		code: 'failed',
		error: `simulation failed: ${msg.slice(0, 400)}`,
		gas: null,
		balanceChanges: [],
		diag: { ...emptyDiag(), errorSnippet: msg.slice(0, 240) },
	}
}

/**
 * Local structure log — no secrets, signatures, or full tx bytes.
 */
export function logSimDiagnostics(
	parsed: SimParseResult,
	meta: { method: string; protocol: string; kind: string },
): void {
	const d = parsed.diag
	console.info(
		`[sim] method=${meta.method} protocol=${meta.protocol} kind=${meta.kind}` +
			` discriminator=${d.discriminator ?? 'null'}` +
			` bodyStatus=${d.hasBodyStatus} effectsStatus=${d.hasEffectsStatus}` +
			` effects=${d.hasEffects} gas=${d.hasGas} balanceChanges=${d.hasBalanceChanges}` +
			` statusSuccess=${d.statusSuccess === null ? 'null' : String(d.statusSuccess)}` +
			` code=${parsed.code}` +
			(d.errorSnippet ? ` err=${JSON.stringify(d.errorSnippet)}` : ''),
	)
}
