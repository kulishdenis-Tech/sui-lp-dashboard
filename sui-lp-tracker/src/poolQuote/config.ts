/**
 * Phase B/C arbitrage scanner config (env-overridable).
 * Profit math stays in native units; USD is presentation-only.
 */

function envNum(name: string, fallback: number): number {
	if (typeof process === 'undefined' || !process.env) return fallback
	const raw = process.env[name]
	if (raw == null || raw.trim() === '') return fallback
	const n = Number(raw)
	return Number.isFinite(n) ? n : fallback
}

function envBool(name: string, fallback: boolean): boolean {
	if (typeof process === 'undefined' || !process.env) return fallback
	const raw = process.env[name]
	if (raw == null || raw.trim() === '') return fallback
	return /^(1|true|yes|on)$/i.test(raw.trim())
}

function envStr(name: string, fallback: string): string {
	if (typeof process === 'undefined' || !process.env) return fallback
	const raw = process.env[name]
	if (raw == null || raw.trim() === '') return fallback
	return raw.trim()
}

/** Cross-DEX pool-state skew above this → STALE. Prefers ARB_MAX_STATE_SKEW_MS. */
export const MAX_STATE_SKEW_MS = envNum(
	'ARB_MAX_STATE_SKEW_MS',
	envNum('MAX_STATE_SKEW_MS', 500),
)

/** Diagnostic notional sizes in USD (converted to SUI via cached SUI/USD). */
export const DIAGNOSTIC_USD_SIZES = [25, 100, 500, 1000] as const

/** Min DexScreener-reported liquidity USD to keep a discovered pool. */
export const MIN_DISCOVERY_LIQUIDITY_USD = envNum('MIN_DISCOVERY_LIQUIDITY_USD', 1_000)

/** Min liquidity for SUI/USDC control market pools. */
export const MIN_CONTROL_LIQUIDITY_USD = envNum('MIN_CONTROL_LIQUIDITY_USD', 50_000)

/**
 * Turbos computeSwapResultV2 tickStep (official preSwap param).
 * Default 2000 covers diagnostic $1k; too low → PARTIAL_FILL.
 */
export const TURBOS_TICK_STEP = envNum('TURBOS_TICK_STEP', 2000)

/**
 * Dry-run sender for Turbos simulation only — never a funded hot wallet key.
 */
export const SHADOW_SIMULATION_ADDRESS =
	envStr(
		'ARB_SHADOW_ADDRESS',
		'0x0000000000000000000000000000000000000000000000000000000000000001',
	)

export const ARB_JSON_OUTPUT = envBool('ARB_JSON_OUTPUT', false)

/** TTL for SUI/USD reference cache (presentation only). */
export const SUI_USD_CACHE_TTL_MS = envNum('SUI_USD_CACHE_TTL_MS', 60_000)

/** Continuous scanner target interval (ms). Fixed-cadence starts; busy → skip. */
export const ARB_SCAN_INTERVAL_MS = envNum('ARB_SCAN_INTERVAL_MS', 500)

/** Bounded concurrency for independent quote jobs (sizes / parallel routes). */
export const ARB_QUOTE_CONCURRENCY = envNum('ARB_QUOTE_CONCURRENCY', 2)

/** Log every quote line (noisy). Default compact only. */
export const ARB_LOG_ALL_QUOTES = envBool('ARB_LOG_ALL_QUOTES', false)

/** Run SUI/USDC control every N completed NS/SUI scans. */
export const ARB_CONTROL_SCAN_EVERY_N = envNum('ARB_CONTROL_SCAN_EVERY_N', 10)

/** |bps| band treated as BREAKEVEN. */
export const BREAKEVEN_BPS = envNum('BREAKEVEN_BPS', 5)

/** Consecutive scan failures before prominent WARNING. */
export const ARB_FAILURE_WARNING_THRESHOLD = envNum('ARB_FAILURE_WARNING_THRESHOLD', 5)

/** Periodic summary interval. */
export const ARB_SUMMARY_INTERVAL_MS = envNum('ARB_SUMMARY_INTERVAL_MS', 5 * 60_000)

/** Optional JSONL research logs. */
export const ARB_RESEARCH_LOG = envBool('ARB_RESEARCH_LOG', false)
export const ARB_RESEARCH_LOG_PATH = envStr('ARB_RESEARCH_LOG_PATH', './data/arbitrage')

