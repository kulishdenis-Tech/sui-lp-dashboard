import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
	buildBluefinAddTx,
	buildBluefinCloseTx,
	buildBluefinCollectFeeTx,
	buildBluefinOpenTx,
	buildBluefinRemoveTx,
	buildCloseTx,
	buildClmmAddTx,
	buildClmmCloseTx,
	buildClmmCollectFeeTx,
	buildClmmOpenTx,
	buildClmmRemoveTx,
	buildCollectFeeTx,
	buildConvertedRemoveTx,
	buildOpenTx,
	buildRemoveTx,
	fetchMarketUsdcPerSui,
	getProvider,
	parseProtocol,
	readSettlement,
	MICROTEST_PLAN,
	assertMicrotestIsManual,
	type ProtocolId,
} from '@autopilot/cetus'
import {
	recommendOperations,
	type StrategyConfig,
	type StrategySlot,
} from '@autopilot/engine'
import type { AutopilotStore } from '@autopilot/db'
import { gateTx, STRATEGY_ADMISSION, type GateResult, type ServerRiskFacts } from './openRiskGate.js'
import {
	asRecord,
	HttpValidationError,
	optionalPercent,
	readBodyLimited,
	requireFiniteNumber,
	requireKind,
	requireOwner,
	requirePoolId,
	requireProtocol,
} from './httpValidate.js'
import {
	getAuthDomain,
	getSession,
	issueAuthNonce,
	parseBearerToken,
	revokeSession,
	verifyAuthAndCreateSession,
} from './walletAuth.js'
import { reviewAutoWithdrawAll } from './autoWithdrawReview.js'
import {
	acceptAutoWithdrawProposal,
	cancelAutoWithdrawProposal,
	reviewNowAfterDismiss,
} from './autoWithdrawAccept.js'
import {
	AW_DEFAULT_EXECUTION_PERMISSION,
	AW_PERMISSION_GUARANTEES,
	applyAwAttemptReconcile,
	applyAwAttemptReport,
	disableBeforeSubmit,
	executionPermissionSetupCopy,
	normalizeAutoWithdrawRule,
	principalOnlySupportForProtocol,
	type AwAttemptClientOutcome,
} from '@autopilot/engine'
import { assertPositionOwnedBy, requireFullPositionId } from './awChainReads.js'

const PORT = Number(process.env.API_PORT ?? 5191)

function allowOrigin(req: IncomingMessage): string {
	const origin = req.headers.origin
	const allowed = new Set([
		'http://localhost:5180',
		'http://127.0.0.1:5180',
		'http://localhost:5190',
		'http://127.0.0.1:5190',
	])
	if (origin && allowed.has(origin)) return origin
	return 'http://127.0.0.1:5180'
}

function send(req: IncomingMessage, res: ServerResponse, code: number, body: unknown) {
	const json = JSON.stringify(body)
	res.writeHead(code, {
		'content-type': 'application/json',
		'access-control-allow-origin': allowOrigin(req),
		'access-control-allow-headers': 'content-type, authorization',
		'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
	})
	res.end(json)
}

function requireAuthedOwner(req: IncomingMessage): string {
	const token = parseBearerToken(req.headers.authorization)
	const session = getSession(token)
	if (!session) throw new HttpValidationError('wallet auth required')
	return session.address
}

function parseBinStrategy(raw: unknown): 'spot' | 'curve' | 'bidask' | undefined {
	if (raw === 'spot' || raw === 'curve' || raw === 'bidask') return raw
	return undefined
}

function parseOpenLegs(
	raw: unknown,
): {
	id?: string
	lowerPrice: number
	upperPrice: number
	budgetHuman: number
	binStrategy?: 'spot' | 'curve' | 'bidask'
}[] | undefined {
	if (!Array.isArray(raw)) return undefined
	return raw.map((lp, i) => {
		const row = asRecord(lp)
		return {
			id: row.id != null ? String(row.id) : undefined,
			lowerPrice: requireFiniteNumber(row.lowerPrice, `lps[${i}].lowerPrice`, { positive: true }),
			upperPrice: requireFiniteNumber(row.upperPrice, `lps[${i}].upperPrice`, { positive: true }),
			budgetHuman: requireFiniteNumber(row.budget ?? row.budgetHuman, `lps[${i}].budget`, {
				positive: true,
			}),
			binStrategy: parseBinStrategy(row.binStrategy ?? row.strategy),
		}
	})
}

/** Optional map coinType → decimals from the dashboard position hint. */
function parseCoinDecimalsMap(raw: unknown): Record<string, number> | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
	const out: Record<string, number> = {}
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		const n = typeof v === 'number' ? v : Number(v)
		if (!k.includes('::') || !Number.isInteger(n) || n < 0) continue
		out[k] = n
	}
	return Object.keys(out).length > 0 ? out : undefined
}

let apiStore: AutopilotStore | null = null
let apiPools: { poolId: string }[] = []
let apiPackageIds: string[] = []

function serverFactsFor(slot: StrategySlot): ServerRiskFacts | null {
	if (!apiStore) return null
	// Collected from the store. Price, RPC age, simulation, balances, and vault return
	// are not collected. They stay empty/false so they cannot pass evaluateRisk.
	// STRATEGY_ADMISSION blocks the HTTP strategy path before those fields are consulted.
	return {
		mode: apiStore.getMode(),
		emergencyStop: apiStore.isEmergencyStop(),
		ownerRevokedOperator: false,
		config: apiStore.getStrategy(slot) ?? null,
		whitelistPoolIds: new Set(apiPools.map((p) => p.poolId)),
		whitelistPackageIds: new Set(apiPackageIds),
		opsToday: apiStore.countOpsToday(),
		priceSources: [],
		maxPriceDivergencePct: 0.02,
		rpcFreshMs: Number.NaN,
		maxRpcAgeMs: 5_000,
		simulationOk: false,
		balancesMatchExpected: false,
		resultReturnsToVault: false,
	}
}

