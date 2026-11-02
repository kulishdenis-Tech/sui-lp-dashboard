/**
 * Semi-automatic Auto Withdraw — execution permission model.
 *
 * Research conclusion (2026-10-30, official Sui + Cetus docs + installed SDKs):
 *
 * - Cetus/Bluefin/DLMM LP positions are address-owned Position NFTs (`key`/`store`).
 *   Mutating remove_liquidity requires a signer that can present `&mut Position`.
 * - Sui native Allowances authorize coin spends from an address balance — they do NOT
 *   authorize mutating an owned Position NFT.
 * - Seal SessionKey authorizes decryption for a package, not arbitrary PTBs.
 * - DeepBook Sessions are trading authority over a DeepBook account, not CLMM LP remove.
 * - There is no session-key / passkey / Bearer that the network scopes to
 *   “principal-only remove of position X to owner Y”.
 *
 * Therefore live Accept→sign→send without a wallet popup cannot provide on-chain
 * limited powers in the current architecture. A dedicated Move vault (or audited
 * smart-account policy) that holds the Position NFT and gates remove is required
 * before enabling live execution. Until then:
 * - Watching / Condition Met / Accept UX + attempt binding are real;
 * - executionPermission.status stays `unsupported`;
 * - Accept never signs with the owner wallet key or an unbound bot key.
 */

export type AwExecutionPermissionStatus =
	| 'required'
	| 'active'
	| 'expired'
	| 'revoked'
	| 'unsupported'

export type AwExecutionMechanism = 'none' | 'principal_vault_v1_prototype'

/** Per-protocol fitness for principal-only Withdraw All (fees/rewards stay on NFT). */
export type AwProtocolPrincipalOnlySupport =
	| 'supported'
	| 'unsupported_forced_collect'
	| 'unsupported_unknown'

export type AwExecutionPermission = {
	status: AwExecutionPermissionStatus
	mechanism: AwExecutionMechanism
	/** Wall-clock expiry of an on-chain grant (null when unsupported / none). */
	expiresAtMs: number | null
	revokedAtMs: number | null
	/** Human-readable English note for Manage UI. */
	summary: string
}

export const AW_DEFAULT_EXECUTION_PERMISSION: AwExecutionPermission = {
	status: 'unsupported',
	mechanism: 'none',
	expiresAtMs: null,
	revokedAtMs: null,
	summary:
		'Limited on-chain execution permission is not available yet. Watching can monitor this LP; Accept cannot withdraw without a wallet popup until a position vault is deployed.',
}

/** Gas ceiling agreed with the user for a single Accept attempt (MIST). 0.5 SUI. */
export const AW_ACCEPT_MAX_GAS_MIST = 500_000_000n

/** Max age of an Accept intent before it must be re-issued. */
export const AW_ACCEPT_INTENT_TTL_MS = 120_000

/**
 * Cryptographic / logical binding for one Accept attempt.
 * Server CAS + nonce enforce single-flight; network limits require a vault.
 */
export type AwAcceptIntent = {
	owner: string
	network: 'mainnet' | 'testnet'
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	positionId: string
	cycleId: string
	ruleRevision: number
	attemptId: string
	nonce: string
	direction: 'down' | 'up'
	targetAsset: 'SUI' | 'USDC'
	recipient: string
	gasCapMist: string
	maxPrincipalDeviationBps: number
	expiresAtMs: number
	conditionSummary: string
}

export type AwAcceptProgressStep =
	| 'Checking Position'
	| 'Preparing Withdrawal'
	| 'Withdrawing'
	| 'Confirming'
	| 'Withdrawal Complete'

export function principalOnlySupportForProtocol(
	protocol: 'clmm' | 'dlmm' | 'bluefin',
): AwProtocolPrincipalOnlySupport {
	if (protocol === 'clmm') return 'supported'
	if (protocol === 'dlmm') return 'supported'
	/**
	 * Bluefin: principal-only via direct `gateway::remove_liquidity` PTB
	 * (SDK `removeLiquidity` still forces collect — we do not use that helper for AW / Manage withdraw).
	 */
	if (protocol === 'bluefin') return 'supported'
	return 'unsupported_forced_collect'
}

export function isLiveAcceptExecutionEnabled(): boolean {
	return false
}

export function canActivateExecutionPermission(
	permission: AwExecutionPermission,
	now = Date.now(),
): boolean {
	if (permission.status === 'unsupported' || permission.status === 'required') return false
	if (permission.status === 'revoked') return false
	if (permission.status === 'expired') return false
	if (permission.status === 'active') {
		if (permission.expiresAtMs != null && now >= permission.expiresAtMs) return false
		return permission.mechanism !== 'none'
	}
	return false
}

