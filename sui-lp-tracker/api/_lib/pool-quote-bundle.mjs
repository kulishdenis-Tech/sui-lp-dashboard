var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/poolQuote/config.ts
var config_exports = {};
__export(config_exports, {
  ARB_AUTH_CIRCUIT_COOLDOWN_MS: () => ARB_AUTH_CIRCUIT_COOLDOWN_MS,
  ARB_AUTH_JOB_TIMEOUT_MS: () => ARB_AUTH_JOB_TIMEOUT_MS,
  ARB_AUTH_MATERIAL_USD_DELTA: () => ARB_AUTH_MATERIAL_USD_DELTA,
  ARB_AUTH_MAX_CONCURRENCY: () => ARB_AUTH_MAX_CONCURRENCY,
  ARB_AUTH_MAX_PER_MINUTE: () => ARB_AUTH_MAX_PER_MINUTE,
  ARB_AUTH_MAX_SUPPRESS_MS: () => ARB_AUTH_MAX_SUPPRESS_MS,
  ARB_AUTH_MIN_REVALIDATE_BPS_DELTA: () => ARB_AUTH_MIN_REVALIDATE_BPS_DELTA,
  ARB_AUTH_MIN_REVALIDATE_MS: () => ARB_AUTH_MIN_REVALIDATE_MS,
  ARB_AUTH_QUEUE_MAX: () => ARB_AUTH_QUEUE_MAX,
  ARB_AUTH_RESULT_CACHE_MS: () => ARB_AUTH_RESULT_CACHE_MS,
  ARB_AUTH_SUPPRESSED_SAMPLE_RATE: () => ARB_AUTH_SUPPRESSED_SAMPLE_RATE,
  ARB_AUTH_SUPPRESS_SAMPLE_RATE: () => ARB_AUTH_SUPPRESS_SAMPLE_RATE,
  ARB_BLUEFIN_LOCAL_EXACT: () => ARB_BLUEFIN_LOCAL_EXACT,
  ARB_BLUEFIN_LOCAL_QUOTES: () => ARB_BLUEFIN_LOCAL_QUOTES,
  ARB_BLUEFIN_MIN_LIQUIDITY_USD: () => ARB_BLUEFIN_MIN_LIQUIDITY_USD,
  ARB_BLUEFIN_TICK_MAX_PAGES: () => ARB_BLUEFIN_TICK_MAX_PAGES,
  ARB_BLUEFIN_TICK_WINDOW: () => ARB_BLUEFIN_TICK_WINDOW,
  ARB_CETUS_LOCAL_QUOTES: () => ARB_CETUS_LOCAL_QUOTES,
  ARB_CETUS_LOCAL_UNCERTAINTY_BPS: () => ARB_CETUS_LOCAL_UNCERTAINTY_BPS,
  ARB_CETUS_LOCAL_VALIDATE_EVERY: () => ARB_CETUS_LOCAL_VALIDATE_EVERY,
  ARB_CETUS_TICK_CACHE_TTL_MS: () => ARB_CETUS_TICK_CACHE_TTL_MS,
  ARB_CLMM_SNAPSHOT_MAX_AGE_MS: () => ARB_CLMM_SNAPSHOT_MAX_AGE_MS,
  ARB_CONTROL_SCAN_EVERY_N: () => ARB_CONTROL_SCAN_EVERY_N,
  ARB_DIRTY_TICK_NEGATIVE_MARGIN_BPS: () => ARB_DIRTY_TICK_NEGATIVE_MARGIN_BPS,
  ARB_EVENT_AMOUNT_USD: () => ARB_EVENT_AMOUNT_USD,
  ARB_EVENT_MAX_CONCURRENCY: () => ARB_EVENT_MAX_CONCURRENCY,
  ARB_EVENT_MAX_PENDING_POOLS: () => ARB_EVENT_MAX_PENDING_POOLS,
  ARB_EVENT_PER_POOL_SERIAL: () => ARB_EVENT_PER_POOL_SERIAL,
  ARB_EVENT_POLL_INTERVAL_MS: () => ARB_EVENT_POLL_INTERVAL_MS,
  ARB_F2_DEFAULT_AMOUNT_USD: () => ARB_F2_DEFAULT_AMOUNT_USD,
  ARB_F2_ESCALATE_WITHIN_BPS: () => ARB_F2_ESCALATE_WITHIN_BPS,
  ARB_F2_LOCAL_ESCALATE_BPS: () => ARB_F2_LOCAL_ESCALATE_BPS,
  ARB_F2_MAX_AUTHORITATIVE_PER_CYCLE: () => ARB_F2_MAX_AUTHORITATIVE_PER_CYCLE,
  ARB_F2_MAX_AUTHORITATIVE_PER_ROUND: () => ARB_F2_MAX_AUTHORITATIVE_PER_ROUND,
  ARB_F2_MIN_SPREAD_FEE_RATIO: () => ARB_F2_MIN_SPREAD_FEE_RATIO,
  ARB_F2_PARITY_OK_BPS: () => ARB_F2_PARITY_OK_BPS,
  ARB_F2_ROUND_INTERVAL_MS: () => ARB_F2_ROUND_INTERVAL_MS,
  ARB_F2_RUN_MS: () => ARB_F2_RUN_MS,
  ARB_F3_SOAK_MS: () => ARB_F3_SOAK_MS,
  ARB_F45_REFRESH_BENCH_N: () => ARB_F45_REFRESH_BENCH_N,
  ARB_F45_SOAK_MS: () => ARB_F45_SOAK_MS,
  ARB_F46_AUTH_ENABLED: () => ARB_F46_AUTH_ENABLED,
  ARB_F46_HOT_BENCH_N: () => ARB_F46_HOT_BENCH_N,
  ARB_F46_SOAK_A_MS: () => ARB_F46_SOAK_A_MS,
  ARB_F46_SOAK_B_MS: () => ARB_F46_SOAK_B_MS,
  ARB_F47_DIRTY_BENCH_N: () => ARB_F47_DIRTY_BENCH_N,
  ARB_F47_SOAK_A_MS: () => ARB_F47_SOAK_A_MS,
  ARB_F47_SOAK_B_MS: () => ARB_F47_SOAK_B_MS,
  ARB_F4_SMOKE_MS: () => ARB_F4_SMOKE_MS,
  ARB_F4_SOAK_MS: () => ARB_F4_SOAK_MS,
  ARB_F51_AUTH_SOAK_MS: () => ARB_F51_AUTH_SOAK_MS,
  ARB_F51_SHADOW_MS: () => ARB_F51_SHADOW_MS,
  ARB_F52_SHADOW_MS: () => ARB_F52_SHADOW_MS,
  ARB_F5_SOAK_MS: () => ARB_F5_SOAK_MS,
  ARB_FAILURE_WARNING_THRESHOLD: () => ARB_FAILURE_WARNING_THRESHOLD,
  ARB_FALSE_NEGATIVE_AUTH_BPS: () => ARB_FALSE_NEGATIVE_AUTH_BPS,
  ARB_GAS_CACHE_TTL_MS: () => ARB_GAS_CACHE_TTL_MS,
  ARB_GAS_FALLBACK_MIST: () => ARB_GAS_FALLBACK_MIST,
  ARB_GRPC_CONNECT_TIMEOUT_MS: () => ARB_GRPC_CONNECT_TIMEOUT_MS,
  ARB_GRPC_ENABLED: () => ARB_GRPC_ENABLED,
  ARB_GRPC_RECONNECT_MAX_MS: () => ARB_GRPC_RECONNECT_MAX_MS,
  ARB_GRPC_RECONNECT_MIN_MS: () => ARB_GRPC_RECONNECT_MIN_MS,
  ARB_GRPC_STALL_TIMEOUT_MS: () => ARB_GRPC_STALL_TIMEOUT_MS,
  ARB_GRPC_URL: () => ARB_GRPC_URL,
  ARB_JSON_OUTPUT: () => ARB_JSON_OUTPUT,
  ARB_LOCAL_NEGATIVE_AUTH_SAMPLE_RATE: () => ARB_LOCAL_NEGATIVE_AUTH_SAMPLE_RATE,
  ARB_LOCAL_NEGATIVE_BPS: () => ARB_LOCAL_NEGATIVE_BPS,
  ARB_LOCAL_QUOTE_MAX_DELTA_BPS: () => ARB_LOCAL_QUOTE_MAX_DELTA_BPS,
  ARB_LOG_ALL_QUOTES: () => ARB_LOG_ALL_QUOTES,
  ARB_MAINTENANCE_QUEUE_MAX: () => ARB_MAINTENANCE_QUEUE_MAX,
  ARB_MID_PRESCREEN_ENABLED: () => ARB_MID_PRESCREEN_ENABLED,
  ARB_MID_PRESCREEN_MARGIN_BPS: () => ARB_MID_PRESCREEN_MARGIN_BPS,
  ARB_MIN_NET_PROFIT_BPS: () => ARB_MIN_NET_PROFIT_BPS,
  ARB_MIN_NET_PROFIT_USD: () => ARB_MIN_NET_PROFIT_USD,
  ARB_MOMENTUM_LOCAL_EXACT: () => ARB_MOMENTUM_LOCAL_EXACT,
  ARB_MOMENTUM_LOCAL_QUOTES: () => ARB_MOMENTUM_LOCAL_QUOTES,
  ARB_MOMENTUM_MIN_LIQUIDITY_USD: () => ARB_MOMENTUM_MIN_LIQUIDITY_USD,
  ARB_MOMENTUM_TICK_MAX_PAGES: () => ARB_MOMENTUM_TICK_MAX_PAGES,
  ARB_MOMENTUM_TICK_MAX_PAGES_EXPANDED: () => ARB_MOMENTUM_TICK_MAX_PAGES_EXPANDED,
  ARB_MOMENTUM_TICK_WINDOW: () => ARB_MOMENTUM_TICK_WINDOW,
  ARB_MOMENTUM_TICK_WINDOW_EXPANDED: () => ARB_MOMENTUM_TICK_WINDOW_EXPANDED,
  ARB_OPTIMIZER_COARSE_USD: () => ARB_OPTIMIZER_COARSE_USD,
  ARB_OPTIMIZER_MAX_QUOTES: () => ARB_OPTIMIZER_MAX_QUOTES,
  ARB_OPTIMIZER_MIN_IMPROVEMENT_BPS: () => ARB_OPTIMIZER_MIN_IMPROVEMENT_BPS,
  ARB_OPTIMIZER_REFINE_STEPS: () => ARB_OPTIMIZER_REFINE_STEPS,
  ARB_OPTIMIZER_TRIGGER_BPS: () => ARB_OPTIMIZER_TRIGGER_BPS,
  ARB_POLL_FALLBACK_INTERVAL_MS: () => ARB_POLL_FALLBACK_INTERVAL_MS,
  ARB_PROBE_DISTANCE_TO_FEE_BPS: () => ARB_PROBE_DISTANCE_TO_FEE_BPS,
  ARB_PROBE_SIZE_USD: () => ARB_PROBE_SIZE_USD,
  ARB_QUOTE_CONCURRENCY: () => ARB_QUOTE_CONCURRENCY,
  ARB_QUOTE_UNCERTAINTY_PATH: () => ARB_QUOTE_UNCERTAINTY_PATH,
  ARB_RANK_MIN_LIQUIDITY_USD: () => ARB_RANK_MIN_LIQUIDITY_USD,
  ARB_RECONCILE_BACKOFF_MAX_MS: () => ARB_RECONCILE_BACKOFF_MAX_MS,
  ARB_RECONCILE_INTERVAL_MS: () => ARB_RECONCILE_INTERVAL_MS,
  ARB_RECONCILE_MIN_INTERVAL_MS: () => ARB_RECONCILE_MIN_INTERVAL_MS,
  ARB_RESEARCH_LOG: () => ARB_RESEARCH_LOG,
  ARB_RESEARCH_LOG_PATH: () => ARB_RESEARCH_LOG_PATH,
  ARB_RPC_FAILURES_BEFORE_QUARANTINE: () => ARB_RPC_FAILURES_BEFORE_QUARANTINE,
  ARB_RPC_METRICS_INTERVAL_MS: () => ARB_RPC_METRICS_INTERVAL_MS,
  ARB_RPC_QUARANTINE_MS: () => ARB_RPC_QUARANTINE_MS,
  ARB_RPC_TIMEOUT_MS: () => ARB_RPC_TIMEOUT_MS,
  ARB_SCAN_DEADLINE_MS: () => ARB_SCAN_DEADLINE_MS,
  ARB_SCAN_INTERVAL_MS: () => ARB_SCAN_INTERVAL_MS,
  ARB_SECOND_MARKET_EVERY_N: () => ARB_SECOND_MARKET_EVERY_N,
  ARB_STATE_REFRESH_GRPC: () => ARB_STATE_REFRESH_GRPC,
  ARB_STATE_REFRESH_MAINTENANCE_CONCURRENCY: () => ARB_STATE_REFRESH_MAINTENANCE_CONCURRENCY,
  ARB_STATE_REFRESH_MAX_CONCURRENCY: () => ARB_STATE_REFRESH_MAX_CONCURRENCY,
  ARB_STATE_REFRESH_REALTIME_CONCURRENCY: () => ARB_STATE_REFRESH_REALTIME_CONCURRENCY,
  ARB_STATE_REFRESH_TIMEOUT_MS: () => ARB_STATE_REFRESH_TIMEOUT_MS,
  ARB_SUMMARY_INTERVAL_MS: () => ARB_SUMMARY_INTERVAL_MS,
  ARB_TICK_BOOTSTRAP_MAX_PAGES: () => ARB_TICK_BOOTSTRAP_MAX_PAGES,
  ARB_TICK_DIRTY_MAX_AGE_MS: () => ARB_TICK_DIRTY_MAX_AGE_MS,
  ARB_TICK_INDEX_MAX_PER_POOL: () => ARB_TICK_INDEX_MAX_PER_POOL,
  ARB_TRUTH_AWARE_FILTER: () => ARB_TRUTH_AWARE_FILTER,
  ARB_TRUTH_FILTER_FN_BPS: () => ARB_TRUTH_FILTER_FN_BPS,
  ARB_TRUTH_FILTER_SAMPLE_RATE: () => ARB_TRUTH_FILTER_SAMPLE_RATE,
  ARB_TURBOS_LOCAL_EXACT: () => ARB_TURBOS_LOCAL_EXACT,
  ARB_TURBOS_LOCAL_QUOTES: () => ARB_TURBOS_LOCAL_QUOTES,
  BREAKEVEN_BPS: () => BREAKEVEN_BPS,
  CONTROL_ANOMALY_BPS: () => CONTROL_ANOMALY_BPS,
  DIAGNOSTIC_USD_SIZES: () => DIAGNOSTIC_USD_SIZES,
  LATENCY_SAMPLE_CAP: () => LATENCY_SAMPLE_CAP,
  MAX_STATE_SKEW_MS: () => MAX_STATE_SKEW_MS,
  MIN_CONTROL_LIQUIDITY_USD: () => MIN_CONTROL_LIQUIDITY_USD,
  MIN_DISCOVERY_LIQUIDITY_USD: () => MIN_DISCOVERY_LIQUIDITY_USD,
  PARTIAL_FILL_REL_TOLERANCE: () => PARTIAL_FILL_REL_TOLERANCE,
  SHADOW_SIMULATION_ADDRESS: () => SHADOW_SIMULATION_ADDRESS,
  SUI_USD_CACHE_TTL_MS: () => SUI_USD_CACHE_TTL_MS,
  TURBOS_TICK_STEP: () => TURBOS_TICK_STEP
});
function envNum(name, fallback) {
  if (typeof process === "undefined" || !process.env) return fallback;
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
function envBool(name, fallback) {
  if (typeof process === "undefined" || !process.env) return fallback;
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}
function envStr(name, fallback) {
  if (typeof process === "undefined" || !process.env) return fallback;
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return raw.trim();
}
var MAX_STATE_SKEW_MS, DIAGNOSTIC_USD_SIZES, MIN_DISCOVERY_LIQUIDITY_USD, MIN_CONTROL_LIQUIDITY_USD, TURBOS_TICK_STEP, SHADOW_SIMULATION_ADDRESS, ARB_JSON_OUTPUT, SUI_USD_CACHE_TTL_MS, ARB_SCAN_INTERVAL_MS, ARB_QUOTE_CONCURRENCY, ARB_LOG_ALL_QUOTES, ARB_CONTROL_SCAN_EVERY_N, BREAKEVEN_BPS, ARB_FAILURE_WARNING_THRESHOLD, ARB_SUMMARY_INTERVAL_MS, ARB_RESEARCH_LOG, ARB_RESEARCH_LOG_PATH, PARTIAL_FILL_REL_TOLERANCE, CONTROL_ANOMALY_BPS, LATENCY_SAMPLE_CAP, ARB_PROBE_SIZE_USD, ARB_OPTIMIZER_TRIGGER_BPS, ARB_MID_PRESCREEN_ENABLED, ARB_MID_PRESCREEN_MARGIN_BPS, ARB_OPTIMIZER_COARSE_USD, ARB_OPTIMIZER_MAX_QUOTES, ARB_OPTIMIZER_REFINE_STEPS, ARB_OPTIMIZER_MIN_IMPROVEMENT_BPS, ARB_GAS_CACHE_TTL_MS, ARB_GAS_FALLBACK_MIST, ARB_MIN_NET_PROFIT_USD, ARB_MIN_NET_PROFIT_BPS, ARB_LOCAL_QUOTE_MAX_DELTA_BPS, ARB_CETUS_LOCAL_QUOTES, ARB_CETUS_TICK_CACHE_TTL_MS, ARB_CETUS_LOCAL_VALIDATE_EVERY, ARB_RPC_TIMEOUT_MS, ARB_RPC_FAILURES_BEFORE_QUARANTINE, ARB_RPC_QUARANTINE_MS, ARB_SCAN_DEADLINE_MS, ARB_PROBE_DISTANCE_TO_FEE_BPS, ARB_RPC_METRICS_INTERVAL_MS, ARB_SECOND_MARKET_EVERY_N, ARB_RANK_MIN_LIQUIDITY_USD, ARB_F2_ESCALATE_WITHIN_BPS, ARB_F2_MIN_SPREAD_FEE_RATIO, ARB_F2_MAX_AUTHORITATIVE_PER_CYCLE, ARB_F2_MAX_AUTHORITATIVE_PER_ROUND, ARB_F2_LOCAL_ESCALATE_BPS, ARB_F2_DEFAULT_AMOUNT_USD, ARB_F2_RUN_MS, ARB_F2_ROUND_INTERVAL_MS, ARB_F2_PARITY_OK_BPS, ARB_CLMM_SNAPSHOT_MAX_AGE_MS, ARB_TURBOS_LOCAL_QUOTES, ARB_TURBOS_LOCAL_EXACT, ARB_LOCAL_NEGATIVE_AUTH_SAMPLE_RATE, ARB_LOCAL_NEGATIVE_BPS, ARB_FALSE_NEGATIVE_AUTH_BPS, ARB_EVENT_MAX_CONCURRENCY, ARB_EVENT_MAX_PENDING_POOLS, ARB_EVENT_PER_POOL_SERIAL, ARB_CETUS_LOCAL_UNCERTAINTY_BPS, ARB_EVENT_AMOUNT_USD, ARB_EVENT_POLL_INTERVAL_MS, ARB_F3_SOAK_MS, ARB_GRPC_ENABLED, ARB_GRPC_URL, ARB_GRPC_CONNECT_TIMEOUT_MS, ARB_GRPC_RECONNECT_MIN_MS, ARB_GRPC_RECONNECT_MAX_MS, ARB_GRPC_STALL_TIMEOUT_MS, ARB_RECONCILE_INTERVAL_MS, ARB_POLL_FALLBACK_INTERVAL_MS, ARB_F4_SMOKE_MS, ARB_F4_SOAK_MS, ARB_STATE_REFRESH_MAX_CONCURRENCY, ARB_STATE_REFRESH_REALTIME_CONCURRENCY, ARB_STATE_REFRESH_MAINTENANCE_CONCURRENCY, ARB_STATE_REFRESH_TIMEOUT_MS, ARB_STATE_REFRESH_GRPC, ARB_AUTH_RESULT_CACHE_MS, ARB_AUTH_MIN_REVALIDATE_MS, ARB_AUTH_MIN_REVALIDATE_BPS_DELTA, ARB_AUTH_SUPPRESS_SAMPLE_RATE, ARB_F45_SOAK_MS, ARB_F45_REFRESH_BENCH_N, ARB_RECONCILE_MIN_INTERVAL_MS, ARB_RECONCILE_BACKOFF_MAX_MS, ARB_MAINTENANCE_QUEUE_MAX, ARB_AUTH_MAX_SUPPRESS_MS, ARB_AUTH_SUPPRESSED_SAMPLE_RATE, ARB_AUTH_MAX_CONCURRENCY, ARB_AUTH_MAX_PER_MINUTE, ARB_AUTH_QUEUE_MAX, ARB_AUTH_CIRCUIT_COOLDOWN_MS, ARB_AUTH_MATERIAL_USD_DELTA, ARB_F46_SOAK_A_MS, ARB_F46_SOAK_B_MS, ARB_F46_HOT_BENCH_N, ARB_F46_AUTH_ENABLED, ARB_TICK_BOOTSTRAP_MAX_PAGES, ARB_DIRTY_TICK_NEGATIVE_MARGIN_BPS, ARB_TICK_DIRTY_MAX_AGE_MS, ARB_TICK_INDEX_MAX_PER_POOL, ARB_F47_SOAK_A_MS, ARB_F47_SOAK_B_MS, ARB_F47_DIRTY_BENCH_N, ARB_F5_SOAK_MS, ARB_BLUEFIN_LOCAL_QUOTES, ARB_BLUEFIN_LOCAL_EXACT, ARB_BLUEFIN_MIN_LIQUIDITY_USD, ARB_BLUEFIN_TICK_WINDOW, ARB_BLUEFIN_TICK_MAX_PAGES, ARB_MOMENTUM_LOCAL_QUOTES, ARB_MOMENTUM_LOCAL_EXACT, ARB_MOMENTUM_MIN_LIQUIDITY_USD, ARB_MOMENTUM_TICK_WINDOW, ARB_MOMENTUM_TICK_MAX_PAGES, ARB_MOMENTUM_TICK_WINDOW_EXPANDED, ARB_MOMENTUM_TICK_MAX_PAGES_EXPANDED, ARB_AUTH_JOB_TIMEOUT_MS, ARB_TRUTH_FILTER_SAMPLE_RATE, ARB_TRUTH_AWARE_FILTER, ARB_QUOTE_UNCERTAINTY_PATH, ARB_F51_SHADOW_MS, ARB_F51_AUTH_SOAK_MS, ARB_F52_SHADOW_MS, ARB_TRUTH_FILTER_FN_BPS;
var init_config = __esm({
  "src/poolQuote/config.ts"() {
    MAX_STATE_SKEW_MS = envNum(
      "ARB_MAX_STATE_SKEW_MS",
      envNum("MAX_STATE_SKEW_MS", 500)
    );
    DIAGNOSTIC_USD_SIZES = [25, 100, 500, 1e3];
    MIN_DISCOVERY_LIQUIDITY_USD = envNum("MIN_DISCOVERY_LIQUIDITY_USD", 1e3);
    MIN_CONTROL_LIQUIDITY_USD = envNum("MIN_CONTROL_LIQUIDITY_USD", 5e4);
    TURBOS_TICK_STEP = envNum("TURBOS_TICK_STEP", 2e3);
    SHADOW_SIMULATION_ADDRESS = envStr(
      "ARB_SHADOW_ADDRESS",
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    );
    ARB_JSON_OUTPUT = envBool("ARB_JSON_OUTPUT", false);
    SUI_USD_CACHE_TTL_MS = envNum("SUI_USD_CACHE_TTL_MS", 6e4);
    ARB_SCAN_INTERVAL_MS = envNum("ARB_SCAN_INTERVAL_MS", 500);
    ARB_QUOTE_CONCURRENCY = envNum("ARB_QUOTE_CONCURRENCY", 2);
    ARB_LOG_ALL_QUOTES = envBool("ARB_LOG_ALL_QUOTES", false);
    ARB_CONTROL_SCAN_EVERY_N = envNum("ARB_CONTROL_SCAN_EVERY_N", 10);
    BREAKEVEN_BPS = envNum("BREAKEVEN_BPS", 5);
    ARB_FAILURE_WARNING_THRESHOLD = envNum("ARB_FAILURE_WARNING_THRESHOLD", 5);
    ARB_SUMMARY_INTERVAL_MS = envNum("ARB_SUMMARY_INTERVAL_MS", 5 * 6e4);
    ARB_RESEARCH_LOG = envBool("ARB_RESEARCH_LOG", false);
    ARB_RESEARCH_LOG_PATH = envStr("ARB_RESEARCH_LOG_PATH", "./data/arbitrage");
    PARTIAL_FILL_REL_TOLERANCE = envNum("ARB_PARTIAL_FILL_REL_TOLERANCE", 1e-4);
    CONTROL_ANOMALY_BPS = envNum("ARB_CONTROL_ANOMALY_BPS", 50);
    LATENCY_SAMPLE_CAP = envNum("ARB_LATENCY_SAMPLE_CAP", 512);
    ARB_PROBE_SIZE_USD = envNum("ARB_PROBE_SIZE_USD", 25);
    ARB_OPTIMIZER_TRIGGER_BPS = envNum("ARB_OPTIMIZER_TRIGGER_BPS", -20);
    ARB_MID_PRESCREEN_ENABLED = envBool("ARB_MID_PRESCREEN_ENABLED", true);
    ARB_MID_PRESCREEN_MARGIN_BPS = envNum("ARB_MID_PRESCREEN_MARGIN_BPS", 20);
    ARB_OPTIMIZER_COARSE_USD = [10, 25, 50, 100, 250, 500, 1e3];
    ARB_OPTIMIZER_MAX_QUOTES = envNum("ARB_OPTIMIZER_MAX_QUOTES", 10);
    ARB_OPTIMIZER_REFINE_STEPS = envNum("ARB_OPTIMIZER_REFINE_STEPS", 3);
    ARB_OPTIMIZER_MIN_IMPROVEMENT_BPS = envNum("ARB_OPTIMIZER_MIN_IMPROVEMENT_BPS", 0.5);
    ARB_GAS_CACHE_TTL_MS = envNum("ARB_GAS_CACHE_TTL_MS", 3e4);
    ARB_GAS_FALLBACK_MIST = BigInt(
      Math.floor(envNum("ARB_GAS_FALLBACK_MIST", 2e7))
    );
    ARB_MIN_NET_PROFIT_USD = envNum("ARB_MIN_NET_PROFIT_USD", 0.05);
    ARB_MIN_NET_PROFIT_BPS = envNum("ARB_MIN_NET_PROFIT_BPS", 3);
    ARB_LOCAL_QUOTE_MAX_DELTA_BPS = envNum("ARB_LOCAL_QUOTE_MAX_DELTA_BPS", 2);
    ARB_CETUS_LOCAL_QUOTES = envBool("ARB_CETUS_LOCAL_QUOTES", true);
    ARB_CETUS_TICK_CACHE_TTL_MS = envNum("ARB_CETUS_TICK_CACHE_TTL_MS", 5e3);
    ARB_CETUS_LOCAL_VALIDATE_EVERY = envNum("ARB_CETUS_LOCAL_VALIDATE_EVERY", 20);
    ARB_RPC_TIMEOUT_MS = envNum("ARB_RPC_TIMEOUT_MS", 1500);
    ARB_RPC_FAILURES_BEFORE_QUARANTINE = envNum("ARB_RPC_FAILURES_BEFORE_QUARANTINE", 2);
    ARB_RPC_QUARANTINE_MS = envNum("ARB_RPC_QUARANTINE_MS", 3e4);
    ARB_SCAN_DEADLINE_MS = envNum("ARB_SCAN_DEADLINE_MS", 2e3);
    ARB_PROBE_DISTANCE_TO_FEE_BPS = envNum("ARB_PROBE_DISTANCE_TO_FEE_BPS", 15);
    ARB_RPC_METRICS_INTERVAL_MS = envNum("ARB_RPC_METRICS_INTERVAL_MS", 5 * 6e4);
    ARB_SECOND_MARKET_EVERY_N = envNum("ARB_SECOND_MARKET_EVERY_N", 20);
    ARB_RANK_MIN_LIQUIDITY_USD = envNum("ARB_RANK_MIN_LIQUIDITY_USD", 5e3);
    ARB_F2_ESCALATE_WITHIN_BPS = envNum(
      "ARB_F2_ESCALATE_WITHIN_BPS",
      envNum("ARB_PROBE_DISTANCE_TO_FEE_BPS", 15)
    );
    ARB_F2_MIN_SPREAD_FEE_RATIO = envNum("ARB_F2_MIN_SPREAD_FEE_RATIO", 0.5);
    ARB_F2_MAX_AUTHORITATIVE_PER_CYCLE = envNum("ARB_F2_MAX_AUTHORITATIVE_PER_CYCLE", 1);
    ARB_F2_MAX_AUTHORITATIVE_PER_ROUND = envNum("ARB_F2_MAX_AUTHORITATIVE_PER_ROUND", 20);
    ARB_F2_LOCAL_ESCALATE_BPS = envNum("ARB_F2_LOCAL_ESCALATE_BPS", -20);
    ARB_F2_DEFAULT_AMOUNT_USD = envNum("ARB_F2_DEFAULT_AMOUNT_USD", 25);
    ARB_F2_RUN_MS = envNum("ARB_F2_RUN_MS", 10 * 6e4);
    ARB_F2_ROUND_INTERVAL_MS = envNum("ARB_F2_ROUND_INTERVAL_MS", 15e3);
    ARB_F2_PARITY_OK_BPS = envNum("ARB_F2_PARITY_OK_BPS", 5);
    ARB_CLMM_SNAPSHOT_MAX_AGE_MS = envNum("ARB_CLMM_SNAPSHOT_MAX_AGE_MS", 12e4);
    ARB_TURBOS_LOCAL_QUOTES = envBool("ARB_TURBOS_LOCAL_QUOTES", true);
    ARB_TURBOS_LOCAL_EXACT = envBool("ARB_TURBOS_LOCAL_EXACT", true);
    ARB_LOCAL_NEGATIVE_AUTH_SAMPLE_RATE = envNum(
      "ARB_LOCAL_NEGATIVE_AUTH_SAMPLE_RATE",
      0.02
    );
    ARB_LOCAL_NEGATIVE_BPS = envNum("ARB_LOCAL_NEGATIVE_BPS", -5);
    ARB_FALSE_NEGATIVE_AUTH_BPS = envNum("ARB_FALSE_NEGATIVE_AUTH_BPS", -20);
    ARB_EVENT_MAX_CONCURRENCY = envNum("ARB_EVENT_MAX_CONCURRENCY", 8);
    ARB_EVENT_MAX_PENDING_POOLS = envNum("ARB_EVENT_MAX_PENDING_POOLS", 64);
    ARB_EVENT_PER_POOL_SERIAL = envBool("ARB_EVENT_PER_POOL_SERIAL", true);
    ARB_CETUS_LOCAL_UNCERTAINTY_BPS = envNum("ARB_CETUS_LOCAL_UNCERTAINTY_BPS", 4);
    ARB_EVENT_AMOUNT_USD = envNum("ARB_EVENT_AMOUNT_USD", ARB_F2_DEFAULT_AMOUNT_USD);
    ARB_EVENT_POLL_INTERVAL_MS = envNum("ARB_EVENT_POLL_INTERVAL_MS", 5e3);
    ARB_F3_SOAK_MS = envNum("ARB_F3_SOAK_MS", 15 * 6e4);
    ARB_GRPC_ENABLED = envBool("ARB_GRPC_ENABLED", true);
    ARB_GRPC_URL = process.env.ARB_GRPC_URL?.trim() || "https://fullnode.mainnet.sui.io:443";
    ARB_GRPC_CONNECT_TIMEOUT_MS = envNum("ARB_GRPC_CONNECT_TIMEOUT_MS", 15e3);
    ARB_GRPC_RECONNECT_MIN_MS = envNum("ARB_GRPC_RECONNECT_MIN_MS", 500);
    ARB_GRPC_RECONNECT_MAX_MS = envNum("ARB_GRPC_RECONNECT_MAX_MS", 3e4);
    ARB_GRPC_STALL_TIMEOUT_MS = envNum("ARB_GRPC_STALL_TIMEOUT_MS", 2e4);
    ARB_RECONCILE_INTERVAL_MS = envNum("ARB_RECONCILE_INTERVAL_MS", 6e4);
    ARB_POLL_FALLBACK_INTERVAL_MS = envNum(
      "ARB_POLL_FALLBACK_INTERVAL_MS",
      ARB_EVENT_POLL_INTERVAL_MS
    );
    ARB_F4_SMOKE_MS = envNum("ARB_F4_SMOKE_MS", 5 * 6e4);
    ARB_F4_SOAK_MS = envNum("ARB_F4_SOAK_MS", 20 * 6e4);
    ARB_STATE_REFRESH_MAX_CONCURRENCY = envNum("ARB_STATE_REFRESH_MAX_CONCURRENCY", 4);
    ARB_STATE_REFRESH_REALTIME_CONCURRENCY = envNum(
      "ARB_STATE_REFRESH_REALTIME_CONCURRENCY",
      ARB_STATE_REFRESH_MAX_CONCURRENCY
    );
    ARB_STATE_REFRESH_MAINTENANCE_CONCURRENCY = envNum(
      "ARB_STATE_REFRESH_MAINTENANCE_CONCURRENCY",
      2
    );
    ARB_STATE_REFRESH_TIMEOUT_MS = envNum("ARB_STATE_REFRESH_TIMEOUT_MS", 8e3);
    ARB_STATE_REFRESH_GRPC = envBool("ARB_STATE_REFRESH_GRPC", true);
    ARB_AUTH_RESULT_CACHE_MS = envNum("ARB_AUTH_RESULT_CACHE_MS", 2e3);
    ARB_AUTH_MIN_REVALIDATE_MS = envNum("ARB_AUTH_MIN_REVALIDATE_MS", 500);
    ARB_AUTH_MIN_REVALIDATE_BPS_DELTA = envNum("ARB_AUTH_MIN_REVALIDATE_BPS_DELTA", 1.5);
    ARB_AUTH_SUPPRESS_SAMPLE_RATE = envNum("ARB_AUTH_SUPPRESS_SAMPLE_RATE", 0.05);
    ARB_F45_SOAK_MS = envNum("ARB_F45_SOAK_MS", 20 * 6e4);
    ARB_F45_REFRESH_BENCH_N = envNum("ARB_F45_REFRESH_BENCH_N", 30);
    ARB_RECONCILE_MIN_INTERVAL_MS = envNum("ARB_RECONCILE_MIN_INTERVAL_MS", 3e4);
    ARB_RECONCILE_BACKOFF_MAX_MS = envNum("ARB_RECONCILE_BACKOFF_MAX_MS", 5 * 6e4);
    ARB_MAINTENANCE_QUEUE_MAX = envNum("ARB_MAINTENANCE_QUEUE_MAX", 64);
    ARB_AUTH_MAX_SUPPRESS_MS = envNum("ARB_AUTH_MAX_SUPPRESS_MS", 5e3);
    ARB_AUTH_SUPPRESSED_SAMPLE_RATE = envNum(
      "ARB_AUTH_SUPPRESSED_SAMPLE_RATE",
      ARB_AUTH_SUPPRESS_SAMPLE_RATE > 0 ? Math.max(ARB_AUTH_SUPPRESS_SAMPLE_RATE, 0.1) : 0.1
    );
    ARB_AUTH_MAX_CONCURRENCY = envNum("ARB_AUTH_MAX_CONCURRENCY", 2);
    ARB_AUTH_MAX_PER_MINUTE = envNum("ARB_AUTH_MAX_PER_MINUTE", 30);
    ARB_AUTH_QUEUE_MAX = envNum("ARB_AUTH_QUEUE_MAX", 64);
    ARB_AUTH_CIRCUIT_COOLDOWN_MS = envNum("ARB_AUTH_CIRCUIT_COOLDOWN_MS", 15e3);
    ARB_AUTH_MATERIAL_USD_DELTA = envNum("ARB_AUTH_MATERIAL_USD_DELTA", 0.05);
    ARB_F46_SOAK_A_MS = envNum("ARB_F46_SOAK_A_MS", 15 * 6e4);
    ARB_F46_SOAK_B_MS = envNum("ARB_F46_SOAK_B_MS", 20 * 6e4);
    ARB_F46_HOT_BENCH_N = envNum("ARB_F46_HOT_BENCH_N", 50);
    ARB_F46_AUTH_ENABLED = envBool("ARB_F46_AUTH_ENABLED", true);
    ARB_TICK_BOOTSTRAP_MAX_PAGES = envNum("ARB_TICK_BOOTSTRAP_MAX_PAGES", 8);
    ARB_DIRTY_TICK_NEGATIVE_MARGIN_BPS = envNum("ARB_DIRTY_TICK_NEGATIVE_MARGIN_BPS", 8);
    ARB_TICK_DIRTY_MAX_AGE_MS = envNum("ARB_TICK_DIRTY_MAX_AGE_MS", 3e4);
    ARB_TICK_INDEX_MAX_PER_POOL = envNum("ARB_TICK_INDEX_MAX_PER_POOL", 2e3);
    ARB_F47_SOAK_A_MS = envNum("ARB_F47_SOAK_A_MS", 15 * 6e4);
    ARB_F47_SOAK_B_MS = envNum("ARB_F47_SOAK_B_MS", 20 * 6e4);
    ARB_F47_DIRTY_BENCH_N = envNum("ARB_F47_DIRTY_BENCH_N", 30);
    ARB_F5_SOAK_MS = envNum("ARB_F5_SOAK_MS", 25 * 6e4);
    ARB_BLUEFIN_LOCAL_QUOTES = envBool("ARB_BLUEFIN_LOCAL_QUOTES", true);
    ARB_BLUEFIN_LOCAL_EXACT = envBool("ARB_BLUEFIN_LOCAL_EXACT", false);
    ARB_BLUEFIN_MIN_LIQUIDITY_USD = envNum("ARB_BLUEFIN_MIN_LIQUIDITY_USD", 5e4);
    ARB_BLUEFIN_TICK_WINDOW = envNum("ARB_BLUEFIN_TICK_WINDOW", 8e3);
    ARB_BLUEFIN_TICK_MAX_PAGES = envNum("ARB_BLUEFIN_TICK_MAX_PAGES", 40);
    ARB_MOMENTUM_LOCAL_QUOTES = envBool("ARB_MOMENTUM_LOCAL_QUOTES", true);
    ARB_MOMENTUM_LOCAL_EXACT = envBool("ARB_MOMENTUM_LOCAL_EXACT", false);
    ARB_MOMENTUM_MIN_LIQUIDITY_USD = envNum("ARB_MOMENTUM_MIN_LIQUIDITY_USD", 5e4);
    ARB_MOMENTUM_TICK_WINDOW = envNum("ARB_MOMENTUM_TICK_WINDOW", 8e3);
    ARB_MOMENTUM_TICK_MAX_PAGES = envNum("ARB_MOMENTUM_TICK_MAX_PAGES", 40);
    ARB_MOMENTUM_TICK_WINDOW_EXPANDED = envNum(
      "ARB_MOMENTUM_TICK_WINDOW_EXPANDED",
      32e3
    );
    ARB_MOMENTUM_TICK_MAX_PAGES_EXPANDED = envNum(
      "ARB_MOMENTUM_TICK_MAX_PAGES_EXPANDED",
      80
    );
    ARB_AUTH_JOB_TIMEOUT_MS = envNum("ARB_AUTH_JOB_TIMEOUT_MS", 15e3);
    ARB_TRUTH_FILTER_SAMPLE_RATE = envNum("ARB_TRUTH_FILTER_SAMPLE_RATE", 0.1);
    ARB_TRUTH_AWARE_FILTER = envBool("ARB_TRUTH_AWARE_FILTER", true);
    ARB_QUOTE_UNCERTAINTY_PATH = envStr(
      "ARB_QUOTE_UNCERTAINTY_PATH",
      "./data/arbitrage/calibration/quote-uncertainty.json"
    );
    ARB_F51_SHADOW_MS = envNum("ARB_F51_SHADOW_MS", 60 * 6e4);
    ARB_F51_AUTH_SOAK_MS = envNum("ARB_F51_AUTH_SOAK_MS", 25 * 6e4);
    ARB_F52_SHADOW_MS = envNum("ARB_F52_SHADOW_MS", 120 * 6e4);
    ARB_TRUTH_FILTER_FN_BPS = envNum("ARB_TRUTH_FILTER_FN_BPS", 0);
  }
});

// server/esbuild-env-setup.ts
import process2 from "node:process";
import { createRequire } from "node:module";
var envProxy = new Proxy(process2.env, {
  get(target, prop) {
    if (prop === "DEV") return false;
    if (prop === "PROD") return true;
    if (prop === "MODE") return "production";
    if (prop === "SSR") return true;
    if (typeof prop === "string" && prop in target) return target[prop];
    return void 0;
  }
});
Object.defineProperty(import.meta, "env", {
  value: envProxy,
  writable: false,
  enumerable: true,
  configurable: true
});
var require2 = createRequire(import.meta.url);
if (!globalThis.Buffer) {
  globalThis.Buffer = require2("buffer").Buffer;
}

// src/poolQuote/pricing/state/ClmmStateCache.ts
var ClmmStateCache = class {
  snaps = /* @__PURE__ */ new Map();
  get(poolId) {
    return this.snaps.get(poolId);
  }
  /** Atomic replace. Deep-freezes tick array reference by copying. */
  set(snapshot) {
    const frozen = {
      ...snapshot,
      ticks: Object.freeze([...snapshot.ticks].map((t) => ({ ...t })))
    };
    this.snaps.set(snapshot.poolId, frozen);
  }
  invalidate(poolId) {
    this.snaps.delete(poolId);
  }
  clear() {
    this.snaps.clear();
  }
  age(poolId, nowMs = Date.now()) {
    const s = this.snaps.get(poolId);
    if (!s) return null;
    return nowMs - s.loadedAtMs;
  }
  version(poolId) {
    return this.snaps.get(poolId)?.objectVersion;
  }
  /**
   * Monotonic version check: reject older versions when both parse as numbers.
   * Non-numeric versions compare lexicographically.
   */
  isNewerOrSame(poolId, nextVersion) {
    if (nextVersion == null) return true;
    const cur = this.version(poolId);
    if (cur == null) return true;
    const a = Number(cur);
    const b = Number(nextVersion);
    if (Number.isFinite(a) && Number.isFinite(b)) return b >= a;
    return nextVersion >= cur;
  }
  freshness(poolId, maxAgeMs, nowMs = Date.now()) {
    const s = this.snaps.get(poolId);
    if (!s) return null;
    const ageMs = nowMs - s.loadedAtMs;
    return {
      ageMs,
      stale: ageMs > maxAgeMs,
      maxAgeMs,
      objectVersion: s.objectVersion
    };
  }
  listPoolIds() {
    return [...this.snaps.keys()];
  }
  size() {
    return this.snaps.size;
  }
  /** After a batch load, reset ages so long ingest does not immediately stale-out quotes. */
  touchAll(nowMs = Date.now()) {
    for (const [id, s] of this.snaps) {
      this.snaps.set(id, { ...s, loadedAtMs: nowMs });
    }
  }
};
var defaultClmmStateCache = new ClmmStateCache();

// src/poolQuote/pricing/state/cetus/CetusStateLoader.ts
import BN from "bn.js";

// src/poolQuote/dex/cetus/CetusAdapter.ts
import { CetusClmmSDK } from "@cetusprotocol/sui-clmm-sdk";

// src/utils/suiCoinType.ts
import { normalizeSuiAddress } from "@mysten/sui/utils";
function normalizeCoinTypeForMatch(coinType) {
  const parts = coinType.split("::");
  if (parts.length < 3) return coinType;
  try {
    const addr = normalizeSuiAddress(parts[0]);
    return `${addr}::${parts[1]}::${parts[2]}`;
  } catch {
    return coinType;
  }
}
var NATIVE_SUI_COIN_TYPE = normalizeCoinTypeForMatch("0x2::sui::SUI");

// src/poolQuote/coins.ts
var NS_COIN_TYPE_MAINNET = "0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS";
var USDC_COIN_TYPE_MAINNET = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
var SUI_DECIMALS = 9;
var NS_DECIMALS = 6;
var USDC_DECIMALS = 6;
function sameCoinType(a, b) {
  return normalizeCoinTypeForMatch(a) === normalizeCoinTypeForMatch(b);
}
function isSuiCoin(coinType) {
  return sameCoinType(coinType, NATIVE_SUI_COIN_TYPE);
}
function isNsCoin(coinType) {
  return sameCoinType(coinType, NS_COIN_TYPE_MAINNET);
}
function isUsdcCoin(coinType) {
  return sameCoinType(coinType, USDC_COIN_TYPE_MAINNET);
}
function coinRef(coinType, symbol, decimals) {
  return { coinType: normalizeCoinTypeForMatch(coinType), symbol, decimals };
}
function suiCoin() {
  return coinRef(NATIVE_SUI_COIN_TYPE, "SUI", SUI_DECIMALS);
}
function nsCoin(coinType = NS_COIN_TYPE_MAINNET) {
  return coinRef(coinType, "NS", NS_DECIMALS);
}
function usdcCoin() {
  return coinRef(USDC_COIN_TYPE_MAINNET, "USDC", USDC_DECIMALS);
}
var researchCoins = /* @__PURE__ */ new Map();
function resolveResearchCoin(coinType) {
  return researchCoins.get(normalizeCoinTypeForMatch(coinType)) ?? null;
}
function rawToHuman(raw, decimals) {
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  return Number(whole) + Number(frac) / Number(base);
}
function sqrtPriceX64ToPrice(sqrtPrice, decimalsA, decimalsB) {
  const sp = typeof sqrtPrice === "bigint" ? sqrtPrice : BigInt(sqrtPrice);
  if (sp <= 0n) return 0;
  const Q642 = 2n ** 64n;
  const ratio = Number(sp) / Number(Q642);
  const rawPrice = ratio * ratio;
  return rawPrice * 10 ** (decimalsA - decimalsB);
}
function resolveA2b(params) {
  if (sameCoinType(params.coinIn, params.coinTypeA)) return true;
  if (sameCoinType(params.coinIn, params.coinTypeB)) return false;
  throw new Error(
    `coinIn ${params.coinIn} is neither coinA ${params.coinTypeA} nor coinB ${params.coinTypeB}`
  );
}
function i32FromBits(bits) {
  return bits > 2147483647 ? bits - 4294967296 : bits;
}
function formatFeeTierFromPpm(feeRaw) {
  const pct = feeRaw / 1e4;
  return `${pct}%`;
}

// src/poolQuote/partialFill.ts
init_config();
function isPartialFill(requested, consumed, relTol = PARTIAL_FILL_REL_TOLERANCE) {
  try {
    const req = BigInt(requested);
    const got = BigInt(consumed);
    if (req <= 0n) return got !== req;
    const diff = req > got ? req - got : got - req;
    if (diff === 0n) return false;
    if (diff <= 1n) return false;
    const rel = Number(diff) / Number(req);
    return rel > relTol;
  } catch {
    return true;
  }
}

// src/poolQuote/profit.ts
init_config();
function calcPriceImpactPct(params) {
  const { amountInHuman, amountOutHuman, midOutPerIn } = params;
  if (!(amountInHuman > 0) || !(midOutPerIn > 0)) return null;
  const expectedOut = amountInHuman * midOutPerIn;
  if (!(expectedOut > 0)) return null;
  return (expectedOut - amountOutHuman) / expectedOut * 100;
}
function effectivePrice(amountInHuman, amountOutHuman) {
  if (!(amountInHuman > 0)) return 0;
  return amountOutHuman / amountInHuman;
}

// src/utils/suiRpcUrl.ts
var DEFAULT_MAINNET_JSON_RPC_URL = "https://mainnet.suiet.app";
var DEPRECATED_MYSTEN_JSON_RPC_HOSTS = /* @__PURE__ */ new Set([
  "fullnode.mainnet.sui.io",
  "fullnode.testnet.sui.io",
  "fullnode.devnet.sui.io"
]);
var RPC_HOST_ALIASES = {
  "sui.publicnode.com": DEFAULT_MAINNET_JSON_RPC_URL
};
function rpcFromProcessEnv() {
  if (typeof process === "undefined" || !process.env) return void 0;
  const v = process.env.VITE_SUI_RPC_URL ?? process.env.SUI_RPC_URL;
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return void 0;
}
function normalizeSuiRpcUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (DEPRECATED_MYSTEN_JSON_RPC_HOSTS.has(host)) {
      return DEFAULT_MAINNET_JSON_RPC_URL;
    }
    const alias = RPC_HOST_ALIASES[host];
    if (alias) return alias;
  } catch {
  }
  return url;
}
function resolveSuiRpcUrl() {
  const fromProcess = rpcFromProcessEnv();
  if (fromProcess) return normalizeSuiRpcUrl(fromProcess);
  const fromEnv = import.meta.env?.VITE_SUI_RPC_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return normalizeSuiRpcUrl(fromEnv.trim());
  }
  return DEFAULT_MAINNET_JSON_RPC_URL;
}
function resolveServerSuiRpcUrl() {
  return resolveSuiRpcUrl();
}