/**
 * Relative tolerance: consumed vs requested input.
 * Diff above this → PARTIAL_FILL (1 unit or 1bp of notional, whichever larger, handled in code).
 */
export const PARTIAL_FILL_REL_TOLERANCE = envNum('ARB_PARTIAL_FILL_REL_TOLERANCE', 0.0001)

/** Control market |bps| above this → WARNING (persistent anomaly check uses this). */
export const CONTROL_ANOMALY_BPS = envNum('ARB_CONTROL_ANOMALY_BPS', 50)

/** Rolling latency sample capacity (bounded memory). */
export const LATENCY_SAMPLE_CAP = envNum('ARB_LATENCY_SAMPLE_CAP', 512)

// ── Phase D: two-stage scanner / optimizer / gas ───────────────────────────

/** Stage-1 probe notional (USD → SUI via cache). */
export const ARB_PROBE_SIZE_USD = envNum('ARB_PROBE_SIZE_USD', 25)

/**
 * Stage-2 optimizer runs when probeGrossProfitBps >= this.
 * Negative default: slightly-lossy $25 probe can still improve at other sizes.
 */
export const ARB_OPTIMIZER_TRIGGER_BPS = envNum('ARB_OPTIMIZER_TRIGGER_BPS', -20)

/** Mid-price pre-screen (diagnostics only — never final PnL). */
export const ARB_MID_PRESCREEN_ENABLED = envBool('ARB_MID_PRESCREEN_ENABLED', true)
/**
 * Skip expensive quotes when favorableMidSpreadBps < feeFloorBps - margin.
 * Larger margin → more aggressive skipping; keep moderate for research safety.
 */
export const ARB_MID_PRESCREEN_MARGIN_BPS = envNum('ARB_MID_PRESCREEN_MARGIN_BPS', 20)

/** Coarse optimizer candidates (USD). */
export const ARB_OPTIMIZER_COARSE_USD = [10, 25, 50, 100, 250, 500, 1000] as const

/** Max official/local quote evaluations per route optimization. */
export const ARB_OPTIMIZER_MAX_QUOTES = envNum('ARB_OPTIMIZER_MAX_QUOTES', 10)

/** Local refine steps around best coarse point. */
export const ARB_OPTIMIZER_REFINE_STEPS = envNum('ARB_OPTIMIZER_REFINE_STEPS', 3)

/** Stop refine when improvement < this many bps. */
export const ARB_OPTIMIZER_MIN_IMPROVEMENT_BPS = envNum('ARB_OPTIMIZER_MIN_IMPROVEMENT_BPS', 0.5)

export const ARB_GAS_CACHE_TTL_MS = envNum('ARB_GAS_CACHE_TTL_MS', 30_000)

/**
 * Conservative 2-leg CLMM gas budget in mist when dry-run PTB unavailable.
 * Source labeled in gasEstimate — not silent.
 * ~0.02 SUI typical complex PTB research placeholder; override via env.
 */
export const ARB_GAS_FALLBACK_MIST = BigInt(
	Math.floor(envNum('ARB_GAS_FALLBACK_MIST', 20_000_000)),
)

export const ARB_MIN_NET_PROFIT_USD = envNum('ARB_MIN_NET_PROFIT_USD', 0.05)
export const ARB_MIN_NET_PROFIT_BPS = envNum('ARB_MIN_NET_PROFIT_BPS', 3)

/** Cetus local calculateRates vs preSwap max allowed delta (bps of amountOut). */
export const ARB_LOCAL_QUOTE_MAX_DELTA_BPS = envNum('ARB_LOCAL_QUOTE_MAX_DELTA_BPS', 2)

/** Prefer Cetus local calculateRates after tick fetch (validated). */
export const ARB_CETUS_LOCAL_QUOTES = envBool('ARB_CETUS_LOCAL_QUOTES', true)

/** Refresh Cetus ticks at most this often (ms). */
export const ARB_CETUS_TICK_CACHE_TTL_MS = envNum('ARB_CETUS_TICK_CACHE_TTL_MS', 5_000)

/** Validate local Cetus quote against preSwap every N local quotes. */
export const ARB_CETUS_LOCAL_VALIDATE_EVERY = envNum('ARB_CETUS_LOCAL_VALIDATE_EVERY', 20)