export function permissionBlocksAccept(
	permission: AwExecutionPermission,
	now = Date.now(),
): { blocked: true; code: string; message: string } | { blocked: false } {
	if (permission.status === 'unsupported' || permission.mechanism === 'none') {
		return {
			blocked: true,
			code: 'EXECUTION_PERMISSION_UNSUPPORTED',
			message:
				'No limited on-chain executor is configured. Accept cannot sign or send. Deploy a principal-only position vault before live Accept execution.',
		}
	}
	if (permission.status === 'required') {
		return {
			blocked: true,
			code: 'EXECUTION_PERMISSION_REQUIRED',
			message: 'Grant limited execution permission for this LP before Accept can withdraw.',
		}
	}
	if (permission.status === 'revoked') {
		return {
			blocked: true,
			code: 'EXECUTION_PERMISSION_REVOKED',
			message: 'Execution permission was revoked. No transaction was sent.',
		}
	}
	if (
		permission.status === 'expired' ||
		(permission.expiresAtMs != null && now >= permission.expiresAtMs)
	) {
		return {
			blocked: true,
			code: 'EXECUTION_PERMISSION_EXPIRED',
			message: 'Execution permission expired. No transaction was sent.',
		}
	}
	if (!isLiveAcceptExecutionEnabled()) {
		return {
			blocked: true,
			code: 'LIVE_EXECUTION_DISABLED',
			message: 'Live Accept execution is disabled until the vault architecture is approved.',
		}
	}
	return { blocked: false }
}

export function buildAcceptIntent(input: {
	owner: string
	network: 'mainnet' | 'testnet'
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	positionId: string
	cycleId: string
	ruleRevision: number
	direction: 'down' | 'up'
	targetAsset: 'SUI' | 'USDC'
	conditionSummary: string
	attemptId?: string
	nonce?: string
	now?: number
	ttlMs?: number
	maxPrincipalDeviationBps?: number
}): AwAcceptIntent {
	const now = input.now ?? Date.now()
	const owner = input.owner.toLowerCase()
	return {
		owner,
		network: input.network,
		protocol: input.protocol,
		poolId: input.poolId.toLowerCase(),
		positionId: input.positionId.toLowerCase(),
		cycleId: input.cycleId,
		ruleRevision: input.ruleRevision,
		attemptId: input.attemptId ?? `att-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
		nonce: input.nonce ?? `n-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
		direction: input.direction,
		targetAsset: input.targetAsset,
		recipient: owner,
		gasCapMist: AW_ACCEPT_MAX_GAS_MIST.toString(),
		maxPrincipalDeviationBps: input.maxPrincipalDeviationBps ?? 150,
		expiresAtMs: now + (input.ttlMs ?? AW_ACCEPT_INTENT_TTL_MS),
		conditionSummary: input.conditionSummary,
	}
}

/** Stable fingerprint for CAS / replay detection (not a chain signature). */
export function acceptIntentFingerprint(intent: AwAcceptIntent): string {
	return [
		intent.owner,
		intent.network,
		intent.protocol,
		intent.poolId,
		intent.positionId,
		intent.cycleId,
		String(intent.ruleRevision),
		intent.attemptId,
		intent.nonce,
		intent.direction,
		intent.targetAsset,
		intent.recipient,
		intent.gasCapMist,
		String(intent.maxPrincipalDeviationBps),
		String(intent.expiresAtMs),
	].join('|')
}