// src/poolQuote/rpc/providerPool.ts
init_config();

// src/rpc/providerPool.ts
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

// src/rpc/rollingLatency.ts
var RollingLatency = class {
  buf;
  i = 0;
  filled = 0;
  name;
  constructor(name, capacity = 512) {
    this.name = name;
    this.buf = new Array(Math.max(16, capacity));
  }
  push(ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.buf[this.i] = ms;
    this.i = (this.i + 1) % this.buf.length;
    this.filled = Math.min(this.filled + 1, this.buf.length);
  }
  samples() {
    if (this.filled < this.buf.length) return this.buf.slice(0, this.filled);
    const out = [];
    for (let k = 0; k < this.filled; k++) {
      out.push(this.buf[(this.i + k) % this.buf.length]);
    }
    return out;
  }
  stats() {
    const s = this.samples().sort((a, b) => a - b);
    if (s.length === 0) {
      return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
    }
    const sum = s.reduce((a, b) => a + b, 0);
    return {
      count: s.length,
      min: s[0],
      max: s[s.length - 1],
      mean: sum / s.length,
      p50: percentile(s, 0.5),
      p90: percentile(s, 0.9),
      p95: percentile(s, 0.95),
      p99: percentile(s, 0.99)
    };
  }
};
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

// src/rpc/providerPool.ts
var DEFAULT_TIMEOUT_MS = 8e3;
var DEFAULT_FAILURES_BEFORE_QUARANTINE = 2;
var DEFAULT_QUARANTINE_MS = 12e3;
var HARD_DOWN_MS = 5 * 6e4;
var MAX_IN_FLIGHT = 1;
var MIN_GAP_MS = 300;
var RATE_LIMIT_COOLDOWN_MS = 2e3;
var RATE_LIMIT_PASSES = 4;
var STAGGER_RACE_MS = 180;
var HEALTH_PROBE_MS = 2e4;
function isHardDownMessage(msg) {
  return /no longer available|has been deprecated|Method not found|Unexpected status code: 403/i.test(
    msg
  );
}
function shortLabel(url) {
  try {
    const h = new URL(url).hostname;
    return h.replace(/^www\./, "").slice(0, 28);
  } catch {
    return url.slice(0, 28);
  }
}
function classifyError(msg) {
  if (/timeout|aborted|AbortError|ETIMEDOUT/i.test(msg)) return "timeout";
  if (/429|rate limit|Too Many|too frequent/i.test(msg)) return "429";
  if (/\b5\d\d\b|502|503|504|Bad Gateway|Service Unavailable/i.test(msg)) return "5xx";
  return "other";
}
function timedFetch(timeoutMs) {
  return async (input, init) => {
    const ctrl = new AbortController();
    const parent = init?.signal;
    const onParentAbort = () => ctrl.abort();
    if (parent) {
      if (parent.aborted) ctrl.abort();
      else parent.addEventListener("abort", onParentAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: ctrl.signal });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort/i.test(msg) || e instanceof Error && e.name === "AbortError") {
        throw new Error(`RPC timeout after ${timeoutMs}ms`, { cause: e });
      }
      throw e;
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    }
  };
}
var Provider = class {
  url;
  label;
  client;
  requestCount = 0;
  successCount = 0;
  failureCount = 0;
  timeoutCount = 0;
  count429 = 0;
  count5xx = 0;
  consecutiveFailures = 0;
  lastSuccessAt = null;
  lastFailureAt = null;
  quarantinedUntil = null;
  /** Skip this URL even in the all-providers fallback (dead gateway / removed API). */
  hardDownUntil = null;
  circuit = "CLOSED";
  latency = new RollingLatency("rpc");
  constructor(url, timeoutMs) {
    this.url = url;
    this.label = shortLabel(url);
    this.client = new SuiJsonRpcClient({
      url,
      network: "mainnet",
      // @ts-expect-error mysten client accepts fetch in runtime options
      fetch: timedFetch(timeoutMs)
    });
  }
  healthScore(now = Date.now()) {
    if (this.circuit === "OPEN" && this.quarantinedUntil != null && now < this.quarantinedUntil) {
      return 0;
    }
    const total = this.requestCount || 1;
    const successRate = this.successCount / total;
    const lat = this.latency.stats();
    const latPenalty = lat.p95 > 0 ? Math.min(1, lat.p95 / 3e3) : 0;
    const failPenalty = Math.min(1, this.consecutiveFailures / 5);
    return Math.max(0, Math.min(1, successRate * (1 - 0.4 * latPenalty) * (1 - 0.5 * failPenalty)));
  }
  isHardDown(now = Date.now()) {
    return this.hardDownUntil != null && now < this.hardDownUntil;
  }
  isUsable(now = Date.now()) {
    this.maybeAdvanceCircuit(now);
    if (this.isHardDown(now)) return false;
    return this.circuit === "CLOSED" || this.circuit === "HALF_OPEN";
  }
  maybeAdvanceCircuit(now = Date.now()) {
    if (this.circuit === "OPEN" && this.quarantinedUntil != null && now >= this.quarantinedUntil) {
      this.circuit = "HALF_OPEN";
    }
  }
  recordSuccess(latencyMs) {
    this.requestCount++;
    this.successCount++;
    this.consecutiveFailures = 0;
    this.lastSuccessAt = Date.now();
    this.latency.push(latencyMs);
    this.quarantinedUntil = null;
    this.hardDownUntil = null;
    this.circuit = "CLOSED";
  }
  recordFailure(err, failuresBeforeQuarantine, quarantineMs) {
    this.requestCount++;
    this.failureCount++;
    this.consecutiveFailures++;
    this.lastFailureAt = Date.now();
    const msg = err instanceof Error ? err.message : String(err);
    const kind = classifyError(msg);
    if (kind === "timeout") this.timeoutCount++;
    if (kind === "429") this.count429++;
    if (kind === "5xx") this.count5xx++;
    if (isHardDownMessage(msg)) {
      this.hardDownUntil = Date.now() + HARD_DOWN_MS;
      this.openCircuit(HARD_DOWN_MS);
      return;
    }
    if (this.circuit === "HALF_OPEN") {
      this.openCircuit(quarantineMs);
      return;
    }
    if (kind === "429" || kind === "5xx" || this.consecutiveFailures >= failuresBeforeQuarantine) {
      this.openCircuit(quarantineMs);
    }
  }
  openCircuit(quarantineMs) {
    this.circuit = "OPEN";
    this.quarantinedUntil = Date.now() + quarantineMs;
  }
  snapshot() {
    const lat = this.latency.stats();
    return {
      url: this.url,
      label: this.label,
      requestCount: this.requestCount,
      successCount: this.successCount,
      failureCount: this.failureCount,
      timeoutCount: this.timeoutCount,
      count429: this.count429,
      count5xx: this.count5xx,
      latency: { p50: lat.p50, p90: lat.p90, p95: lat.p95, count: lat.count },
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      consecutiveFailures: this.consecutiveFailures,
      healthScore: this.healthScore(),
      quarantinedUntil: this.quarantinedUntil,
      circuit: this.circuit
    };
  }
};
var RpcProviderPool = class {
  providers;
  preferredIndex = 0;
  inFlight = 0;
  nextStartAt = 0;
  slotQueue = [];
  timeoutMs;
  failuresBeforeQuarantine;
  quarantineMs;
  retriesPerProvider;
  /** Callbacks when active URL changes (Turbos SDK rebind). */
  onUrlChange = [];
  healthTimer = null;
  constructor(opts) {
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.failuresBeforeQuarantine = opts?.failuresBeforeQuarantine ?? DEFAULT_FAILURES_BEFORE_QUARANTINE;
    this.quarantineMs = opts?.quarantineMs ?? DEFAULT_QUARANTINE_MS;
    this.retriesPerProvider = Math.max(0, opts?.retriesPerProvider ?? 0);
    const urls = opts?.urls?.length ? opts.urls.map(normalizeSuiRpcUrl) : [resolveServerSuiRpcUrl()];
    this.providers = urls.map((u) => new Provider(u, this.timeoutMs));
    if (this.providers.length === 0) {
      this.providers = [new Provider(normalizeSuiRpcUrl(resolveServerSuiRpcUrl()), this.timeoutMs)];
    }
    this.startHealthProbe();
  }
  /** Quiet checkpoint ping — clears soft quarantine when a flapping node recovers. */
  startHealthProbe() {
    if (typeof setInterval === "undefined") return;
    if (this.healthTimer != null) return;
    this.healthTimer = setInterval(() => {
      void this.probeUnhealthyProviders();
    }, HEALTH_PROBE_MS);
    if (typeof this.healthTimer === "object" && this.healthTimer && "unref" in this.healthTimer) {
      ;
      this.healthTimer.unref();
    }
  }
  async probeUnhealthyProviders() {
    const now = Date.now();
    for (const p of this.providers) {
      if (p.isHardDown(now)) continue;
      if (p.circuit === "CLOSED" && p.consecutiveFailures === 0) continue;
      try {
        const t0 = Date.now();
        await p.client.getLatestCheckpointSequenceNumber();
        p.recordSuccess(Date.now() - t0);
        const idx = this.providers.indexOf(p);
        if (idx >= 0) {
          this.preferredIndex = idx;
          for (const cb of this.onUrlChange) cb(p.url);
        }
      } catch {
      }
    }
  }
  onActiveUrlChange(cb) {
    this.onUrlChange.push(cb);
  }
  urls() {
    return this.providers.map((p) => p.url);
  }
  activeUrl() {
    return this.pickOrder()[0]?.url ?? this.providers[0].url;
  }
  activeClient() {
    const p = this.pickOrder()[0] ?? this.providers[0];
    return p.client;
  }
  getClientForUrl(url) {
    return this.providers.find((p) => p.url === url)?.client ?? null;
  }
  stats() {
    return this.providers.map((p) => p.snapshot());
  }
  formatTable() {
    const rows = this.stats();
    const lines = [
      "RPC PROVIDERS",
      "provider".padEnd(28) + "success%".padStart(9) + "timeout".padStart(8) + "429".padStart(5) + "5xx".padStart(5) + "p50".padStart(7) + "p95".padStart(7) + "  health  state"
    ];
    for (const r of rows) {
      const pct = r.requestCount > 0 ? `${(100 * r.successCount / r.requestCount).toFixed(1)}%` : "n/a";
      lines.push(
        r.label.padEnd(28) + pct.padStart(9) + String(r.timeoutCount).padStart(8) + String(r.count429).padStart(5) + String(r.count5xx).padStart(5) + `${Math.round(r.latency.p50)}`.padStart(7) + `${Math.round(r.latency.p95)}`.padStart(7) + `  ${r.healthScore.toFixed(2).padStart(5)}  ${r.circuit}`
      );
    }
    return lines.join("\n");
  }
  /** Keep public nodes under their request-per-second cap. */
  acquireSlot() {
    return new Promise((resolve) => {
      const start = () => {
        this.inFlight++;
        const now = Date.now();
        const wait = Math.max(0, this.nextStartAt - now);
        this.nextStartAt = Math.max(this.nextStartAt, now) + MIN_GAP_MS;
        if (wait === 0) resolve();
        else setTimeout(resolve, wait);
      };
      if (this.inFlight < MAX_IN_FLIGHT) start();
      else this.slotQueue.push(start);
    });
  }
  releaseSlot() {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.slotQueue.shift();
    if (next) next();
  }
  deferAfterRateLimit() {
    this.nextStartAt = Math.max(this.nextStartAt, Date.now() + RATE_LIMIT_COOLDOWN_MS);
  }
  /** Ordered usable providers: preferred first, then by healthScore desc. */
  pickOrder(now = Date.now()) {
    for (const p of this.providers) p.maybeAdvanceCircuit(now);
    const alive = this.providers.filter((p) => !p.isHardDown(now));
    const base = alive.length > 0 ? alive : [...this.providers];
    const usable = base.filter((p) => p.isUsable(now));
    const pool = usable.length > 0 ? usable : base;
    const preferred = this.providers[this.preferredIndex];
    pool.sort((a, b) => {
      if (preferred && a === preferred) return -1;
      if (preferred && b === preferred) return 1;
      if (a.circuit === "HALF_OPEN" && b.circuit !== "HALF_OPEN") return 1;
      if (b.circuit === "HALF_OPEN" && a.circuit !== "HALF_OPEN") return -1;
      return b.healthScore(now) - a.healthScore(now);
    });
    return pool;
  }
  markPreferred(p) {
    const idx = this.providers.indexOf(p);
    if (idx < 0) return;
    if (idx !== this.preferredIndex) {
      this.preferredIndex = idx;
      for (const cb of this.onUrlChange) cb(p.url);
    } else {
      this.preferredIndex = idx;
    }
  }
  /**
   * Staggered race across up to 2 healthy providers (EdgeApp pattern).
   * First success wins; losers still record failure/success for scoring.
   */
  async raceTwo(fn, a, b) {
    const run = (p) => {
      const t0 = Date.now();
      return fn(p.client, p.url).then(
        (result) => ({ ok: true, provider: p, result, latencyMs: Date.now() - t0 }),
        (error) => ({ ok: false, provider: p, error })
      );
    };
    const first = run(a);
    const late = { p: null };
    const timer = setTimeout(() => {
      late.p = run(b);
    }, STAGGER_RACE_MS);
    const settled = await first;
    clearTimeout(timer);
    if (settled.ok) {
      settled.provider.recordSuccess(settled.latencyMs);
      this.markPreferred(settled.provider);
      if (late.p) {
        void late.p.then((o) => {
          if (o.ok) o.provider.recordSuccess(o.latencyMs);
          else o.provider.recordFailure(o.error, this.failuresBeforeQuarantine, this.quarantineMs);
        });
      }
      return {
        result: settled.result,
        meta: {
          providerUrl: settled.provider.url,
          providerLabel: settled.provider.label,
          latencyMs: settled.latencyMs,
          failoverUsed: false,
          providersTried: late.p ? 2 : 1
        }
      };
    }
    settled.provider.recordFailure(settled.error, this.failuresBeforeQuarantine, this.quarantineMs);
    if (classifyError(settled.error instanceof Error ? settled.error.message : String(settled.error)) === "429") {
      this.deferAfterRateLimit();
    }
    if (!late.p) late.p = run(b);
    const other = await late.p;
    if (other.ok) {
      other.provider.recordSuccess(other.latencyMs);
      this.markPreferred(other.provider);
      return {
        result: other.result,
        meta: {
          providerUrl: other.provider.url,
          providerLabel: other.provider.label,
          latencyMs: other.latencyMs,
          failoverUsed: true,
          providersTried: 2
        }
      };
    }
    other.provider.recordFailure(other.error, this.failuresBeforeQuarantine, this.quarantineMs);
    if (classifyError(other.error instanceof Error ? other.error.message : String(other.error)) === "429") {
      this.deferAfterRateLimit();
    }
    return { error: other.error ?? settled.error, tried: 2 };
  }
  /**
   * Run fn against providers with fast failover + staggered race on the first pair.
   */
  async execute(fn, opts) {
    await this.acquireSlot();
    try {
      let lastErr;
      for (let pass = 0; pass < RATE_LIMIT_PASSES; pass++) {
        if (pass > 0) {
          await new Promise((r) => setTimeout(r, RATE_LIMIT_COOLDOWN_MS));
        }
        const order = this.pickOrder();
        const max = Math.min(opts?.maxProviders ?? order.length, order.length);
        if (max === 0) break;
        let rateLimited = false;
        let tried = 0;
        if (max >= 2) {
          const raced = await this.raceTwo(fn, order[0], order[1]);
          if ("result" in raced) return raced;
          tried += raced.tried;
          lastErr = raced.error;
          const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
          if (classifyError(msg) === "429") rateLimited = true;
          for (let i = 2; i < max; i++) {
            const p = order[i];
            tried++;
            const t0 = Date.now();
            try {
              const result = await fn(p.client, p.url);
              p.recordSuccess(Date.now() - t0);
              this.markPreferred(p);
              return {
                result,
                meta: {
                  providerUrl: p.url,
                  providerLabel: p.label,
                  latencyMs: Date.now() - t0,
                  failoverUsed: true,
                  providersTried: tried
                }
              };
            } catch (e) {
              lastErr = e;
              p.recordFailure(e, this.failuresBeforeQuarantine, this.quarantineMs);
              if (classifyError(e instanceof Error ? e.message : String(e)) === "429") {
                rateLimited = true;
                this.deferAfterRateLimit();
              }
            }
          }
        } else {
          const p = order[0];
          const attempts = 1 + this.retriesPerProvider;
          for (let attempt = 0; attempt < attempts; attempt++) {
            tried++;
            const t0 = Date.now();
            try {
              const result = await fn(p.client, p.url);
              p.recordSuccess(Date.now() - t0);
              this.markPreferred(p);
              return {
                result,
                meta: {
                  providerUrl: p.url,
                  providerLabel: p.label,
                  latencyMs: Date.now() - t0,
                  failoverUsed: false,
                  providersTried: tried
                }
              };
            } catch (e) {
              lastErr = e;
              p.recordFailure(e, this.failuresBeforeQuarantine, this.quarantineMs);
              if (classifyError(e instanceof Error ? e.message : String(e)) === "429") {
                rateLimited = true;
                this.deferAfterRateLimit();
              }
              if (p.circuit === "OPEN") break;
            }
          }
        }
        if (!rateLimited) break;
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "All RPC providers failed"));
    } finally {
      this.releaseSlot();
    }
  }
  async call(fn) {
    const { result } = await this.execute((c, url) => fn(c, url));
    return result;
  }
};