// ── Phase E: RPC reliability + long-run research ───────────────────────────

/** Hard timeout for every RPC HTTP request (ms). */
export const ARB_RPC_TIMEOUT_MS = envNum('ARB_RPC_TIMEOUT_MS', 1500)

/** Consecutive provider failures before OPEN quarantine. */
export const ARB_RPC_FAILURES_BEFORE_QUARANTINE = envNum('ARB_RPC_FAILURES_BEFORE_QUARANTINE', 2)

/** Quarantine duration before HALF_OPEN probe (ms). */
export const ARB_RPC_QUARANTINE_MS = envNum('ARB_RPC_QUARANTINE_MS', 30_000)

/**
 * Soft deadline for a normal no-arb NS scan (ms).
 * Exceeding → SCAN_TIMEOUT; cancel optional work.
 */
export const ARB_SCAN_DEADLINE_MS = envNum('ARB_SCAN_DEADLINE_MS', 2000)

/**
 * Trigger executable $25 probe when mid spread approaches fee floor:
 * favorableMidSpreadBps >= feeFloorBps - ARB_PROBE_DISTANCE_TO_FEE_BPS
 */
export const ARB_PROBE_DISTANCE_TO_FEE_BPS = envNum('ARB_PROBE_DISTANCE_TO_FEE_BPS', 15)

/** Print RPC provider table every N ms (with summary). */
export const ARB_RPC_METRICS_INTERVAL_MS = envNum('ARB_RPC_METRICS_INTERVAL_MS', 5 * 60_000)

/** Optional second research market scan every N completed NS scans (0 = off until discovered). */
export const ARB_SECOND_MARKET_EVERY_N = envNum('ARB_SECOND_MARKET_EVERY_N', 20)

/** Min DexScreener liquidity USD for ranked cross-DEX research pairs (per pool). */
export const ARB_RANK_MIN_LIQUIDITY_USD = envNum('ARB_RANK_MIN_LIQUIDITY_USD', 5_000)

// ── Phase F2: local-first route pricing / escalation ───────────────────────

/**
 * Escalate when Stage0 estimated mid edge is within this many bps of fee floor
 * (same spirit as ARB_PROBE_DISTANCE_TO_FEE_BPS).
 */
export const ARB_F2_ESCALATE_WITHIN_BPS = envNum(
	'ARB_F2_ESCALATE_WITHIN_BPS',
	envNum('ARB_PROBE_DISTANCE_TO_FEE_BPS', 15),
)

/** Min (midEdge / feeFloor) to consider escalation when local is unavailable. */
export const ARB_F2_MIN_SPREAD_FEE_RATIO = envNum('ARB_F2_MIN_SPREAD_FEE_RATIO', 0.5)

/** Max authoritative full-route reprices per cycle evaluation. */
export const ARB_F2_MAX_AUTHORITATIVE_PER_CYCLE = envNum('ARB_F2_MAX_AUTHORITATIVE_PER_CYCLE', 1)

/** Max authoritative full-route reprices per research round (all cycles). */
export const ARB_F2_MAX_AUTHORITATIVE_PER_ROUND = envNum('ARB_F2_MAX_AUTHORITATIVE_PER_ROUND', 20)

/** Escalate if local exact route gross bps >= this (near/positive). */
export const ARB_F2_LOCAL_ESCALATE_BPS = envNum('ARB_F2_LOCAL_ESCALATE_BPS', -20)

/** Default research notional for F2 route sims (raw units of profit token — set per CLI). */
export const ARB_F2_DEFAULT_AMOUNT_USD = envNum('ARB_F2_DEFAULT_AMOUNT_USD', 25)

/** Live F2 research duration (ms). */
export const ARB_F2_RUN_MS = envNum('ARB_F2_RUN_MS', 10 * 60_000)

/** Interval between F2 research rounds (ms). */
export const ARB_F2_ROUND_INTERVAL_MS = envNum('ARB_F2_ROUND_INTERVAL_MS', 15_000)

/** Cetus local↔authoritative parity max error (bps) labeled as ok. */
export const ARB_F2_PARITY_OK_BPS = envNum('ARB_F2_PARITY_OK_BPS', 5)

// ── Phase F2.5: local CLMM snapshot cache ──────────────────────────────────