function strategyAdmissionDenied(slot: StrategySlot): GateResult {
	return {
		ok: false,
		contract: 'STRATEGY_OPEN',
		riskValidated: false,
		mode: apiStore?.getMode() ?? serverFactsFor(slot)?.mode ?? 'MONITOR_ONLY',
		risk: { ok: false, code: STRATEGY_ADMISSION.code, message: STRATEGY_ADMISSION.message },
	}
}

function evaluateOpenRisk(body: Record<string, unknown>, poolId: string): GateResult {
	const slot: StrategySlot = body.slot === 'SELL' ? 'SELL' : 'BUY'
	let legs: { lowerPrice: number; upperPrice: number; budgetHuman: number }[] | undefined
	if (Array.isArray(body.lps)) {
		try {
			legs = parseOpenLegs(body.lps)
		} catch {
			legs = undefined
		}
	}
	if (body.strategyGate === true) return strategyAdmissionDenied(slot)
	return gateTx({
		kind: 'open',
		strategyRequested: false,
		server: serverFactsFor(slot),
		clientRiskContext: body.riskContext,
		poolId,
		packageId: String(body.packageId ?? ''),
		slot,
		levelId: String(body.levelId ?? 'open'),
		lowerPrice: body.lowerPrice != null ? Number(body.lowerPrice) : undefined,
		upperPrice: body.upperPrice != null ? Number(body.upperPrice) : undefined,
		budgetHuman: body.budgetHuman != null ? Number(body.budgetHuman) : undefined,
		legs,
		estimatedGas: Number(body.estimatedGas ?? 0),
	})
}