// src/poolQuote/rpc/providerPool.ts
function parseArbRpcUrls() {
  const rawList = typeof process !== "undefined" && process.env?.ARB_SUI_RPC_URLS?.trim() || "";
  const primary = typeof process !== "undefined" && process.env?.ARB_SUI_RPC_URL?.trim() || resolveServerSuiRpcUrl();
  const fromList = rawList.split(",").map((s) => s.trim()).filter(Boolean).map(normalizeSuiRpcUrl);
  const list = [...fromList];
  if (list.length === 0) list.push(normalizeSuiRpcUrl(primary));
  else if (!list.includes(normalizeSuiRpcUrl(primary))) {
    const arbOnly = typeof process !== "undefined" && process.env?.ARB_SUI_RPC_URL?.trim();
    if (arbOnly) list.unshift(normalizeSuiRpcUrl(arbOnly));
  }
  return [...new Set(list)];
}
var sharedPool = null;
function getRpcProviderPool() {
  if (!sharedPool) {
    sharedPool = new RpcProviderPool({
      urls: parseArbRpcUrls(),
      timeoutMs: ARB_RPC_TIMEOUT_MS,
      failuresBeforeQuarantine: ARB_RPC_FAILURES_BEFORE_QUARANTINE,
      quarantineMs: ARB_RPC_QUARANTINE_MS,
      retriesPerProvider: 0
    });
  }
  return sharedPool;
}