/** Max snapshot age for Stage-1 pure quotes (ms). Stale → unavailable (no fetch in quote). */
export const ARB_CLMM_SNAPSHOT_MAX_AGE_MS = envNum('ARB_CLMM_SNAPSHOT_MAX_AGE_MS', 120_000)

/** Enable Turbos Stage-1 local math (requires loaded snapshot). */
export const ARB_TURBOS_LOCAL_QUOTES = envBool('ARB_TURBOS_LOCAL_QUOTES', true)

/**
 * Promote Turbos local authority to local_exact only after parity acceptance.
 * Live F2.5 parity gate passed (0.000 bps error on 48 single-tick samples).
 */
export const ARB_TURBOS_LOCAL_EXACT = envBool('ARB_TURBOS_LOCAL_EXACT', true)

/**
 * Fraction of Stage0-passed locally-negative routes to still authoritative-sample.
 * Detects false negatives. 0.02 = 2%.
 */
export const ARB_LOCAL_NEGATIVE_AUTH_SAMPLE_RATE = envNum(
	'ARB_LOCAL_NEGATIVE_AUTH_SAMPLE_RATE',
	0.02,
)

/** Local gross bps below this counts as "negative" for sampling. */
export const ARB_LOCAL_NEGATIVE_BPS = envNum('ARB_LOCAL_NEGATIVE_BPS', -5)

/** Authoritative gross bps above this counts as false-negative when local was negative. */
export const ARB_FALSE_NEGATIVE_AUTH_BPS = envNum('ARB_FALSE_NEGATIVE_AUTH_BPS', -20)

// ── Phase F3: event-driven engine (synthetic + poll-diff; no gRPC) ─────────

/** Max pools processed concurrently (different pools). */
export const ARB_EVENT_MAX_CONCURRENCY = envNum('ARB_EVENT_MAX_CONCURRENCY', 8)

/** Max distinct pools with a pending coalesced event. */
export const ARB_EVENT_MAX_PENDING_POOLS = envNum('ARB_EVENT_MAX_PENDING_POOLS', 64)

/** Same pool always serial (must stay true for F3). */
export const ARB_EVENT_PER_POOL_SERIAL = envBool('ARB_EVENT_PER_POOL_SERIAL', true)

/**
 * Cetus local↔auth parity showed p95≈2.4 bps, max≈3.4 bps after cache refactor.
 * Escalate when local gross is within this margin of the escalate threshold
 * (avoids false-negative rejection near profitability).
 */
export const ARB_CETUS_LOCAL_UNCERTAINTY_BPS = envNum('ARB_CETUS_LOCAL_UNCERTAINTY_BPS', 4)

/** Default USD notional for event-path cycle evaluation. */
export const ARB_EVENT_AMOUNT_USD = envNum('ARB_EVENT_AMOUNT_USD', ARB_F2_DEFAULT_AMOUNT_USD)

/** Poll-diff interval (ms). */
export const ARB_EVENT_POLL_INTERVAL_MS = envNum('ARB_EVENT_POLL_INTERVAL_MS', 5_000)

/** Live F3 soak duration (ms). */
export const ARB_F3_SOAK_MS = envNum('ARB_F3_SOAK_MS', 15 * 60_000)

// ── Phase F4: gRPC checkpoint stream (arb-only; no SDK upgrade) ────────────

/** Enable gRPC checkpoint primary source. */
export const ARB_GRPC_ENABLED = envBool('ARB_GRPC_ENABLED', true)

/**
 * gRPC-Web base URL (SuiGrpcClient default transport).
 * Public Mysten endpoint is fine for research; dedicated node preferred for soak.
 */
export const ARB_GRPC_URL = (
	process.env.ARB_GRPC_URL?.trim() ||
	'https://fullnode.mainnet.sui.io:443'
)

export const ARB_GRPC_CONNECT_TIMEOUT_MS = envNum('ARB_GRPC_CONNECT_TIMEOUT_MS', 15_000)
export const ARB_GRPC_RECONNECT_MIN_MS = envNum('ARB_GRPC_RECONNECT_MIN_MS', 500)
export const ARB_GRPC_RECONNECT_MAX_MS = envNum('ARB_GRPC_RECONNECT_MAX_MS', 30_000)
/** No checkpoint for this long → stall / unhealthy. */
export const ARB_GRPC_STALL_TIMEOUT_MS = envNum('ARB_GRPC_STALL_TIMEOUT_MS', 20_000)