export function assertAcceptIntentMatchesRule(
	intent: AwAcceptIntent,
	rule: {
		owner: string
		network: string
		protocol: string
		poolId: string
		positionId: string
		cycleId: string
		revision: number
		direction: string
		targetAsset: string
		enabled: boolean
	},
	now = Date.now(),
): { ok: true } | { ok: false; code: string; message: string } {
	if (now > intent.expiresAtMs) {
		return { ok: false, code: 'INTENT_EXPIRED', message: 'Accept intent expired. Request a new proposal.' }
	}
	if (!rule.enabled) {
		return { ok: false, code: 'WATCHING_DISABLED', message: 'Watching is disabled. No transaction was sent.' }
	}
	if (intent.owner !== rule.owner.toLowerCase()) {
		return { ok: false, code: 'OWNER_MISMATCH', message: 'Accept owner does not match the rule.' }
	}
	if (intent.recipient !== intent.owner) {
		return { ok: false, code: 'RECIPIENT_MISMATCH', message: 'Recipient must equal the authenticated owner.' }
	}
	if (intent.network !== rule.network) {
		return { ok: false, code: 'NETWORK_MISMATCH', message: 'Network mismatch.' }
	}
	if (intent.protocol !== rule.protocol) {
		return { ok: false, code: 'PROTOCOL_MISMATCH', message: 'Protocol mismatch.' }
	}
	if (intent.poolId !== rule.poolId.toLowerCase()) {
		return { ok: false, code: 'POOL_MISMATCH', message: 'Pool mismatch.' }
	}
	if (intent.positionId !== rule.positionId.toLowerCase()) {
		return { ok: false, code: 'POSITION_MISMATCH', message: 'Position mismatch.' }
	}
	if (intent.cycleId !== rule.cycleId) {
		return { ok: false, code: 'CYCLE_MISMATCH', message: 'Cycle changed. Request a new proposal.' }
	}
	if (intent.ruleRevision !== rule.revision) {
		return { ok: false, code: 'REVISION_MISMATCH', message: 'Rule revision changed. Request a new proposal.' }
	}
	if (intent.direction !== rule.direction || intent.targetAsset !== rule.targetAsset) {
		return { ok: false, code: 'DIRECTION_MISMATCH', message: 'Direction / target asset mismatch.' }
	}
	return { ok: true }
}

/**
 * Guarantees of the current mechanism vs bot-only checks.
 * Documented for operators — not marketing copy.
 */
export const AW_PERMISSION_GUARANTEES = {
	enforcedByNetworkToday: [
		'Nothing — no limited executor object exists; owner must sign PTBs that mutate the Position NFT.',
	],
	enforcedByBotOnlyToday: [
		'Watching evaluation and Condition Met detection',
		'Accept intent binding (owner, pool, position, cycle, revision, nonce)',
		'Single-flight attempt CAS before build',
		'verifyAutoWithdrawUnsignedTx policy on reviewed bytes',
		'Refusal to live-sign when executionPermission is unsupported',
	],
	attackerWithExecutorKeyWouldGet: [
		'With a vault (future): only principal-only remove of the vaulted position to the fixed owner, within gas/expiry — if the Move policy is correct.',
		'With today’s architecture (unbound hot key holding nothing): no LP access unless the Position NFT was transferred to that key (which would be unsafe and is not done).',
	],
	attackerWithExecutorKeyCannot: [
		'Spend unrelated owner coins (unless Allowance or coin ownership was also granted — not part of this design)',
		'Close/burn the position NFT if the vault forbids it',
		'Collect fees/rewards if the vault forbids it',
		'Swap or open new positions if the vault forbids it',
	],
	expiryRevoke: {
		today: 'UI/session revoke and rule disable are server-side only; they do not revoke chain signatures.',
		withVault:
			'Owner keeps a RevokeCap / bumps vault epoch; executor key becomes useless for that position immediately after revoke tx confirms.',
	},
	botUnavailable: 'Monitoring pauses; no Accept execution occurs. Ready proposals reappear after recheck when the Dashboard reconnects.',
	whatInitialWalletSignWouldCover: [
		'Transfer Position NFT into the principal-only vault (or register vault ownership)',
		'Optionally fund a small gas Allowance for the executor',
		'Issue / rotate the vault grant (expiry, gas cap, one-shot or cycle-scoped)',
	],
} as const

export function executionPermissionSetupCopy(input: {
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	positionId: string
	pairLabel: string
}): { title: string; bullets: string[]; blocker: string } {
	const short = `${input.positionId.slice(0, 6)}…${input.positionId.slice(-4)}`
	const principal = principalOnlySupportForProtocol(input.protocol)
	const bullets = [
		`Only this LP may be emptied: ${input.pairLabel} · ${short}`,
		'Withdrawn assets return only to you (the position owner).',
		'Fees and rewards are not collected with this permission.',
		'The position NFT stays open (Empty) — it is not closed.',
		'Network fee is capped (default ≤ 0.5 SUI per attempt).',
		'Permission expires; you can revoke it anytime from Manage.',
	]
	let blocker =
		'A principal-only Move vault (or equivalent smart-account policy) is required before Execution Permission can become Active. Watching works without it.'
	if (principal === 'unsupported_forced_collect') {
		blocker =
			'Bluefin remove always collects fees/rewards in the same PTB — this adapter is Unsupported for principal-only Accept execution.'
	}
	return {
		title: 'Execution Permission',
		bullets,
		blocker,
	}
}