// src/poolQuote/rpc.ts
function getArbJsonRpcClient() {
  return getRpcProviderPool().activeClient();
}
function getArbRpcUrl() {
  return getRpcProviderPool().activeUrl();
}
async function executeWithFailover(fn, opts) {
  return getRpcProviderPool().execute(fn, opts);
}
async function fetchLatestCheckpoint() {
  try {
    const { result } = await executeWithFailover((c) => c.getLatestCheckpointSequenceNumber(), {
      label: "getLatestCheckpointSequenceNumber"
    });
    return String(result);
  } catch {
    return null;
  }
}
async function fetchObjectVersion(objectId) {
  try {
    const { result } = await executeWithFailover(
      (c) => c.getObject({
        id: objectId,
        options: { showOwner: false }
      }),
      { label: "getObject" }
    );
    const v = result.data?.version;
    return v != null ? String(v) : null;
  } catch {
    return null;
  }
}

// src/poolQuote/dex/cetus/CetusAdapter.ts
var sdkSingleton = null;
function getCetusSdk() {
  if (!sdkSingleton) {
    sdkSingleton = CetusClmmSDK.createSDK({ env: "mainnet" });
  }
  return sdkSingleton;
}
function coinMeta(coinType) {
  if (isSuiCoin(coinType)) return suiCoin();
  if (isNsCoin(coinType)) return nsCoin(coinType);
  if (isUsdcCoin(coinType)) return usdcCoin();
  const research = resolveResearchCoin(coinType);
  if (research) return research;
  const parts = coinType.split("::");
  const sym = (parts[parts.length - 1] || "TOKEN").toUpperCase();
  return { coinType, symbol: sym.slice(0, 12), decimals: 9 };
}
function inferMarket(coinA, coinB) {
  const hasNs = isNsCoin(coinA) || isNsCoin(coinB);
  const hasSui = isSuiCoin(coinA) || isSuiCoin(coinB);
  const hasUsdc = isUsdcCoin(coinA) || isUsdcCoin(coinB);
  if (hasNs && hasSui) return "NS/SUI";
  if (hasSui && hasUsdc) return "SUI/USDC";
  if (hasSui) {
    const other = isSuiCoin(coinA) ? coinB : coinA;
    const research = resolveResearchCoin(other);
    const parts = other.split("::");
    const sym = research?.symbol ?? (parts[parts.length - 1] || "TOKEN").toUpperCase();
    return `${sym}/SUI`;
  }
  throw new Error(`Unsupported Cetus market for ${coinA} / ${coinB}`);
}
function normalizedDisplayPrice(market, priceBPerA, coinA, coinB) {
  if (market === "NS/SUI" || market.endsWith("/SUI") && market !== "SUI/USDC") {
    const suiPerToken = isSuiCoin(coinB) ? priceBPerA : 1 / priceBPerA;
    return { normalizedPrice: suiPerToken, normalizedPriceInverse: 1 / suiPerToken };
  }
  const usdcPerSui = isSuiCoin(coinA) && isUsdcCoin(coinB) ? priceBPerA : 1 / priceBPerA;
  return { normalizedPrice: usdcPerSui, normalizedPriceInverse: 1 / usdcPerSui };
}
var CetusAdapter = class {
  id = "cetus";
  async getPoolState(poolId) {
    const { ARB_RPC_TIMEOUT_MS: ARB_RPC_TIMEOUT_MS2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    return Promise.race([
      this.getPoolStateOnce(poolId),
      new Promise(
        (_, rej) => setTimeout(
          () => rej(new Error(`RPC timeout after ${ARB_RPC_TIMEOUT_MS2}ms (cetus.getPoolState)`)),
          ARB_RPC_TIMEOUT_MS2 * 2
        )
      )
    ]);
  }
  async getPoolStateOnce(poolId) {
    const sdk = getCetusSdk();
    const fetchedAtMs = Date.now();
    const [pool, checkpoint, objectVersion] = await Promise.all([
      sdk.Pool.getPool(poolId),
      fetchLatestCheckpoint(),
      fetchObjectVersion(poolId)
    ]);
    const coinTypeA = String(pool.coin_type_a);
    const coinTypeB = String(pool.coin_type_b);
    const a = coinMeta(coinTypeA);
    const b = coinMeta(coinTypeB);
    const market = inferMarket(coinTypeA, coinTypeB);
    const feeRaw = Number(pool.fee_rate);
    const sqrtPrice = String(pool.current_sqrt_price);
    const priceBPerA = sqrtPriceX64ToPrice(sqrtPrice, a.decimals, b.decimals);
    const { normalizedPrice, normalizedPriceInverse } = normalizedDisplayPrice(
      market,
      priceBPerA,
      coinTypeA,
      coinTypeB
    );
    return {
      dex: "cetus",
      poolId: String(pool.id ?? poolId),
      coinA: { ...a, coinType: coinTypeA },
      coinB: { ...b, coinType: coinTypeB },
      feeTier: formatFeeTierFromPpm(feeRaw),
      feeRaw,
      market,
      discoverySource: "cetus-sdk:Pool.getPool",
      currentTick: Number(pool.current_tick_index),
      sqrtPrice,
      liquidity: String(pool.liquidity),
      normalizedPrice,
      normalizedPriceInverse,
      fetchedAtMs,
      checkpoint,
      objectVersion
    };
  }
  async quoteExactIn(req) {
    const { ARB_RPC_TIMEOUT_MS: ARB_RPC_TIMEOUT_MS2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    return Promise.race([
      this.quoteExactInOnce(req),
      new Promise(
        (_, rej) => setTimeout(
          () => rej(new Error(`RPC timeout after ${ARB_RPC_TIMEOUT_MS2}ms (cetus.quoteExactIn)`)),
          ARB_RPC_TIMEOUT_MS2 * 3
        )
      )
    ]);
  }
  async quoteExactInOnce(req) {
    const sdk = getCetusSdk();
    const poolId = req.pool.poolId;
    const t0 = Date.now();
    const pool = await sdk.Pool.getPool(poolId);
    const coinTypeA = String(pool.coin_type_a);
    const coinTypeB = String(pool.coin_type_b);
    const a = coinMeta(coinTypeA);
    const b = coinMeta(coinTypeB);
    const a2b = resolveA2b({ coinTypeA, coinTypeB, coinIn: req.coinIn });
    if (!sameCoinType(a2b ? coinTypeB : coinTypeA, req.coinOut)) {
      const expectedOut = a2b ? coinTypeB : coinTypeA;
      if (!sameCoinType(expectedOut, req.coinOut)) {
        throw new Error(`Cetus quote coinOut mismatch: expected ${expectedOut}, got ${req.coinOut}`);
      }
    }
    const res = await sdk.Swap.preSwap({
      pool,
      current_sqrt_price: pool.current_sqrt_price,
      coin_type_a: coinTypeA,
      coin_type_b: coinTypeB,
      decimals_a: a.decimals,
      decimals_b: b.decimals,
      a2b,
      by_amount_in: true,
      amount: req.amountIn
    });
    const latencyMs = Date.now() - t0;
    const requestedAmountIn = req.amountIn;
    const amountIn = String(res.estimated_amount_in ?? req.amountIn);
    const amountOut = String(res.estimated_amount_out);
    const feeAmount = String(res.estimated_fee_amount ?? "0");
    const isExceed = Boolean(res.is_exceed);
    const partialFill = isExceed || isPartialFill(requestedAmountIn, amountIn);
    const decIn = a2b ? a.decimals : b.decimals;
    const decOut = a2b ? b.decimals : a.decimals;
    const inHuman = rawToHuman(amountIn, decIn);
    const outHuman = rawToHuman(amountOut, decOut);
    const midBPerA = sqrtPriceX64ToPrice(String(pool.current_sqrt_price), a.decimals, b.decimals);
    const midOutPerIn = a2b ? midBPerA : midBPerA > 0 ? 1 / midBPerA : 0;
    const [checkpoint, objectVersion] = await Promise.all([
      fetchLatestCheckpoint(),
      fetchObjectVersion(poolId)
    ]);
    return {
      dex: "cetus",
      poolId,
      a2b,
      amountIn,
      amountOut,
      requestedAmountIn,
      consumedAmountIn: amountIn,
      partialFill,
      coinIn: req.coinIn,
      coinOut: req.coinOut,
      effectivePrice: effectivePrice(inHuman, outHuman),
      feeAmount,
      feesIncludedInQuote: true,
      priceImpactPct: calcPriceImpactPct({
        amountInHuman: inHuman,
        amountOutHuman: outHuman,
        midOutPerIn
      }),
      latencyMs,
      fetchedAtMs: t0,
      checkpoint,
      objectVersion,
      raw: res
    };
  }
};
var cetusAdapter = new CetusAdapter();

// src/poolQuote/pricing/state/cetus/CetusStateLoader.ts
function classifyTickError(msg) {
  const m = msg.toLowerCase();
  if (m.includes("invalid tick fields")) return "missing_tick_fields";
  if (m.includes("schema") || m.includes("bcs")) return "sdk_schema_variation";
  if (m.includes("decode") || m.includes("bigint") || m.includes("bn")) return "tick_decode_error";
  if (m.includes("empty") || m.includes("no tick")) return "empty_tick_window";
  if (m.includes("shape") || m.includes("bits")) return "unsupported_tick_shape";
  return "other";
}
function tickDataToInitialized(t) {
  const index = Number(t.index);
  const liquidityNet = BigInt(String(t.liquidity_net ?? "0"));
  const liquidityGross = t.liquidity_gross != null ? BigInt(String(t.liquidity_gross)) : void 0;
  const sqrtPriceX64 = t.sqrt_price != null ? BigInt(String(t.sqrt_price)) : void 0;
  return { index, liquidityNet, liquidityGross, sqrtPriceX64 };
}
var CetusStateLoader = class {
  cache;
  constructor(cache2) {
    this.cache = cache2;
  }
  async load(poolId) {
    const sdk = getCetusSdk();
    const loadedAtMs = Date.now();
    const [pool, checkpoint, objectVersion] = await Promise.all([
      sdk.Pool.getPool(poolId),
      fetchLatestCheckpoint(),
      fetchObjectVersion(poolId)
    ]);
    const tickHandle = String(pool.ticks_handle ?? "");
    let ticks;
    let complete = true;
    let validityReason;
    let tickFailureReason;
    try {
      if (tickHandle) {
        ticks = await sdk.Pool.fetchTicksByRpc(tickHandle);
      } else {
        ticks = await sdk.Pool.fetchTicks({
          pool_id: String(pool.id ?? poolId),
          coin_type_a: String(pool.coin_type_a),
          coin_type_b: String(pool.coin_type_b)
        });
      }
      if (!Array.isArray(ticks) || ticks.length === 0) {
        complete = false;
        tickFailureReason = "empty_tick_window";
        validityReason = "cetus_empty_tick_window";
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tickFailureReason = classifyTickError(msg);
      try {
        if (tickHandle) {
          ticks = await sdk.Pool.fetchTicks({
            pool_id: String(pool.id ?? poolId),
            coin_type_a: String(pool.coin_type_a),
            coin_type_b: String(pool.coin_type_b)
          });
          complete = ticks.length > 0;
          if (complete) {
            tickFailureReason = void 0;
            validityReason = void 0;
          }
        } else {
          throw e;
        }
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        complete = false;
        tickFailureReason = classifyTickError(msg2);
        validityReason = `cetus_tick_load:${tickFailureReason}:${msg2}`;
        ticks = [];
      }
    }
    const normalizedTicks = ticks.map((raw) => normalizeCetusTick(raw));
    const initialized = normalizedTicks.map((t) => tickDataToInitialized(t)).sort((a, b) => a.index - b.index);
    const p = pool;
    const feeRate = Number(p.fee_rate ?? 0);
    const tickSpacing = Number(p.tickSpacing ?? p.tick_spacing ?? 60);
    const snap = {
      poolId: String(p.id ?? poolId),
      venue: "cetus",
      sqrtPriceX64: BigInt(String(p.current_sqrt_price ?? "0")),
      liquidity: BigInt(String(p.liquidity ?? "0")),
      currentTick: Number(p.current_tick_index ?? 0),
      tickSpacing,
      feeRate,
      tokenA: normalizeCoinTypeForMatch(String(p.coin_type_a)),
      tokenB: normalizeCoinTypeForMatch(String(p.coin_type_b)),
      decimalsA: 0,
      // filled by refreshWithDecimals
      decimalsB: 0,
      ticks: initialized,
      objectVersion: objectVersion ?? void 0,
      checkpoint: checkpoint != null && checkpoint !== "" ? BigInt(checkpoint) : void 0,
      loadedAtMs,
      complete,
      validityReason,
      tickFailureReason,
      quotePayload: {
        pool,
        ticks: normalizedTicks
      }
    };
    if (this.cache.isNewerOrSame(poolId, snap.objectVersion)) {
      this.cache.set(snap);
    }
    return this.cache.get(poolId) ?? snap;
  }
  async refresh(poolId) {
    return this.load(poolId);
  }
  /** Attach decimals from MarketPool after load. */
  withDecimals(poolId, decimalsA, decimalsB) {
    const cur = this.cache.get(poolId);
    if (!cur) return;
    this.cache.set({ ...cur, decimalsA, decimalsB });
  }
};
function normalizeCetusTick(raw) {
  const t = raw;
  const indexRaw = t.index;
  const index = typeof indexRaw === "object" && indexRaw != null && "bits" in indexRaw ? Number(indexRaw.bits) : Number(indexRaw);
  const asBn = (v) => {
    if (v == null) return new BN(0);
    if (BN.isBN(v)) return v;
    if (typeof v === "object" && v !== null && "bits" in v) {
      return new BN(String(v.bits));
    }
    if (typeof v === "object" && v !== null && typeof v.toString === "function") {
      return new BN(v.toString());
    }
    return new BN(String(v));
  };
  return {
    object_id: String(t.object_id ?? ""),
    index: Number.isFinite(index) ? index : 0,
    sqrt_price: asBn(t.sqrt_price),
    liquidity_net: asBn(t.liquidity_net),
    liquidity_gross: asBn(t.liquidity_gross ?? 0),
    fee_growth_outside_a: asBn(t.fee_growth_outside_a ?? 0),
    fee_growth_outside_b: asBn(t.fee_growth_outside_b ?? 0),
    rewarders_growth_outside: Array.isArray(t.rewarders_growth_outside) ? t.rewarders_growth_outside.map(asBn) : Array.isArray(t.rewards_growth_outside) ? t.rewards_growth_outside.map(asBn) : []
  };
}

// src/poolQuote/dex/turbos/TurbosAdapter.ts
init_config();
import { Network, TurbosSdk } from "turbos-clmm-sdk";
var sdkByUrl = /* @__PURE__ */ new Map();
var boundPoolListener = false;
function ensurePoolListener() {
  if (boundPoolListener) return;
  boundPoolListener = true;
  getRpcProviderPool().onActiveUrlChange(() => {
  });
}
function getTurbosSdk(client, url) {
  ensurePoolListener();
  const u = url ?? getArbRpcUrl();
  const c = client ?? getArbJsonRpcClient();
  let sdk = sdkByUrl.get(u);
  if (!sdk) {
    sdk = new TurbosSdk(Network.mainnet, c);
    sdkByUrl.set(u, sdk);
  }
  return sdk;
}
function coinMeta2(coinType) {
  if (isSuiCoin(coinType)) return suiCoin();
  if (isNsCoin(coinType)) return nsCoin(coinType);
  if (isUsdcCoin(coinType)) return usdcCoin();
  const research = resolveResearchCoin(coinType);
  if (research) return research;
  const parts = coinType.split("::");
  const sym = (parts[parts.length - 1] || "TOKEN").toUpperCase();
  return { coinType, symbol: sym.slice(0, 12), decimals: 9 };
}
function inferMarket2(coinA, coinB) {
  const hasNs = isNsCoin(coinA) || isNsCoin(coinB);
  const hasSui = isSuiCoin(coinA) || isSuiCoin(coinB);
  const hasUsdc = isUsdcCoin(coinA) || isUsdcCoin(coinB);
  if (hasNs && hasSui) return "NS/SUI";
  if (hasSui && hasUsdc) return "SUI/USDC";
  if (hasSui) {
    const other = isSuiCoin(coinA) ? coinB : coinA;
    const research = resolveResearchCoin(other);
    const parts = other.split("::");
    const sym = research?.symbol ?? (parts[parts.length - 1] || "TOKEN").toUpperCase();
    return `${sym}/SUI`;
  }
  throw new Error(`Unsupported Turbos market for ${coinA} / ${coinB}`);
}
function parseTick(tick) {
  if (typeof tick === "number") return tick;
  if (tick && typeof tick === "object" && "bits" in tick) {
    return i32FromBits(Number(tick.bits));
  }
  return Number(tick);
}
function normalizedDisplayPrice2(market, priceBPerA, coinA, coinB) {
  if (market === "NS/SUI" || market.endsWith("/SUI") && market !== "SUI/USDC") {
    const suiPerToken = isSuiCoin(coinB) ? priceBPerA : 1 / priceBPerA;
    return { normalizedPrice: suiPerToken, normalizedPriceInverse: 1 / suiPerToken };
  }
  const usdcPerSui = isSuiCoin(coinA) && isUsdcCoin(coinB) ? priceBPerA : 1 / priceBPerA;
  return { normalizedPrice: usdcPerSui, normalizedPriceInverse: 1 / usdcPerSui };
}
var TurbosAdapter = class {
  id = "turbos";
  async getPoolState(poolId) {
    const { result } = await getRpcProviderPool().execute(async (client, url) => {
      return this.getPoolStateOnce(poolId, client, url);
    }, { label: "turbos.getPoolState" });
    return result;
  }
  async getPoolStateOnce(poolId, client, url) {
    const sdk = getTurbosSdk(client, url);
    const fetchedAtMs = Date.now();
    const [pool, checkpoint, objectVersion] = await Promise.all([
      sdk.pool.getPool(poolId),
      fetchLatestCheckpoint(),
      fetchObjectVersion(poolId)
    ]);
    const types = pool.types;
    if (!types || types.length < 2) {
      throw new Error(`Turbos pool ${poolId} missing types[] coin types`);
    }
    const coinTypeA = String(types[0]);
    const coinTypeB = String(types[1]);
    const a = coinMeta2(coinTypeA);
    const b = coinMeta2(coinTypeB);
    const market = inferMarket2(coinTypeA, coinTypeB);
    const feeRaw = Number(pool.fee ?? 0);
    const sqrtPrice = String(pool.sqrt_price ?? "0");
    const priceBPerA = sqrtPriceX64ToPrice(sqrtPrice, a.decimals, b.decimals);
    const { normalizedPrice, normalizedPriceInverse } = normalizedDisplayPrice2(
      market,
      priceBPerA,
      coinTypeA,
      coinTypeB
    );
    return {
      dex: "turbos",
      poolId: String(pool.objectId ?? poolId),
      coinA: { ...a, coinType: coinTypeA },
      coinB: { ...b, coinType: coinTypeB },
      feeTier: formatFeeTierFromPpm(feeRaw),
      feeRaw,
      market,
      discoverySource: "turbos-sdk:pool.getPool",
      currentTick: parseTick(pool.tick_current_index),
      sqrtPrice,
      liquidity: String(pool.liquidity ?? "0"),
      normalizedPrice,
      normalizedPriceInverse,
      fetchedAtMs,
      checkpoint,
      objectVersion
    };
  }
  async quoteExactIn(req) {
    const { result } = await getRpcProviderPool().execute(async (client, url) => {
      return this.quoteExactInOnce(req, client, url);
    }, { label: "turbos.quoteExactIn" });
    return result;
  }
  async quoteExactInOnce(req, client, url) {
    const sdk = getTurbosSdk(client, url);
    const poolId = req.pool.poolId;
    const t0 = Date.now();
    const pool = await sdk.pool.getPool(poolId);
    const types = pool.types;
    if (!types || types.length < 2) {
      throw new Error(`Turbos pool ${poolId} missing types[]`);
    }
    const coinTypeA = String(types[0]);
    const coinTypeB = String(types[1]);
    const a = coinMeta2(coinTypeA);
    const b = coinMeta2(coinTypeB);
    const a2b = resolveA2b({ coinTypeA, coinTypeB, coinIn: req.coinIn });
    const expectedOut = a2b ? coinTypeB : coinTypeA;
    if (!sameCoinType(expectedOut, req.coinOut)) {
      throw new Error(`Turbos quote coinOut mismatch: expected ${expectedOut}, got ${req.coinOut}`);
    }
    let res;
    let tickStep = TURBOS_TICK_STEP;
    for (let attempt = 0; attempt < 3; attempt++) {
      const results = await sdk.trade.computeSwapResultV2({
        pools: [{ pool: poolId, a2b, amountSpecified: req.amountIn }],
        amountSpecifiedIsInput: true,
        tickStep,
        address: SHADOW_SIMULATION_ADDRESS
      });
      const row = Array.isArray(results) ? results[0] : results;
      if (!row) throw new Error("Turbos computeSwapResultV2 returned empty result");
      res = row;
      const amountA2 = String(res.amount_a);
      const amountB2 = String(res.amount_b);
      const consumed = BigInt(a2b ? amountA2 : amountB2);
      const requested = BigInt(req.amountIn);
      if (consumed >= requested) break;
      tickStep *= 2;
    }
    if (!res) throw new Error("Turbos computeSwapResultV2 returned empty result");
    const latencyMs = Date.now() - t0;
    const amountA = String(res.amount_a);
    const amountB = String(res.amount_b);
    const feeAmount = String(res.fee_amount ?? "0");
    const requestedAmountIn = req.amountIn;
    const amountIn = a2b ? amountA : amountB;
    const amountOut = a2b ? amountB : amountA;
    const partialFill = isPartialFill(requestedAmountIn, amountIn);
    const decIn = a2b ? a.decimals : b.decimals;
    const decOut = a2b ? b.decimals : a.decimals;
    const inHuman = rawToHuman(amountIn, decIn);
    const outHuman = rawToHuman(amountOut, decOut);
    const midBPerA = sqrtPriceX64ToPrice(
      String(pool.sqrt_price ?? "0"),
      a.decimals,
      b.decimals
    );
    const midOutPerIn = a2b ? midBPerA : midBPerA > 0 ? 1 / midBPerA : 0;
    const [checkpoint, objectVersion] = await Promise.all([
      fetchLatestCheckpoint(),
      fetchObjectVersion(poolId)
    ]);
    return {
      dex: "turbos",
      poolId,
      a2b,
      amountIn,
      amountOut,
      requestedAmountIn,
      consumedAmountIn: amountIn,
      partialFill,
      coinIn: req.coinIn,
      coinOut: req.coinOut,
      effectivePrice: effectivePrice(inHuman, outHuman),
      feeAmount,
      feesIncludedInQuote: true,
      priceImpactPct: calcPriceImpactPct({
        amountInHuman: inHuman,
        amountOutHuman: outHuman,
        midOutPerIn
      }),
      latencyMs,
      fetchedAtMs: t0,
      checkpoint,
      objectVersion,
      raw: { ...res, tickStepUsed: tickStep }
    };
  }
};
var turbosAdapter = new TurbosAdapter();

// src/poolQuote/quoteMath/turbosMath.ts
var Q64 = 1n << 64n;
var MAX_U64 = 0xffffffffffffffffn;
var MIN_SQRT_PRICE = 4295048016n;
var MAX_SQRT_PRICE = 79226673515401279992447579055n;
var FEE_DENOM = 1000000n;
function mulDivFloor(a, b, denom) {
  if (denom === 0n) throw new Error("div0");
  return a * b / denom;
}
function mulDivRound(a, b, denom) {
  if (denom === 0n) throw new Error("div0");
  return (a * b + denom / 2n) / denom;
}
function mulDivCeil(a, b, denom) {
  if (denom === 0n) throw new Error("div0");
  return (a * b + denom - 1n) / denom;
}
function getAmountADelta(sqrtA, sqrtB, liquidity, roundUp) {
  if (sqrtA <= 0n) throw new Error("EInvildSqrtPrice");
  let lo = sqrtA;
  let hi = sqrtB;
  if (lo > hi) [lo, hi] = [hi, lo];
  const numerator1 = liquidity << 64n;
  const numerator2 = hi - lo;
  if (roundUp) {
    const inner = mulDivCeil(numerator1 * numerator2, 1n, hi);
    return mulDivCeil(inner, 1n, lo);
  }
  return numerator1 * numerator2 / hi / lo;
}
function getAmountBDelta(sqrtA, sqrtB, liquidity, roundUp) {
  let lo = sqrtA;
  let hi = sqrtB;
  if (lo > hi) [lo, hi] = [hi, lo];
  const diff = hi - lo;
  return roundUp ? mulDivRound(liquidity, diff, Q64) : mulDivFloor(liquidity, diff, Q64);
}
function getNextSqrtPriceFromAmountARoundingUp(sqrtPrice, liquidity, amount, add) {
  if (amount === 0n) return sqrtPrice;
  const p = amount * sqrtPrice;
  const numerator = liquidity * sqrtPrice << 64n;
  const liquidityShl = liquidity << 64n;
  const denominator = add ? liquidityShl + p : liquidityShl - p;
  if (denominator <= 0n) throw new Error("EOverflow");
  return mulDivCeil(numerator, 1n, denominator);
}
function getNextSqrtPriceFromAmountBRoundingDown(sqrtPrice, liquidity, amount, add) {
  if (add) {
    const quotient2 = amount <= MAX_U64 ? (amount << 64n) / liquidity : mulDivFloor(amount, Q64, liquidity);
    return sqrtPrice + quotient2;
  }
  const quotient = amount <= MAX_U64 ? mulDivCeil(amount << 64n, 1n, liquidity) : mulDivRound(amount, Q64, liquidity);
  if (sqrtPrice <= quotient) throw new Error("EInvildSqrtPrice");
  return sqrtPrice - quotient;
}
function getNextSqrtPrice(sqrtPrice, liquidity, amount, amountSpecifiedIsInput, aToB) {
  if (amountSpecifiedIsInput === aToB) {
    return getNextSqrtPriceFromAmountARoundingUp(
      sqrtPrice,
      liquidity,
      amount,
      amountSpecifiedIsInput
    );
  }
  return getNextSqrtPriceFromAmountBRoundingDown(
    sqrtPrice,
    liquidity,
    amount,
    amountSpecifiedIsInput
  );
}
function getAmountFixedDelta(sqrtCurrent, sqrtTarget, liquidity, amountSpecifiedIsInput, aToB) {
  if (aToB === amountSpecifiedIsInput) {
    return getAmountADelta(sqrtCurrent, sqrtTarget, liquidity, amountSpecifiedIsInput);
  }
  return getAmountBDelta(sqrtCurrent, sqrtTarget, liquidity, amountSpecifiedIsInput);
}
function getAmountUnfixedDelta(sqrtCurrent, sqrtTarget, liquidity, amountSpecifiedIsInput, aToB) {
  if (aToB === amountSpecifiedIsInput) {
    return getAmountBDelta(sqrtCurrent, sqrtTarget, liquidity, !amountSpecifiedIsInput);
  }
  return getAmountADelta(sqrtCurrent, sqrtTarget, liquidity, !amountSpecifiedIsInput);
}
function computeSwapStep(sqrtPriceCurrent, sqrtPriceTarget, liquidity, amountRemaining, amountSpecifiedIsInput, feeRate) {
  if (liquidity === 0n) {
    return {
      nextSqrt: sqrtPriceTarget,
      amountIn: 0n,
      amountOut: 0n,
      feeAmount: 0n
    };
  }
  const aToB = sqrtPriceCurrent >= sqrtPriceTarget;
  const fee = BigInt(feeRate);
  let amountCalc = amountRemaining;
  if (amountSpecifiedIsInput) {
    amountCalc = mulDivFloor(amountRemaining, FEE_DENOM - fee, FEE_DENOM);
  }
  const amountFixedDelta = getAmountFixedDelta(
    sqrtPriceCurrent,
    sqrtPriceTarget,
    liquidity,
    amountSpecifiedIsInput,
    aToB
  );
  let nextSqrt;
  if (amountCalc >= amountFixedDelta) {
    nextSqrt = sqrtPriceTarget;
  } else {
    nextSqrt = getNextSqrtPrice(
      sqrtPriceCurrent,
      liquidity,
      amountCalc,
      amountSpecifiedIsInput,
      aToB
    );
  }
  const isMaxSwap = nextSqrt === sqrtPriceTarget;
  let amountFixed = amountFixedDelta;
  if (!isMaxSwap) {
    amountFixed = getAmountFixedDelta(
      sqrtPriceCurrent,
      nextSqrt,
      liquidity,
      amountSpecifiedIsInput,
      aToB
    );
  }
  const amountUnfixed = getAmountUnfixedDelta(
    sqrtPriceCurrent,
    nextSqrt,
    liquidity,
    amountSpecifiedIsInput,
    aToB
  );
  let amountIn;
  let amountOut;
  if (amountSpecifiedIsInput) {
    amountIn = amountFixed;
    amountOut = amountUnfixed;
  } else {
    amountIn = amountUnfixed;
    amountOut = amountFixed;
  }
  if (!amountSpecifiedIsInput && amountOut > amountRemaining) {
    amountOut = amountRemaining;
  }
  let feeAmount;
  if (amountSpecifiedIsInput && !isMaxSwap) {
    feeAmount = amountRemaining - amountIn;
  } else {
    feeAmount = mulDivRound(amountIn, fee, FEE_DENOM - fee);
  }
  return { nextSqrt, amountIn, amountOut, feeAmount };
}
function tickIndexToSqrtPriceX64(tick) {
  const absTick = tick < 0 ? -tick : tick;
  let ratio = (absTick & 1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  if ((absTick & 2) !== 0) ratio = ratio * 0xfff97272373d413259a46990580e213an >> 128n;
  if ((absTick & 4) !== 0) ratio = ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn >> 128n;
  if ((absTick & 8) !== 0) ratio = ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n >> 128n;
  if ((absTick & 16) !== 0) ratio = ratio * 0xffcb9843d60f6159c9db58835c926644n >> 128n;
  if ((absTick & 32) !== 0) ratio = ratio * 0xff973b41fa98c081472e6896dfb254c0n >> 128n;
  if ((absTick & 64) !== 0) ratio = ratio * 0xff2ea16466c96a3843ec78b326b52861n >> 128n;
  if ((absTick & 128) !== 0) ratio = ratio * 0xfe5dee046a99a2a811c461f1969c3053n >> 128n;
  if ((absTick & 256) !== 0) ratio = ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n >> 128n;
  if ((absTick & 512) !== 0) ratio = ratio * 0xf987a7253ac413176f2b074cf7815e54n >> 128n;
  if ((absTick & 1024) !== 0) ratio = ratio * 0xf3392b0822b70005940c7a398e4b70f3n >> 128n;
  if ((absTick & 2048) !== 0) ratio = ratio * 0xe7159475a2c29b7443b29c7fa6e89d35n >> 128n;
  if ((absTick & 4096) !== 0) ratio = ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n >> 128n;
  if ((absTick & 8192) !== 0) ratio = ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n >> 128n;
  if ((absTick & 16384) !== 0) ratio = ratio * 0x70d869a156d2a1b890bb3df62baf32f7n >> 128n;
  if ((absTick & 32768) !== 0) ratio = ratio * 0x31be135f97d08fd981231505542fcfa6n >> 128n;
  if ((absTick & 65536) !== 0) ratio = ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n >> 128n;
  if ((absTick & 131072) !== 0) ratio = ratio * 0x5d6af8dedb81196699c329225ee604n >> 128n;
  if ((absTick & 262144) !== 0) ratio = ratio * 0x2216e584f5fa1ea926041bedfe98n >> 128n;
  if ((absTick & 524288) !== 0) ratio = ratio * 0x48a170391f7dc42444e8fa2n >> 128n;
  if (tick > 0) ratio = (1n << 256n) / ratio;
  return ratio >> 32n;
}
function sqrtPriceX64ToTickIndex(sqrtPriceX64) {
  let lo = -443636;
  let hi = 443636;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const midSqrt = tickIndexToSqrtPriceX64(mid);
    if (midSqrt <= sqrtPriceX64) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
function addLiquidityDelta(liquidity, liquidityNet) {
  const next = liquidity + liquidityNet;
  if (next < 0n) throw new Error("ELiquidity");
  return next;
}

// src/poolQuote/pricing/state/turbos/TurbosStateLoader.ts
var TurbosStateLoader = class {
  cache;
  constructor(cache2) {
    this.cache = cache2;
  }
  async load(poolId) {
    const loadedAtMs = Date.now();
    const { result } = await getRpcProviderPool().execute(async (client, url) => {
      const sdk2 = getTurbosSdk(client, url);
      const [pool2, ticks2, checkpoint2, objectVersion2] = await Promise.all([
        sdk2.pool.getPool(poolId),
        sdk2.pool.fetchTicks(poolId),
        fetchLatestCheckpoint(),
        fetchObjectVersion(poolId)
      ]);
      return { pool: pool2, ticks: ticks2, checkpoint: checkpoint2, objectVersion: objectVersion2 };
    }, { label: "turbos.ClmmStateLoader.load" });
    const { pool, ticks: rawTicks, checkpoint, objectVersion } = result;
    const types = pool.types;
    if (!types || types.length < 2) {
      throw new Error(`Turbos pool ${poolId} missing types[]`);
    }
    const tickRaw = pool.tick_current_index;
    const tickCurrent = typeof tickRaw === "number" ? tickRaw : tickRaw && typeof tickRaw === "object" && "bits" in tickRaw ? i32FromBits(Number(tickRaw.bits)) : 0;
    const sdk = getTurbosSdk();
    const ticks = [];
    for (const t of rawTicks) {
      if (t.initialized === false) continue;
      const index = Number(t.tick_index);
      if (!Number.isFinite(index)) continue;
      let sqrtPriceX642;
      try {
        sqrtPriceX642 = BigInt(
          String(sdk.math.tickIndexToSqrtPriceX64(index).toString())
        );
      } catch {
        sqrtPriceX642 = tickIndexToSqrtPriceX64(index);
      }
      ticks.push({
        index,
        liquidityNet: BigInt(String(t.liquidity_net ?? "0")),
        liquidityGross: t.liquidity_gross != null ? BigInt(String(t.liquidity_gross)) : void 0,
        sqrtPriceX64: sqrtPriceX642
      });
    }
    ticks.sort((a, b) => a.index - b.index);
    const tickSpacing = Number(pool.tick_spacing ?? 60);
    const feeRate = Number(pool.fee ?? 0);
    const sqrtPriceX64 = BigInt(String(pool.sqrt_price ?? "0"));
    const liquidity = BigInt(String(pool.liquidity ?? "0"));
    const complete = ticks.length > 0 && sqrtPriceX64 > 0n;
    const snap = {
      poolId: String(pool.objectId ?? poolId),
      venue: "turbos",
      sqrtPriceX64,
      liquidity,
      currentTick: tickCurrent,
      tickSpacing,
      feeRate,
      tokenA: normalizeCoinTypeForMatch(String(types[0])),
      tokenB: normalizeCoinTypeForMatch(String(types[1])),
      decimalsA: 0,
      decimalsB: 0,
      ticks,
      objectVersion: objectVersion ?? void 0,
      checkpoint: checkpoint != null && checkpoint !== "" ? BigInt(checkpoint) : void 0,
      loadedAtMs,
      complete,
      validityReason: complete ? void 0 : "turbos_incomplete_ticks_or_sqrt",
      tickFailureReason: complete ? void 0 : "empty_tick_window"
    };
    if (this.cache.isNewerOrSame(poolId, snap.objectVersion)) {
      this.cache.set(snap);
    }
    return this.cache.get(poolId) ?? snap;
  }
  async refresh(poolId) {
    return this.load(poolId);
  }
  withDecimals(poolId, decimalsA, decimalsB) {
    const cur = this.cache.get(poolId);
    if (!cur) return;
    this.cache.set({ ...cur, decimalsA, decimalsB });
  }
};

// src/poolQuote/pricing/cetus/CetusFastQuoteEngine.ts
init_config();
import BN2 from "bn.js";

// src/poolQuote/chain/state/TickWindowExpander.ts
var TickWindowExpander = class {
  pending = /* @__PURE__ */ new Map();
  expansionsQueued = 0;
  expansionsStarted = 0;
  worker = null;
  running = false;
  setWorker(fn) {
    this.worker = fn;
  }
  /** Non-blocking: record need for expansion. */
  requestExpand(poolId, reason = "tick_window_insufficient") {
    this.expansionsQueued++;
    this.pending.set(poolId, {
      poolId,
      reason,
      requestedAtMs: Date.now(),
      direction: "both"
    });
    void this.pump();
  }
  pendingCount() {
    return this.pending.size;
  }
  drainPending() {
    const out = [...this.pending.values()];
    this.pending.clear();
    return out;
  }
  async pump() {
    if (this.running || !this.worker) return;
    this.running = true;
    try {
      while (this.pending.size > 0) {
        const [id, req] = this.pending.entries().next().value;
        this.pending.delete(id);
        this.expansionsStarted++;
        try {
          await this.worker(req);
        } catch {
        }
      }
    } finally {
      this.running = false;
    }
  }
};
var defaultTickWindowExpander = new TickWindowExpander();

// src/poolQuote/chain/state/tickWindowMeta.ts
var metaByPoolId = /* @__PURE__ */ new Map();
function getTickWindowMeta(snap) {
  return metaByPoolId.get(snap.poolId);
}
function snapshotTickWindowLimited(snap) {
  return getTickWindowMeta(snap)?.limited === true;
}

// src/poolQuote/pricing/state/types.ts
function isTicksDirty(snap) {
  const s = snap?.tickState?.state;
  return s === "dirty" || s === "refreshing" || s === "unknown";
}

// src/poolQuote/pricing/cetus/CetusFastQuoteEngine.ts
var CetusFastQuoteEngine = class {
  venue = "cetus";
  cache;
  maxAgeMs;
  constructor(cache2 = defaultClmmStateCache, maxAgeMs = ARB_CLMM_SNAPSHOT_MAX_AGE_MS) {
    this.cache = cache2;
    this.maxAgeMs = maxAgeMs;
  }
  canQuote(pool, _tokenIn) {
    return pool.venue === "cetus" && ARB_CETUS_LOCAL_QUOTES;
  }
  quoteExactIn(pool, tokenIn, amountIn) {
    const t0 = performance.now();
    if (!this.canQuote(pool, tokenIn)) {
      return fail(amountIn, "cetus_local_disabled", t0);
    }
    if (amountIn <= 0n) return fail(amountIn, "amount_in_non_positive", t0);
    const snap = this.cache.get(pool.id);
    if (!snap) return fail(amountIn, "snapshot_missing", t0);
    const fresh = this.cache.freshness(pool.id, this.maxAgeMs);
    if (fresh?.stale) return fail(amountIn, "stale_snapshot", t0);
    if (!snap.complete) {
      return fail(
        amountIn,
        snap.validityReason ?? `snapshot_incomplete:${snap.tickFailureReason ?? "unknown"}`,
        t0
      );
    }
    const payload = snap.quotePayload;
    if (!payload?.pool || !payload.ticks) {
      return fail(amountIn, "cetus_quote_payload_missing", t0);
    }
    const decA = pool.decimalsA ?? snap.decimalsA;
    const decB = pool.decimalsB ?? snap.decimalsB;
    if (decA == null || decB == null) {
      return fail(amountIn, "cetus_missing_decimals", t0);
    }
    try {
      const poolObj = payload.pool;
      const coinTypeA = String(poolObj.coin_type_a);
      const coinTypeB = String(poolObj.coin_type_b);
      if (!sameCoinType(tokenIn, coinTypeA) && !sameCoinType(tokenIn, coinTypeB)) {
        return fail(amountIn, "cetus_token_in_not_in_pool", t0);
      }
      const a2b = resolveA2b({ coinTypeA, coinTypeB, coinIn: tokenIn });
      const sdk = getCetusSdk();
      const localRaw = sdk.Swap.calculateRates({
        decimals_a: decA,
        decimals_b: decB,
        a2b,
        by_amount_in: true,
        amount: new BN2(amountIn.toString()),
        swap_ticks: payload.ticks,
        current_pool: payload.pool
      });
      const amountOut = BigInt(String(localRaw.estimated_amount_out ?? "0"));
      const feeAmount = BigInt(String(localRaw.estimated_fee_amount ?? "0"));
      const consumed = BigInt(String(localRaw.estimated_amount_in ?? amountIn.toString()));
      const latencyMs = performance.now() - t0;
      if (amountOut <= 0n) {
        return {
          amountIn,
          amountOut: 0n,
          feeAmount,
          authority: "unavailable",
          valid: false,
          reason: "cetus_local_zero_out",
          latencyMs,
          raw: { localRaw, freshness: fresh }
        };
      }
      if (localRaw.is_exceed) {
        const limited = snapshotTickWindowLimited(snap);
        if (isTicksDirty(snap)) {
          return {
            amountIn,
            amountOut: 0n,
            authority: "unavailable",
            valid: false,
            reason: "tick_state_dirty",
            latencyMs,
            raw: { localRaw, freshness: fresh }
          };
        }
        if (limited) {
          defaultTickWindowExpander.requestExpand(pool.id, "tick_window_insufficient");
          return {
            amountIn,
            amountOut: 0n,
            authority: "unavailable",
            valid: false,
            reason: "tick_window_insufficient",
            latencyMs,
            raw: { localRaw, freshness: fresh }
          };
        }
        return {
          amountIn: consumed,
          amountOut,
          feeAmount,
          feeBps: pool.feeBps,
          authority: "local_estimate",
          valid: true,
          reason: "cetus_local_tick_exceed_partial",
          latencyMs,
          raw: { localRaw, freshness: fresh, ticksCrossed: "unknown" }
        };
      }
      if (isTicksDirty(snap)) {
        return {
          amountIn: consumed > 0n ? consumed : amountIn,
          amountOut,
          feeAmount,
          feeBps: pool.feeBps,
          authority: "local_estimate",
          valid: true,
          reason: "local_bounded_dirty_ticks",
          latencyMs,
          raw: { localRaw, freshness: fresh, tickState: snap.tickState }
        };
      }
      return {
        amountIn: consumed > 0n ? consumed : amountIn,
        amountOut,
        feeAmount,
        feeBps: pool.feeBps,
        authority: "local_exact",
        valid: true,
        latencyMs,
        raw: { localRaw, freshness: fresh }
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(amountIn, `cetus_local_error:${msg}`, t0);
    }
  }
};
function fail(amountIn, reason, t0) {
  return {
    amountIn,
    amountOut: 0n,
    authority: "unavailable",
    valid: false,
    reason,
    latencyMs: performance.now() - t0
  };
}
var cetusFastQuoteEngine = new CetusFastQuoteEngine();

// src/poolQuote/pricing/turbos/TurbosFastQuoteEngine.ts
init_config();

// src/poolQuote/quoteMath/turbosExactIn.ts
function nextInitializedTick(ticks, currentTick, aToB) {
  if (aToB) {
    for (let i = ticks.length - 1; i >= 0; i--) {
      const t = ticks[i];
      if (t.index <= currentTick) {
        return { index: t.index, initialized: true, sqrt: t.sqrtPriceX64 };
      }
    }
    return { index: -443636, initialized: false };
  }
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i];
    if (t.index > currentTick) {
      return { index: t.index, initialized: true, sqrt: t.sqrtPriceX64 };
    }
  }
  return { index: 443636, initialized: false };
}
function liquidityNetAt(ticks, index) {
  const t = ticks.find((x) => x.index === index);
  return t?.liquidityNet ?? 0n;
}
function simulateTurbosExactIn(snap, aToB, amountSpecified) {
  if (amountSpecified <= 0n) {
    throw new Error("ESwapAmountSpecifiedZero");
  }
  if (snap.liquidity <= 0n && snap.ticks.length === 0) {
    throw new Error("EInsufficientLiquidity");
  }
  const sqrtPriceLimit = aToB ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n;
  let amountRemaining = amountSpecified;
  let amountCalculated = 0n;
  let sqrtPrice = snap.sqrtPriceX64;
  let tickCurrent = snap.currentTick;
  let liquidity = snap.liquidity;
  let feeAmountTotal = 0n;
  let ticksCrossed = 0;
  const maxSteps = 256;
  for (let step = 0; step < maxSteps && amountRemaining > 0n && sqrtPrice !== sqrtPriceLimit; step++) {
    const next = nextInitializedTick(snap.ticks, tickCurrent, aToB);
    let stepTickNext = next.index;
    if (stepTickNext < -443636) stepTickNext = -443636;
    if (stepTickNext > 443636) stepTickNext = 443636;
    const stepSqrtNext = next.sqrt ?? tickIndexToSqrtPriceX64(stepTickNext);
    const limitHit = aToB ? stepSqrtNext < sqrtPriceLimit : stepSqrtNext > sqrtPriceLimit;
    const target = limitHit ? sqrtPriceLimit : stepSqrtNext;
    const { nextSqrt, amountIn, amountOut, feeAmount } = computeSwapStep(
      sqrtPrice,
      target,
      liquidity,
      amountRemaining,
      true,
      snap.feeRate
    );
    sqrtPrice = nextSqrt;
    amountRemaining = amountRemaining - amountIn - feeAmount;
    if (amountRemaining < 0n) amountRemaining = 0n;
    amountCalculated += amountOut;
    feeAmountTotal += feeAmount;
    if (sqrtPrice === stepSqrtNext) {
      if (next.initialized) {
        let net = liquidityNetAt(snap.ticks, stepTickNext);
        if (aToB) net = -net;
        liquidity = addLiquidityDelta(liquidity, net);
        ticksCrossed++;
      }
      tickCurrent = aToB ? stepTickNext - 1 : stepTickNext;
    } else if (sqrtPrice !== snap.sqrtPriceX64 || step > 0) {
      tickCurrent = sqrtPriceX64ToTickIndex(sqrtPrice);
    }
    if (liquidity === 0n) break;
  }
  return {
    amountIn: amountSpecified - amountRemaining,
    amountOut: amountCalculated,
    feeAmount: feeAmountTotal,
    finalSqrtPriceX64: sqrtPrice,
    finalTick: tickCurrent,
    ticksCrossed,
    exhausted: amountRemaining > 0n
  };
}

// src/poolQuote/quoteMath/turbosStatus.ts
var TURBOS_LOCAL_UNAVAILABLE_REASON = "local_turbos_quote_unavailable";

// src/poolQuote/pricing/turbos/TurbosFastQuoteEngine.ts
var TurbosFastQuoteEngine = class {
  venue = "turbos";
  cache;
  maxAgeMs;
  constructor(cache2 = defaultClmmStateCache, maxAgeMs = ARB_CLMM_SNAPSHOT_MAX_AGE_MS) {
    this.cache = cache2;
    this.maxAgeMs = maxAgeMs;
  }
  canQuote(pool, _tokenIn) {
    return pool.venue === "turbos" && ARB_TURBOS_LOCAL_QUOTES;
  }
  quoteExactIn(pool, tokenIn, amountIn) {
    const t0 = performance.now();
    if (!ARB_TURBOS_LOCAL_QUOTES) {
      return {
        amountIn,
        amountOut: 0n,
        authority: "unavailable",
        valid: false,
        reason: TURBOS_LOCAL_UNAVAILABLE_REASON,
        latencyMs: performance.now() - t0
      };
    }
    if (amountIn <= 0n) {
      return {
        amountIn,
        amountOut: 0n,
        authority: "unavailable",
        valid: false,
        reason: "amount_in_non_positive",
        latencyMs: performance.now() - t0
      };
    }
    const snap = this.cache.get(pool.id);
    if (!snap) {
      return {
        amountIn,
        amountOut: 0n,
        authority: "unavailable",
        valid: false,
        reason: "snapshot_missing",
        latencyMs: performance.now() - t0
      };
    }
    const fresh = this.cache.freshness(pool.id, this.maxAgeMs);
    if (fresh?.stale) {
      return {
        amountIn,
        amountOut: 0n,
        authority: "unavailable",
        valid: false,
        reason: "stale_snapshot",
        latencyMs: performance.now() - t0
      };
    }
    if (!snap.complete) {
      return {
        amountIn,
        amountOut: 0n,
        authority: "unavailable",
        valid: false,
        reason: snap.validityReason ?? "snapshot_incomplete",
        latencyMs: performance.now() - t0
      };
    }
    if (!sameCoinType(tokenIn, snap.tokenA) && !sameCoinType(tokenIn, snap.tokenB)) {
      return {
        amountIn,
        amountOut: 0n,
        authority: "unavailable",
        valid: false,
        reason: "turbos_token_in_not_in_pool",
        latencyMs: performance.now() - t0
      };
    }
    const aToB = sameCoinType(tokenIn, snap.tokenA);
    try {
      const sim = simulateTurbosExactIn(snap, aToB, amountIn);
      const latencyMs = performance.now() - t0;
      if (sim.amountOut <= 0n) {
        return {
          amountIn,
          amountOut: 0n,
          authority: "unavailable",
          valid: false,
          reason: "turbos_local_zero_out",
          latencyMs,
          raw: sim
        };
      }
      if (sim.exhausted && snapshotTickWindowLimited(snap)) {
        defaultTickWindowExpander.requestExpand(pool.id, "tick_window_insufficient");
        return {
          amountIn,
          amountOut: 0n,
          authority: "unavailable",
          valid: false,
          reason: "tick_window_insufficient",
          latencyMs,
          raw: sim
        };
      }
      if (isTicksDirty(snap)) {
        if (sim.ticksCrossed > 0 || sim.exhausted) {
          return {
            amountIn,
            amountOut: 0n,
            authority: "unavailable",
            valid: false,
            reason: "tick_state_dirty",
            latencyMs,
            raw: { ...sim, tickState: snap.tickState }
          };
        }
        return {
          amountIn: sim.amountIn > 0n ? sim.amountIn : amountIn,
          amountOut: sim.amountOut,
          feeAmount: sim.feeAmount,
          feeBps: pool.feeBps,
          authority: "local_estimate",
          valid: true,
          reason: "local_bounded_dirty_ticks",
          latencyMs,
          raw: { ...sim, freshness: fresh, tickState: snap.tickState }
        };
      }
      const authority = ARB_TURBOS_LOCAL_EXACT ? "local_exact" : "local_estimate";
      return {
        amountIn: sim.amountIn > 0n ? sim.amountIn : amountIn,
        amountOut: sim.amountOut,
        feeAmount: sim.feeAmount,
        feeBps: pool.feeBps,
        authority,
        valid: true,
        reason: sim.exhausted ? "turbos_local_partial_liquidity" : void 0,
        latencyMs,
        raw: { ...sim, freshness: fresh }
      };
    } catch (e) {
      return {
        amountIn,
        amountOut: 0n,
        authority: "unavailable",
        valid: false,
        reason: `turbos_local_error:${e instanceof Error ? e.message : String(e)}`,
        latencyMs: performance.now() - t0
      };
    }
  }
};
var turbosFastQuoteEngine = new TurbosFastQuoteEngine();

// src/services/server/quotePoolImpact.ts
var cache = new ClmmStateCache();
var cetusLoader = new CetusStateLoader(cache);
var turbosLoader = new TurbosStateLoader(cache);
var cetusEngine = new CetusFastQuoteEngine(cache);
var turbosEngine = new TurbosFastQuoteEngine(cache);
function marketPoolFromSnap(venue, poolId, tokenA, tokenB, decimalsA, decimalsB) {
  return {
    id: poolId,
    venue,
    tokenA,
    tokenB,
    feeBps: 0,
    decimalsA,
    decimalsB,
    active: true,
    stale: false
  };
}
async function quotePoolImpact(req) {
  const venue = req.venue;
  if (venue !== "cetus" && venue !== "turbos") {
    return { ok: false, error: "unsupported_venue" };
  }
  let amountIn;
  try {
    amountIn = BigInt(req.amountIn);
  } catch {
    return { ok: false, error: "bad_amount_in" };
  }
  if (amountIn <= 0n) return { ok: false, error: "amount_in_non_positive" };
  try {
    if (venue === "cetus") await cetusLoader.load(req.poolId);
    else await turbosLoader.load(req.poolId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return quoteFromLoadedCache(cache, { cetus: cetusEngine, turbos: turbosEngine }, req, amountIn);
}
function quoteFromLoadedCache(state, engines, req, amountIn = BigInt(req.amountIn)) {
  const snap = state.get(req.poolId);
  if (!snap) return { ok: false, error: "snapshot_missing" };
  if (isTicksDirty(snap)) {
    return {
      ok: true,
      valid: false,
      reason: "ticks_dirty",
      ageMs: Date.now() - snap.loadedAtMs
    };
  }
  const pool = marketPoolFromSnap(
    req.venue,
    req.poolId,
    snap.tokenA,
    snap.tokenB,
    snap.decimalsA,
    snap.decimalsB
  );
  const engine = req.venue === "cetus" ? engines.cetus : engines.turbos;
  const q = engine.quoteExactIn(pool, req.tokenIn, amountIn);
  const impact = typeof q.priceImpactBps === "number" && Number.isFinite(q.priceImpactBps) ? q.priceImpactBps : null;
  return {
    ok: true,
    amountOut: q.amountOut.toString(),
    authority: q.authority,
    valid: q.valid,
    reason: q.reason,
    priceImpactBps: impact,
    ageMs: Date.now() - snap.loadedAtMs
  };
}
export {
  quotePoolImpact
};