/** Slow reconcile while gRPC healthy (ms). Not a 30s full hot-path poll. */
export const ARB_RECONCILE_INTERVAL_MS = envNum('ARB_RECONCILE_INTERVAL_MS', 60_000)

/** Polling interval when gRPC is unhealthy (fallback). */
export const ARB_POLL_FALLBACK_INTERVAL_MS = envNum(
	'ARB_POLL_FALLBACK_INTERVAL_MS',
	ARB_EVENT_POLL_INTERVAL_MS,
)

export const ARB_F4_SMOKE_MS = envNum('ARB_F4_SMOKE_MS', 5 * 60_000)
export const ARB_F4_SOAK_MS = envNum('ARB_F4_SOAK_MS', 20 * 60_000)

// ── Phase F4.5: fast state ingestion / auth suppression ────────────────────

/** Max concurrent pool refreshes across venues (per-pool still serialized). */
export const ARB_STATE_REFRESH_MAX_CONCURRENCY = envNum('ARB_STATE_REFRESH_MAX_CONCURRENCY', 4)

/**
 * F4.7: reserved realtime refresh slots (gRPC core / dirty mark).
 * Maintenance JSON-RPC must not consume these.
 */
export const ARB_STATE_REFRESH_REALTIME_CONCURRENCY = envNum(
	'ARB_STATE_REFRESH_REALTIME_CONCURRENCY',
	ARB_STATE_REFRESH_MAX_CONCURRENCY,
)

/** Maintenance / reconcile / tick-reload concurrency (separate from realtime). */
export const ARB_STATE_REFRESH_MAINTENANCE_CONCURRENCY = envNum(
	'ARB_STATE_REFRESH_MAINTENANCE_CONCURRENCY',
	2,
)

/** Soft timeout for a single pool refresh plan (ms). */
export const ARB_STATE_REFRESH_TIMEOUT_MS = envNum('ARB_STATE_REFRESH_TIMEOUT_MS', 8_000)

/** Prefer gRPC LedgerService for hot incremental core reads. */
export const ARB_STATE_REFRESH_GRPC = envBool('ARB_STATE_REFRESH_GRPC', true)

/** Short-lived authoritative result cache TTL. */
export const ARB_AUTH_RESULT_CACHE_MS = envNum('ARB_AUTH_RESULT_CACHE_MS', 2_000)

/** Min interval before revalidating same cycle-state key. */
export const ARB_AUTH_MIN_REVALIDATE_MS = envNum('ARB_AUTH_MIN_REVALIDATE_MS', 500)

/** Local edge must move by this many bps to force revalidation inside cache TTL. */
export const ARB_AUTH_MIN_REVALIDATE_BPS_DELTA = envNum('ARB_AUTH_MIN_REVALIDATE_BPS_DELTA', 1.5)

/** Shadow-sample rate for suppressed auth (research false negatives). */
export const ARB_AUTH_SUPPRESS_SAMPLE_RATE = envNum('ARB_AUTH_SUPPRESS_SAMPLE_RATE', 0.05)

export const ARB_F45_SOAK_MS = envNum('ARB_F45_SOAK_MS', 20 * 60_000)
export const ARB_F45_REFRESH_BENCH_N = envNum('ARB_F45_REFRESH_BENCH_N', 30)

// ── Phase F4.6: realtime data-plane stabilization ──────────────────────────

/** Min gap between reconcile starts (prevents storm under provider pain). */
export const ARB_RECONCILE_MIN_INTERVAL_MS = envNum('ARB_RECONCILE_MIN_INTERVAL_MS', 30_000)

/** Max reconcile backoff after failures. */
export const ARB_RECONCILE_BACKOFF_MAX_MS = envNum('ARB_RECONCILE_BACKOFF_MAX_MS', 5 * 60_000)

/** Maintenance lane max queued jobs. */
export const ARB_MAINTENANCE_QUEUE_MAX = envNum('ARB_MAINTENANCE_QUEUE_MAX', 64)

/**
 * Auth soft suppress max age (ms). After this, always revalidate even if edge stable.
 * Default 5s — short vs Cetus ~4 bps uncertainty window.
 */