export function startApi(opts?: {
	store?: AutopilotStore
	pools?: { poolId: string }[]
	packageIds?: string[]
	port?: number
	/** Test seam. Production uses the Cetus DLMM builders. */
	dlmmTx?: {
		buildOpenTx?: (input: Parameters<typeof buildOpenTx>[0]) => Promise<object>
		buildCloseTx?: (input: Parameters<typeof buildCloseTx>[0]) => Promise<object>
	}
	/** Test seam. Production uses Bluefin Spot builders (library-sui + simulate). */
	bluefinTx?: {
		buildCloseTx?: (input: Parameters<typeof buildBluefinCloseTx>[0]) => Promise<object>
	}
	/**
	 * Test seam for on-chain LP ownership before rule upsert.
	 * Production uses assertPositionOwnedBy (protocol list + pool match).
	 */
	assertAwPositionOwned?: typeof assertPositionOwnedBy
}): ReturnType<typeof createServer> {
	apiStore = opts?.store ?? null
	apiPools = opts?.pools ?? []
	apiPackageIds = opts?.packageIds ?? []
	const assertOwned = opts?.assertAwPositionOwned ?? assertPositionOwnedBy
	const server = createServer(async (req, res) => {
		try {
			if (req.method === 'OPTIONS') {
				send(req, res, 204, {})
				return
			}
			const url = new URL(req.url ?? '/', 'http://127.0.0.1')
			if (req.method === 'GET' && url.pathname === '/api/market') {
				const poolId = url.searchParams.get('poolId')
				const protocol = parseProtocol(url.searchParams.get('protocol'))
				const provider = getProvider(protocol)
				const [pools, market] = await Promise.all([
					poolId ? provider.readPool(poolId).then((p) => [p]) : provider.listPools(4),
					fetchMarketUsdcPerSui(),
				])
				send(req, res, 200, {
					protocol,
					source:
						protocol === 'clmm'
							? 'cetus-clmm-sdk'
							: protocol === 'bluefin'
								? 'bluefin-spot-sdk'
								: 'cetus-dlmm-sdk',
					pools,
					marketPriceUsdcPerSui: market?.priceUsdcPerSui ?? null,
					marketPriceSource: market?.source ?? null,
					simulated: false,
				})
				return
			}
			if (req.method === 'GET' && url.pathname === '/api/microtest') {
				assertMicrotestIsManual()
				send(req, res, 200, { ...MICROTEST_PLAN, submitted: false })
				return
			}
			if (req.method === 'GET' && url.pathname === '/api/settlement') {
				const digest = url.searchParams.get('digest') ?? ''
				const report = await readSettlement(digest)
				send(req, res, 200, report)
				return
			}
			if (req.method === 'GET' && url.pathname === '/api/auth/nonce') {
				try {
					const address = requireOwner(url.searchParams.get('address'))
					const issued = issueAuthNonce(address)
					send(req, res, 200, {
						...issued,
						note: 'Signing this message authorizes Auto Withdraw rule edits only — not transactions.',
					})
				} catch (e) {
					send(req, res, 400, { error: e instanceof Error ? e.message : String(e) })
				}
				return
			}
			if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
				try {
					const trusted = getAuthDomain()
					const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
					const host = typeof req.headers.host === 'string' ? req.headers.host : ''
					// Soft audience check: when Origin is present it must match allowlist (CORS).
					// Message Domain is fixed via AW_AUTH_DOMAIN — clients must sign that audience.
					if (origin) {
						const allowed = new Set([
							'http://localhost:5180',
							'http://127.0.0.1:5180',
							'http://localhost:5190',
							'http://127.0.0.1:5190',
						])
						if (!allowed.has(origin)) {
							send(req, res, 403, { error: 'Origin not trusted for Auto Withdraw auth.', code: 'ORIGIN' })
							return
						}
					}
					const body = asRecord(await readBodyLimited(req))
					const address = requireOwner(body.address)
					const nonce = String(body.nonce ?? '')
					const signature = String(body.signature ?? '')
					if (!nonce || !signature) throw new HttpValidationError('nonce and signature required')
					const session = await verifyAuthAndCreateSession({ address, nonce, signature })
					send(req, res, 200, {
						...session,
						domain: trusted,
						host: host || null,
						note: 'Session authorizes monitoring-rule changes only. Wallet must still approve each Withdraw All. Disable does not revoke an already-signed blockchain transaction.',
					})
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e)
					const status = /nonce|signature|address|expired|used/i.test(msg) ? 401 : 400
					send(req, res, status, { error: msg })
				}
				return
			}
			if (req.method === 'DELETE' && url.pathname === '/api/auth/session') {
				const token = parseBearerToken(req.headers.authorization)
				revokeSession(token)
				send(req, res, 200, {
					ok: true,
					note: 'Session revoked. Monitoring-rule auth only — does not cancel wallet signatures.',
				})
				return
			}
			if (req.method === 'GET' && url.pathname === '/api/auto-withdraw/status') {
				const rules = apiStore?.listAutoWithdrawRules() ?? []
				const enabled = rules.filter((r) => r.enabled && r.status !== 'completed')
				send(req, res, 200, {
					ok: true,
					service: 'Service Online',
					lastCheckedAtMs: apiStore?.getAutoWithdrawLastCheckMs() ?? null,
					executionMode: 'monitoring_approval_required',
					liveAcceptExecution: false,
					/** Marker for Dashboard/bot version checks (Accept → wallet → auto-submit). */
					clientFlow: 'accept_wallet_auto_submit_v1',
					executionPermissionDefault: AW_DEFAULT_EXECUTION_PERMISSION,
					permissionGuarantees: AW_PERMISSION_GUARANTEES,
					ruleCount: rules.length,
					enabledRuleCount: enabled.length,
					checkIntervalNote:
						'Position checks run on the bot loop interval (LOOP_MS). Heartbeat is not a condition check.',
					freshnessMs: 90_000,
					note: 'Watching is live. Accept→sign without wallet popup is blocked until a principal-only vault exists.',
				})
				return
			}
			if (req.method === 'GET' && url.pathname === '/api/auto-withdraw') {
				const owner = (url.searchParams.get('owner') ?? '').toLowerCase()
				const rules = (apiStore?.listAutoWithdrawRules() ?? []).filter((r) => {
					if (!owner) return true
					return r.owner.toLowerCase() === owner
				})
				send(req, res, 200, {
					rules,
					executionMode: 'monitoring_approval_required',
					serverSynced: true,
				})
				return
			}
			if (req.method === 'PUT' && url.pathname === '/api/auto-withdraw') {
				if (!apiStore) {
					send(req, res, 503, { error: 'store unavailable' })
					return
				}
				let authed: string
				try {
					authed = requireAuthedOwner(req)
				} catch (e) {
					send(req, res, 401, {
						error: e instanceof Error ? e.message : 'wallet auth required',
						code: 'AUTH_REQUIRED',
					})
					return
				}
				const body = asRecord(await readBodyLimited(req))
				const rawRule = body.rule as import('@autopilot/engine').AutoWithdrawRule | undefined
				if (!rawRule || typeof rawRule !== 'object') {
					send(req, res, 400, { error: 'rule object required' })
					return
				}
				const rule = normalizeAutoWithdrawRule(rawRule)
				if (rule.owner.toLowerCase() !== authed.toLowerCase()) {
					send(req, res, 403, {
						error: 'Authenticated wallet must match rule.owner. Visiting Address cannot change rules.',
						code: 'OWNER_MISMATCH',
					})
					return
				}
				const existing = apiStore.getAutoWithdrawRule(rule.positionId)
				if (existing && existing.owner.toLowerCase() !== authed.toLowerCase()) {
					send(req, res, 403, { error: 'Cannot overwrite another owner rule.', code: 'OWNER_MISMATCH' })
					return
				}
				try {
					requireOwner(rule.owner)
					requirePoolId(rule.poolId)
					requireProtocol(rule.protocol)
					requireFullPositionId(rule.positionId)

					/**
					 * Disable existing rule: auth is enough. Do not require chain reader —
					 * ownership RPC failure must not trap Watching in enabled:true.
					 * Bump revision + clear unsent attempts so monitor CAS cannot overwrite.
					 */
					if (existing && !rule.enabled) {
						const stopped = disableBeforeSubmit({
							...existing,
							collectFeesWithWithdraw: rule.collectFeesWithWithdraw === true,
							direction: rule.direction,
							targetAsset: rule.targetAsset,
							directionSource: rule.directionSource,
						})
						const saved = apiStore.upsertAutoWithdrawRule(
							normalizeAutoWithdrawRule({
								...stopped,
								owner: authed,
								enabled: false,
								status: existing.status === 'completed' ? 'completed' : stopped.status,
							}),
						)
						send(req, res, 200, {
							rule: saved,
							executionMode: 'monitoring_approval_required',
							submitted: false,
							serverSynced: true,
							disabledWithoutChainRead: true,
						})
						return
					}

					// Allowlist user fields; keep attempt/observation/revision/checks server-owned.
					const restartStuck =
						!!existing &&
						!!rule.enabled &&
						(existing.status === 'outcome_unknown' ||
							existing.status === 'needs_attention' ||
							existing.status === 'confirming')
					let nextStatus = existing?.status ?? 'watching'
					if (!rule.enabled) {
						nextStatus = existing?.status === 'completed' ? 'completed' : 'disabled'
					} else if (
						!existing ||
						existing.status === 'disabled' ||
						existing.status === 'completed' ||
						restartStuck
					) {
						nextStatus = 'watching'
					}
					const sanitized = normalizeAutoWithdrawRule({
						...rule,
						owner: authed,
						enabled: !!rule.enabled,
						status: nextStatus,
						revision: existing?.revision ?? 1,
						activeAttempt: restartStuck ? null : (existing?.activeAttempt ?? null),
						observationSource: existing?.observationSource ?? null,
						observationFetchedAtMs: existing?.observationFetchedAtMs ?? null,
						lastSuccessfulCheckAtMs: existing?.lastSuccessfulCheckAtMs ?? null,
						lastCheckError: restartStuck ? null : (existing?.lastCheckError ?? null),
						lastTriggerReason: existing?.lastTriggerReason ?? null,
						lastCheckedAtMs: existing?.lastCheckedAtMs ?? null,
						executionPermission:
							existing?.executionPermission ?? AW_DEFAULT_EXECUTION_PERMISSION,
						dismissedUntilReentry: restartStuck
							? false
							: (existing?.dismissedUntilReentry ?? false),
						reentrySeenSinceDismiss: restartStuck
							? false
							: (existing?.reentrySeenSinceDismiss ?? false),
						pendingAcceptIntent: restartStuck ? null : (existing?.pendingAcceptIntent ?? null),
						uiNote: restartStuck
							? 'Watching restarted. It stays on until liquidity is zero.'
							: (existing?.uiNote ?? rule.uiNote ?? null),
					})
					/* Enable / create still requires on-chain ownership proof. */
					await assertOwned({
						owner: sanitized.owner,
						protocol: sanitized.protocol,
						poolId: sanitized.poolId,
						positionId: sanitized.positionId,
					})
					const saved = apiStore.upsertAutoWithdrawRule(sanitized)
					send(req, res, 200, {
						rule: saved,
						executionMode: 'monitoring_approval_required',
						submitted: false,
						serverSynced: true,
					})
				} catch (e) {
					send(req, res, 400, { error: e instanceof Error ? e.message : String(e) })
				}
				return
			}
			if (req.method === 'POST' && url.pathname === '/api/auto-withdraw/review') {
				if (!apiStore) {
					send(req, res, 503, { error: 'store unavailable' })
					return
				}
				let authed: string
				try {
					authed = requireAuthedOwner(req)
				} catch (e) {
					send(req, res, 401, {
						error: e instanceof Error ? e.message : 'wallet auth required',
						code: 'AUTH_REQUIRED',
					})
					return
				}
				const body = asRecord(await readBodyLimited(req))
				const positionId = String(body.positionId ?? '')
				const cycleId = String(body.cycleId ?? '')
				const revision = Number(body.revision)
				if (!positionId || !cycleId || !Number.isFinite(revision)) {
					send(req, res, 400, { error: 'positionId, cycleId, and revision required' })
					return
				}
				const result = await reviewAutoWithdrawAll({
					store: apiStore,
					authenticatedOwner: authed,
					positionId,
					cycleId,
					revision,
				})
				if (!result.ok) {
					const code =
						result.code === 'auth' ? 403 : result.code === 'not_found' ? 404 : 409
					send(req, res, code, result)
					return
				}
				send(req, res, 200, {
					...result,
					executionMode: 'monitoring_approval_required',
					submitted: false,
					note: 'Preview only. Confirm Withdraw All in your wallet. Position stays open and empty.',
				})
				return
			}
			if (req.method === 'POST' && url.pathname === '/api/auto-withdraw/accept') {
				if (!apiStore) {
					send(req, res, 503, { error: 'store unavailable' })
					return
				}
				let authed: string
				try {
					authed = requireAuthedOwner(req)
				} catch (e) {
					send(req, res, 401, {
						error: e instanceof Error ? e.message : 'wallet auth required',
						code: 'AUTH_REQUIRED',
					})
					return
				}
				const body = asRecord(await readBodyLimited(req))
				const positionId = String(body.positionId ?? '')
				const cycleId = String(body.cycleId ?? '')
				const revision = Number(body.revision)
				const acceptNonce =
					typeof body.acceptNonce === 'string' ? body.acceptNonce : undefined
				if (!positionId || !cycleId || !Number.isFinite(revision)) {
					send(req, res, 400, { error: 'positionId, cycleId, and revision required' })
					return
				}
				const result = await acceptAutoWithdrawProposal({
					store: apiStore,
					authenticatedOwner: authed,
					positionId,
					cycleId,
					revision,
					acceptNonce,
				})
				const code = result.ok
					? 200
					: result.code === 'auth'
						? 403
						: result.code === 'not_found'
							? 404
							: 409
				send(req, res, code, {
					...result,
					liveAcceptExecution: false,
					unattendedExecution: false,
					signed: false,
					submitted: false,
					note: result.ok
						? 'Wallet approval required. Client signs the reviewed bytes then auto-submits. Unattended execution remains unavailable.'
						: result.message,
				})
				return
			}
			if (req.method === 'POST' && url.pathname === '/api/auto-withdraw/cancel') {
				if (!apiStore) {
					send(req, res, 503, { error: 'store unavailable' })
					return
				}
				let authed: string
				try {
					authed = requireAuthedOwner(req)
				} catch (e) {
					send(req, res, 401, {
						error: e instanceof Error ? e.message : 'wallet auth required',
						code: 'AUTH_REQUIRED',
					})
					return
				}
				const body = asRecord(await readBodyLimited(req))
				const positionId = String(body.positionId ?? '')
				const cycleId = String(body.cycleId ?? '')
				const revision = Number(body.revision)
				const followUp = body.followUp === 'stop' ? 'stop' : 'keep'
				if (!positionId || !cycleId || !Number.isFinite(revision)) {
					send(req, res, 400, { error: 'positionId, cycleId, and revision required' })
					return
				}
				const result = cancelAutoWithdrawProposal({
					store: apiStore,
					authenticatedOwner: authed,
					positionId,
					cycleId,
					revision,
					followUp,
				})
				send(req, res, result.ok ? 200 : result.code === 'auth' ? 403 : 409, {
					...result,
					signed: false,
					submitted: false,
				})
				return
			}
			if (req.method === 'POST' && url.pathname === '/api/auto-withdraw/review-now') {
				if (!apiStore) {
					send(req, res, 503, { error: 'store unavailable' })
					return
				}
				let authed: string
				try {
					authed = requireAuthedOwner(req)
				} catch (e) {
					send(req, res, 401, {
						error: e instanceof Error ? e.message : 'wallet auth required',
						code: 'AUTH_REQUIRED',
					})
					return
				}
				const body = asRecord(await readBodyLimited(req))
				const positionId = String(body.positionId ?? '')
				const cycleId = String(body.cycleId ?? '')
				const revision = Number(body.revision)
				if (!positionId || !cycleId || !Number.isFinite(revision)) {
					send(req, res, 400, { error: 'positionId, cycleId, and revision required' })
					return
				}
				const result = reviewNowAfterDismiss({
					store: apiStore,
					authenticatedOwner: authed,
					positionId,
					cycleId,
					revision,
				})
				send(req, res, result.ok ? 200 : result.code === 'auth' ? 403 : 409, result)
				return
			}
			if (req.method === 'POST' && url.pathname === '/api/auto-withdraw/attempt/report') {
				if (!apiStore) {
					send(req, res, 503, { error: 'store unavailable' })
					return
				}
				let authed: string
				try {
					authed = requireAuthedOwner(req)
				} catch (e) {
					send(req, res, 401, {
						error: e instanceof Error ? e.message : 'wallet auth required',
						code: 'AUTH_REQUIRED',
					})
					return
				}
				const body = asRecord(await readBodyLimited(req))
				const positionId = String(body.positionId ?? '')
				const existing = apiStore.getAutoWithdrawRule(positionId)
				if (!existing) {
					send(req, res, 404, { ok: false, code: 'NOT_FOUND', message: 'rule not found' })
					return
				}
				if (existing.owner.toLowerCase() !== authed.toLowerCase()) {
					send(req, res, 403, { ok: false, code: 'OWNER_MISMATCH', message: 'owner mismatch' })
					return
				}
				const expected = {
					revision: Number(body.revision),
					cycleId: String(body.cycleId ?? ''),
					enabled: existing.enabled,
					status: existing.status,
				}
				const report = applyAwAttemptReport(existing, {
					attemptId: String(body.attemptId ?? ''),
					positionId,
					owner: authed,
					network: existing.network,
					cycleId: String(body.cycleId ?? ''),
					revision: Number(body.revision),
					payloadSha256: String(body.payloadSha256 ?? ''),
					digest: body.digest != null ? String(body.digest) : null,
					clientOutcome: String(body.clientOutcome ?? '') as AwAttemptClientOutcome,
					errorMessage: body.errorMessage != null ? String(body.errorMessage) : null,
				})
				if (!report.ok) {
					send(req, res, 409, report)
					return
				}
				const written = apiStore.casUpdateAutoWithdrawRule(
					positionId,
					expected,
					() => report.rule,
				)
				if (!written) {
					send(req, res, 409, {
						ok: false,
						code: 'CAS_FAILED',
						message: 'Rule changed; report not applied.',
						rule: apiStore.getAutoWithdrawRule(positionId) ?? undefined,
					})
					return
				}
				send(req, res, 200, { ok: true, rule: written })
				return
			}
			if (req.method === 'POST' && url.pathname === '/api/auto-withdraw/attempt/reconcile') {
				if (!apiStore) {
					send(req, res, 503, { error: 'store unavailable' })
					return
				}
				let authed: string
				try {
					authed = requireAuthedOwner(req)
				} catch (e) {
					send(req, res, 401, {
						error: e instanceof Error ? e.message : 'wallet auth required',
						code: 'AUTH_REQUIRED',
					})
					return
				}
				const body = asRecord(await readBodyLimited(req))
				const positionId = String(body.positionId ?? '')
				const existing = apiStore.getAutoWithdrawRule(positionId)
				if (!existing) {
					send(req, res, 404, { ok: false, code: 'NOT_FOUND', message: 'rule not found' })
					return
				}
				if (existing.owner.toLowerCase() !== authed.toLowerCase()) {
					send(req, res, 403, { ok: false, code: 'OWNER_MISMATCH', message: 'owner mismatch' })
					return
				}
				const digest = String(
					body.digest ?? existing.activeAttempt?.digest ?? '',
				).trim()
				if (!digest) {
					send(req, res, 400, {
						ok: false,
						code: 'DIGEST_REQUIRED',
						message: 'digest required to reconcile',
						rule: existing,
					})
					return
				}
				let chain: import('@autopilot/engine').AwChainDigestResult
				try {
					const settlement = await readSettlement(digest)
					if (!settlement) {
						chain = { kind: 'pending', digest }
					} else if (settlement.success) {
						chain = { kind: 'success', digest: settlement.digest || digest }
					} else {
						chain = { kind: 'failed', digest: settlement.digest || digest }
					}
				} catch {
					chain = { kind: 'unavailable', digest }
				}
				const expected = {
					revision: existing.revision,
					cycleId: existing.cycleId,
					enabled: existing.enabled,
					status: existing.status,
				}
				const reconciled = applyAwAttemptReconcile(existing, chain)
				if (!reconciled.ok) {
					send(req, res, 409, reconciled)
					return
				}
				const written = apiStore.casUpdateAutoWithdrawRule(
					positionId,
					expected,
					() => reconciled.rule,
				)
				if (!written) {
					send(req, res, 409, {
						ok: false,
						code: 'CAS_FAILED',
						message: 'Rule changed; reconcile not applied.',
						rule: apiStore.getAutoWithdrawRule(positionId) ?? undefined,
					})
					return
				}
				send(req, res, 200, { ok: true, rule: written, chain })
				return
			}
			if (req.method === 'GET' && url.pathname === '/api/auto-withdraw/permission-info') {
				const protocol = (url.searchParams.get('protocol') ?? 'clmm') as
					| 'clmm'
					| 'dlmm'
					| 'bluefin'
				const positionId = url.searchParams.get('positionId') ?? '0x'
				const pairLabel = url.searchParams.get('pair') ?? 'SUI/USDC'
				send(req, res, 200, {
					...executionPermissionSetupCopy({ protocol, positionId, pairLabel }),
					principalOnly: principalOnlySupportForProtocol(protocol),
					defaultPermission: AW_DEFAULT_EXECUTION_PERMISSION,
					guarantees: AW_PERMISSION_GUARANTEES,
					liveAcceptExecution: false,
				})
				return
			}
			if (req.method === 'GET' && url.pathname === '/api/positions') {
				const owner = url.searchParams.get('owner') ?? ''
				if (!owner.startsWith('0x')) {
					send(req, res, 400, { error: 'owner address required' })
					return
				}
				const protocolParam = url.searchParams.get('protocol')
				if (protocolParam === 'all') {
					const [clmm, dlmm, bluefin] = await Promise.all([
						getProvider('clmm').listOwnerPositions(owner),
						getProvider('dlmm').listOwnerPositions(owner),
						getProvider('bluefin').listOwnerPositions(owner),
					])
					send(req, res, 200, {
						source: 'multi-protocol',
						positions: [...clmm, ...dlmm, ...bluefin],
						simulated: false,
					})
					return
				}
				const protocol = parseProtocol(protocolParam)
				const positions = await getProvider(protocol).listOwnerPositions(owner)
				send(req, res, 200, {
					protocol,
					source:
						protocol === 'clmm'
							? 'cetus-clmm-sdk'
							: protocol === 'bluefin'
								? 'bluefin-spot-sdk'
								: 'cetus-dlmm-sdk',
					positions,
					simulated: false,
				})
				return
			}
			if (req.method === 'POST' && url.pathname === '/api/recommend') {
				const body = asRecord(await readBodyLimited(req))
				const config = body.config as StrategyConfig | undefined
				if (!config) {
					send(req, res, 400, { error: 'config required' })
					return
				}
				const levels = Array.isArray(body.levels) ? body.levels : []
				const slot = config.slot
				const serverCfg = apiStore?.getStrategy(slot) ?? null
				const useServer = body.strategyGate === true
				if (useServer) {
					if (!serverCfg) {
						send(req, res, 400, {
							error: STRATEGY_ADMISSION.message,
							riskValidated: false,
							strategyAdmission: 'disabled',
							code: STRATEGY_ADMISSION.code,
						})
						return
					}
					const recs = recommendOperations(serverCfg, levels as never).map((r) => ({
						...r,
						riskApplied: false as const,
						riskValidated: false as const,
					}))
					send(req, res, 200, {
						recommendations: recs,
						signed: false,
						riskValidated: false,
						strategyAdmission: 'disabled',
						code: STRATEGY_ADMISSION.code,
						mode: apiStore?.getMode() ?? null,
						emergencyStop: apiStore?.isEmergencyStop() ?? false,
						riskNote: STRATEGY_ADMISSION.message,
					})
					return
				}
				const recs = recommendOperations(config, levels as never).map((r) => ({
					...r,
					riskApplied: false as const,
					riskValidated: false as const,
				}))
				send(req, res, 200, {
					recommendations: recs,
					signed: false,
					riskValidated: false,
					mode: apiStore?.getMode() ?? null,
					emergencyStop: apiStore?.isEmergencyStop() ?? false,
					riskNote: 'not risk-validated; client riskContext ignored',
				})
				return
			}
			if (req.method === 'POST' && url.pathname === '/api/tx') {
				const body = asRecord(await readBodyLimited(req))
				const protocol = requireProtocol(body.protocol ?? parseProtocol(String(body.protocol ?? 'dlmm')))
				const owner = requireOwner(body.owner)
				const poolId = requirePoolId(body.poolId)
				const kind = requireKind(body.kind)
				let openGate: GateResult | null = null
				let tx
				if (protocol === 'bluefin') {
					if (kind === 'open') {
						const openRisk = evaluateOpenRisk(body, poolId)
						if (!openRisk.ok) {
							send(req, res, 400, {
								error: openRisk.risk.message,
								code: openRisk.risk.code,
								strategyAdmission: openRisk.risk.code === STRATEGY_ADMISSION.code ? 'disabled' : undefined,
								risk: openRisk.risk,
								mode: openRisk.mode,
								riskValidated: false,
								contract: openRisk.contract,
								emergencyStop: openRisk.risk.code === 'EMERGENCY_STOP',
								submitted: false,
							})
							return
						}
						openGate = openRisk
						const hardPrice = requireFiniteNumber(body.hardPrice, 'hardPrice', { positive: true })
						const legs = parseOpenLegs(body.lps)
						tx = await buildBluefinOpenTx({
							owner,
							poolId,
							slot: body.slot === 'SELL' ? 'SELL' : 'BUY',
							hardPrice,
							lowerPrice:
								body.lowerPrice != null
									? requireFiniteNumber(body.lowerPrice, 'lowerPrice', { positive: true })
									: undefined,
							upperPrice:
								body.upperPrice != null
									? requireFiniteNumber(body.upperPrice, 'upperPrice', { positive: true })
									: undefined,
							budgetHuman:
								body.budgetHuman != null
									? requireFiniteNumber(body.budgetHuman, 'budgetHuman', { positive: true })
									: undefined,
							legs,
						})
					} else if (kind === 'add') {
						tx = await buildBluefinAddTx({
							owner,
							poolId,
							positionId: String(body.positionId ?? ''),
							amountHuman: requireFiniteNumber(body.amountHuman, 'amountHuman', {
								positive: true,
							}),
							fixSide: String(body.fixSide ?? body.fixCoin ?? 'A'),
							poolFixSide:
								body.poolFixSide != null ? String(body.poolFixSide) : undefined,
							slippage:
								body.slippage != null
									? requireFiniteNumber(body.slippage, 'slippage', { min: 0, max: 0.5 })
									: undefined,
							coinDecimals: parseCoinDecimalsMap(body.coinDecimals),
						})
					} else if (kind === 'close') {
						tx = await (opts?.bluefinTx?.buildCloseTx ?? buildBluefinCloseTx)({
							owner,
							poolId,
							positionId: String(body.positionId ?? ''),
						})
					} else if (kind === 'remove') {
						tx = await buildBluefinRemoveTx({
							owner,
							poolId,
							positionId: String(body.positionId ?? ''),
							removePercent: optionalPercent(body.removePercent, 'removePercent'),
							liquidityRaw: body.liquidity != null ? String(body.liquidity) : undefined,
						})
					} else if (kind === 'collect_fee') {
						tx = await buildBluefinCollectFeeTx({
							owner,
							poolId,
							positionId: String(body.positionId ?? ''),
						})
					} else if (kind === 'remove_converted') {
						send(req, res, 400, {
							error: 'remove_converted is DLMM-only; Bluefin uses remove with removePercent',
							protocol,
							submitted: false,
						})
						return
					} else {
						send(req, res, 400, {
							error: 'kind must be open|add|close|remove|collect_fee',
							protocol,
							submitted: false,
						})
						return
					}
					send(req, res, 200, {
						...tx,
						protocol: 'bluefin',
						submitted: false,
						mode: apiStore?.getMode() ?? null,
						contract: openGate?.contract ?? 'MANUAL_MANAGE',
						riskValidated: openGate?.riskValidated ?? false,
					})
					return
				}
				if (protocol === 'clmm') {
					if (kind === 'open') {
						const openRisk = evaluateOpenRisk(body, poolId)
						if (!openRisk.ok) {
							send(req, res, 400, {
								error: openRisk.risk.message,
								code: openRisk.risk.code,
								strategyAdmission: openRisk.risk.code === STRATEGY_ADMISSION.code ? 'disabled' : undefined,
								risk: openRisk.risk,
								mode: openRisk.mode,
								riskValidated: false,
								contract: openRisk.contract,
								emergencyStop: openRisk.risk.code === 'EMERGENCY_STOP',
								submitted: false,
							})
							return
						}
						openGate = openRisk
						const hardPrice = requireFiniteNumber(body.hardPrice, 'hardPrice', { positive: true })
						const legs = parseOpenLegs(body.lps)
						tx = await buildClmmOpenTx({
							owner,
							poolId,
							slot: body.slot === 'SELL' ? 'SELL' : 'BUY',
							hardPrice,
							lowerPrice:
								body.lowerPrice != null
									? requireFiniteNumber(body.lowerPrice, 'lowerPrice', { positive: true })
									: undefined,
							upperPrice:
								body.upperPrice != null
									? requireFiniteNumber(body.upperPrice, 'upperPrice', { positive: true })
									: undefined,
							budgetHuman:
								body.budgetHuman != null
									? requireFiniteNumber(body.budgetHuman, 'budgetHuman', { positive: true })
									: undefined,
							legs,
						})
					} else if (kind === 'add') {
						tx = await buildClmmAddTx({
							owner,
							poolId,
							positionId: String(body.positionId ?? ''),
							amountHuman: requireFiniteNumber(body.amountHuman, 'amountHuman', {
								positive: true,
							}),
							fixSide: String(body.fixSide ?? body.fixCoin ?? 'A'),
							poolFixSide:
								body.poolFixSide != null ? String(body.poolFixSide) : undefined,
							slippage:
								body.slippage != null
									? requireFiniteNumber(body.slippage, 'slippage', { min: 0, max: 0.5 })
									: undefined,
							// Add = deposit only. Fees/rewards stay until explicit Collect.
							collectFee: body.collectFee === true,
							coinDecimals: parseCoinDecimalsMap(body.coinDecimals),
						})
					} else if (kind === 'close') {
						tx = await buildClmmCloseTx({ owner, poolId, positionId: String(body.positionId ?? '') })
					} else if (kind === 'remove') {
						tx = await buildClmmRemoveTx({
							owner,
							poolId,
							positionId: String(body.positionId ?? ''),
							removePercent: optionalPercent(body.removePercent, 'removePercent'),
							collectFee: body.collectFee === true,
						})
					} else if (kind === 'collect_fee') {
						tx = await buildClmmCollectFeeTx({
							owner,
							poolId,
							positionId: String(body.positionId ?? ''),
						})
					} else if (kind === 'remove_converted') {
						send(req, res, 400, {
							error: 'remove_converted is DLMM-only; CLMM uses remove with removePercent',
							protocol,
							submitted: false,
						})
						return
					} else {
						send(req, res, 400, {
							error: 'kind must be open|add|close|remove|collect_fee',
							protocol,
							submitted: false,
						})
						return
					}
					send(req, res, 200, {
						...tx,
						protocol: 'clmm',
						submitted: false,
						mode: apiStore?.getMode() ?? null,
						contract: openGate?.contract ?? 'MANUAL_MANAGE',
						riskValidated: openGate?.riskValidated ?? false,
					})
					return
				}
				if (kind === 'open') {
					const openRisk = evaluateOpenRisk(body, poolId)
					if (!openRisk.ok) {
						send(req, res, 400, {
							error: openRisk.risk.message,
							code: openRisk.risk.code,
							strategyAdmission: openRisk.risk.code === STRATEGY_ADMISSION.code ? 'disabled' : undefined,
							risk: openRisk.risk,
							mode: openRisk.mode,
							riskValidated: false,
							contract: openRisk.contract,
							emergencyStop: openRisk.risk.code === 'EMERGENCY_STOP',
							submitted: false,
						})
						return
					}
					openGate = openRisk
					const hardPrice = requireFiniteNumber(body.hardPrice, 'hardPrice', { positive: true })
					const legs = parseOpenLegs(body.lps)
					tx = await (opts?.dlmmTx?.buildOpenTx ?? buildOpenTx)({
						owner,
						poolId,
						slot: body.slot === 'SELL' ? 'SELL' : 'BUY',
						hardPrice,
						lowerPrice:
							body.lowerPrice != null
								? requireFiniteNumber(body.lowerPrice, 'lowerPrice', { positive: true })
								: undefined,
						upperPrice:
							body.upperPrice != null
								? requireFiniteNumber(body.upperPrice, 'upperPrice', { positive: true })
								: undefined,
						budgetHuman:
							body.budgetHuman != null
								? requireFiniteNumber(body.budgetHuman, 'budgetHuman', { positive: true })
								: undefined,
						legs,
					})
				} else if (kind === 'close') {
					tx = await (opts?.dlmmTx?.buildCloseTx ?? buildCloseTx)({ owner, poolId, positionId: String(body.positionId ?? '') })
				} else if (kind === 'remove') {
					tx = await buildRemoveTx({ owner, poolId, positionId: String(body.positionId ?? '') })
				} else if (kind === 'remove_converted') {
					if (body.slot !== 'BUY' && body.slot !== 'SELL') {
						send(req, res, 400, { error: 'remove_converted requires slot BUY or SELL' })
						return
					}
					tx = await buildConvertedRemoveTx({
						owner,
						poolId,
						positionId: String(body.positionId ?? ''),
						slot: body.slot,
						percent: requireFiniteNumber(body.percent, 'percent', { positive: true, max: 1 }),
					})
				} else if (kind === 'collect_fee') {
					tx = await buildCollectFeeTx({ owner, poolId, positionId: String(body.positionId ?? '') })
				} else {
					send(req, res, 400, { error: 'kind must be open|close|remove|remove_converted|collect_fee' })
					return
				}
				send(req, res, 200, {
					...tx,
					protocol: 'dlmm' as ProtocolId,
					submitted: false,
					mode: apiStore?.getMode() ?? null,
					contract: openGate?.contract ?? 'MANUAL_MANAGE',
					riskValidated: openGate?.riskValidated ?? false,
				})
				return
			}
			send(req, res, 404, { error: 'not found' })
		} catch (e) {
			if (e instanceof HttpValidationError) {
				send(req, res, e.status, { error: e.message, submitted: false })
				return
			}
			send(req, res, 500, { error: e instanceof Error ? e.message : String(e), submitted: false })
		}
	})
	const port = opts?.port ?? PORT
	// Loopback only. The dashboard on :5180 proxies /api/autopilot here. Do not publish 5191.
	server.listen(port, '127.0.0.1', () => {
		const bound = server.address()
		const shown = typeof bound === 'object' && bound ? bound.port : port
		console.info(`[autopilot] read/tx API http://127.0.0.1:${shown} (no signing)`)
	})
	return server
}