export const ARB_AUTH_MAX_SUPPRESS_MS = envNum('ARB_AUTH_MAX_SUPPRESS_MS', 5_000)

/** Alias used by shadow sampling config naming in F4.6. */
export const ARB_AUTH_SUPPRESSED_SAMPLE_RATE = envNum(
	'ARB_AUTH_SUPPRESSED_SAMPLE_RATE',
	ARB_AUTH_SUPPRESS_SAMPLE_RATE > 0 ? Math.max(ARB_AUTH_SUPPRESS_SAMPLE_RATE, 0.1) : 0.1,
)

export const ARB_AUTH_MAX_CONCURRENCY = envNum('ARB_AUTH_MAX_CONCURRENCY', 2)
export const ARB_AUTH_MAX_PER_MINUTE = envNum('ARB_AUTH_MAX_PER_MINUTE', 30)
export const ARB_AUTH_QUEUE_MAX = envNum('ARB_AUTH_QUEUE_MAX', 64)
export const ARB_AUTH_CIRCUIT_COOLDOWN_MS = envNum('ARB_AUTH_CIRCUIT_COOLDOWN_MS', 15_000)

/** Material USD delta for auth shadow comparison (research). */
export const ARB_AUTH_MATERIAL_USD_DELTA = envNum('ARB_AUTH_MATERIAL_USD_DELTA', 0.05)

export const ARB_F46_SOAK_A_MS = envNum('ARB_F46_SOAK_A_MS', 15 * 60_000)
export const ARB_F46_SOAK_B_MS = envNum('ARB_F46_SOAK_B_MS', 20 * 60_000)
export const ARB_F46_HOT_BENCH_N = envNum('ARB_F46_HOT_BENCH_N', 50)
export const ARB_F46_AUTH_ENABLED = envBool('ARB_F46_AUTH_ENABLED', true)
export const ARB_TICK_BOOTSTRAP_MAX_PAGES = envNum('ARB_TICK_BOOTSTRAP_MAX_PAGES', 8)

// ── Phase F4.7: dirty-tick decoupling ───────────────────────────────────────

/**
 * Extra negative margin (bps) required to reject locally while ticks are dirty.
 * Default 8 ≈ 2× Cetus uncertainty — keep conservative.
 */
export const ARB_DIRTY_TICK_NEGATIVE_MARGIN_BPS = envNum('ARB_DIRTY_TICK_NEGATIVE_MARGIN_BPS', 8)

/** Max age of dirty tick state before pool marked degraded (ms). */
export const ARB_TICK_DIRTY_MAX_AGE_MS = envNum('ARB_TICK_DIRTY_MAX_AGE_MS', 30_000)

/** Soft cap of indexed tick object IDs per pool (evict oldest registrations). */
export const ARB_TICK_INDEX_MAX_PER_POOL = envNum('ARB_TICK_INDEX_MAX_PER_POOL', 2_000)

export const ARB_F47_SOAK_A_MS = envNum('ARB_F47_SOAK_A_MS', 15 * 60_000)
export const ARB_F47_SOAK_B_MS = envNum('ARB_F47_SOAK_B_MS', 20 * 60_000)
export const ARB_F47_DIRTY_BENCH_N = envNum('ARB_F47_DIRTY_BENCH_N', 30)

/** Combined F5 live shadow soak duration (default 25 min). */
export const ARB_F5_SOAK_MS = envNum('ARB_F5_SOAK_MS', 25 * 60_000)

// ── Phase F5: Bluefin Spot CLMM ─────────────────────────────────────────────

/** Enable Stage-1 local Bluefin quotes (always local_estimate until parity gate). */
export const ARB_BLUEFIN_LOCAL_QUOTES = envBool('ARB_BLUEFIN_LOCAL_QUOTES', true)

/**
 * Promote Bluefin local quotes to local_exact. Keep false until parity evidence
 * (see scripts/arb-f5-bluefin-parity.ts) — do NOT flip without measured p95/p99.
 */
export const ARB_BLUEFIN_LOCAL_EXACT = envBool('ARB_BLUEFIN_LOCAL_EXACT', false)

/** Conservative TVL filter for Spot API / DexScreener discovery (USD). */
export const ARB_BLUEFIN_MIN_LIQUIDITY_USD = envNum('ARB_BLUEFIN_MIN_LIQUIDITY_USD', 50_000)

/** Half-width of tick index window around currentTick for Stage-1 loads. */
export const ARB_BLUEFIN_TICK_WINDOW = envNum('ARB_BLUEFIN_TICK_WINDOW', 8_000)

/** Max DF pages when listing Bluefin tick table (each page ≤50). */
export const ARB_BLUEFIN_TICK_MAX_PAGES = envNum('ARB_BLUEFIN_TICK_MAX_PAGES', 40)

// ── Phase F5: Momentum (MMT) CLMM ───────────────────────────────────────────

/** Enable Stage-1 local Momentum quotes (always local_estimate until parity gate). */
export const ARB_MOMENTUM_LOCAL_QUOTES = envBool('ARB_MOMENTUM_LOCAL_QUOTES', true)

/**
 * Promote Momentum local quotes to local_exact. Keep false until parity evidence
 * (see scripts/arb-f5-momentum-parity.ts) — do NOT flip without measured p95/p99.
 */
export const ARB_MOMENTUM_LOCAL_EXACT = envBool('ARB_MOMENTUM_LOCAL_EXACT', false)

/** Conservative TVL filter for MMT API discovery (USD). */
export const ARB_MOMENTUM_MIN_LIQUIDITY_USD = envNum('ARB_MOMENTUM_MIN_LIQUIDITY_USD', 50_000)

/** Half-width of tick index window around currentTick for Stage-1 loads. */
export const ARB_MOMENTUM_TICK_WINDOW = envNum('ARB_MOMENTUM_TICK_WINDOW', 8_000)

/** Max DF pages when listing Momentum tick table (each page ≤50). */
export const ARB_MOMENTUM_TICK_MAX_PAGES = envNum('ARB_MOMENTUM_TICK_MAX_PAGES', 40)

/**
 * Maintenance-only expanded tick window (TickWindowExpander / full_ticks reload).
 * Never used from quoteExactIn — network stays off the hot path.
 */
export const ARB_MOMENTUM_TICK_WINDOW_EXPANDED = envNum(
	'ARB_MOMENTUM_TICK_WINDOW_EXPANDED',
	32_000,
)

/** Maintenance-only max DF pages when expanding Momentum tick window. */
export const ARB_MOMENTUM_TICK_MAX_PAGES_EXPANDED = envNum(
	'ARB_MOMENTUM_TICK_MAX_PAGES_EXPANDED',
	80,
)

// ── Phase F5.1: quote truth + auth plane ────────────────────────────────────

/** Auth job hard timeout (ms). Must release scheduler slot. */
export const ARB_AUTH_JOB_TIMEOUT_MS = envNum('ARB_AUTH_JOB_TIMEOUT_MS', 15_000)

/**
 * Sample rate for uncertainty-rejected raw-positive candidates through auth (FN probe).
 * 0 disables sampling.
 */
export const ARB_TRUTH_FILTER_SAMPLE_RATE = envNum('ARB_TRUTH_FILTER_SAMPLE_RATE', 0.1)

/** Enable truth-aware Stage1 conservative filter. */
export const ARB_TRUTH_AWARE_FILTER = envBool('ARB_TRUTH_AWARE_FILTER', true)

/** Path to quote-uncertainty calibration artifact (relative or absolute). */
export const ARB_QUOTE_UNCERTAINTY_PATH = envStr(
	'ARB_QUOTE_UNCERTAINTY_PATH',
	'./data/arbitrage/calibration/quote-uncertainty.json',
)

/** Combined F5.1 long opportunity shadow duration (default 60 min). */
export const ARB_F51_SHADOW_MS = envNum('ARB_F51_SHADOW_MS', 60 * 60_000)

/** F5.1 auth stability soak duration (default 25 min). */
export const ARB_F51_AUTH_SOAK_MS = envNum('ARB_F51_AUTH_SOAK_MS', 25 * 60_000)

/**
 * F5.2 long opportunity shadow duration (default 120 min).
 * Script clamps to a practical minimum of 60 min.
 */
export const ARB_F52_SHADOW_MS = envNum('ARB_F52_SHADOW_MS', 120 * 60_000)

/** Min authoritative gross bps to count as truth-filter false negative. */
export const ARB_TRUTH_FILTER_FN_BPS = envNum('ARB_TRUTH_FILTER_FN_BPS', 0)
