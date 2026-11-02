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

// src/services/server/loadPortfolioSnapshot.ts
import { normalizeSuiAddress as normalizeSuiAddress15 } from "@mysten/sui/utils";

// src/utils/deploymentOrigin.ts
function deploymentOrigin() {
  if (typeof window !== "undefined") return null;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  const custom = process.env.SERVER_PUBLIC_URL;
  if (custom) return custom.replace(/\/$/, "");
  return null;
}
function apiUrl(path) {
  const origin = deploymentOrigin();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (origin) return `${origin}${p}`;
  return p;
}

// src/utils/externalFetchUrl.ts
var HOST_PREFIX = {
  "hermes.pyth.network": "/ext/hermes",
  "benchmarks.pyth.network": "/ext/bench",
  "api.dexscreener.com": "/ext/ds",
  "api.geckoterminal.com": "/ext/gt",
  "api.dexpaprika.com": "/ext/dp",
  "api.coingecko.com": "/ext/cg",
  "web3.okx.com": "/ext/okx",
  "dapi.api.sui-prod.bluefin.io": "/ext/bf-dapi",
  "swap.api.sui-prod.bluefin.io": "/ext/bf-swap",
  "open-api.naviprotocol.io": "/ext/navi",
  // SUI JSON-RPC fullnode — same-origin proxy to prevent Chrome extension interception
  "fullnode.mainnet.sui.io": "/ext/sui-rpc",
  "sui-grpc.publicnode.com": "/ext/sui-grpc-publicnode"
};
function extFetchUrl(absoluteUrl) {
  return extFetchUrlWithContext(absoluteUrl, {
    inBrowser: typeof window !== "undefined",
    dev: !!import.meta.env?.DEV
  });
}
function extFetchUrlWithContext(absoluteUrl, ctx) {
  try {
    const u = new URL(absoluteUrl);
    if (!HOST_PREFIX[u.host]) return absoluteUrl;
    if (!ctx.inBrowser) return absoluteUrl;
    if (ctx.dev) {
      const prefix = HOST_PREFIX[u.host];
      return `${prefix}${u.pathname}${u.search}`;
    }
    const path = `${u.pathname}${u.search}`;
    return apiUrl(`/api/ext?host=${encodeURIComponent(u.host)}&path=${encodeURIComponent(path)}`);
  } catch {
    return absoluteUrl;
  }
}

// src/utils/suiRpcUrl.ts
var DEFAULT_MAINNET_JSON_RPC_URL = "https://mainnet.suiet.app";
var DASHBOARD_RPC_FALLBACK_URLS = [DEFAULT_MAINNET_JSON_RPC_URL];
var DEPRECATED_JSON_RPC_HOSTS = /* @__PURE__ */ new Set([
  "fullnode.mainnet.sui.io",
  "fullnode.testnet.sui.io",
  "fullnode.devnet.sui.io",
  "sui-rpc.publicnode.com",
  "sui.publicnode.com",
  "sui.api.onfinality.io"
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
    if (DEPRECATED_JSON_RPC_HOSTS.has(host)) {
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
function resolveBrowserRpcUrl() {
  const absolute = resolveSuiRpcUrl();
  if (typeof window === "undefined") return absolute;
  const isDev = Boolean(import.meta.env?.DEV);
  if (!isDev) {
    return extFetchUrl(absolute);
  }
  const proxied = extFetchUrl(absolute);
  if (proxied !== absolute && proxied.startsWith("/")) return proxied;
  try {
    const u = new URL(absolute);
    return `/ext/sui-rpc${u.pathname}${u.search}`;
  } catch {
    return "/ext/sui-rpc";
  }
}

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
  healthScore(now2 = Date.now()) {
    if (this.circuit === "OPEN" && this.quarantinedUntil != null && now2 < this.quarantinedUntil) {
      return 0;
    }
    const total = this.requestCount || 1;
    const successRate = this.successCount / total;
    const lat = this.latency.stats();
    const latPenalty = lat.p95 > 0 ? Math.min(1, lat.p95 / 3e3) : 0;
    const failPenalty = Math.min(1, this.consecutiveFailures / 5);
    return Math.max(0, Math.min(1, successRate * (1 - 0.4 * latPenalty) * (1 - 0.5 * failPenalty)));
  }
  isHardDown(now2 = Date.now()) {
    return this.hardDownUntil != null && now2 < this.hardDownUntil;
  }
  isUsable(now2 = Date.now()) {
    this.maybeAdvanceCircuit(now2);
    if (this.isHardDown(now2)) return false;
    return this.circuit === "CLOSED" || this.circuit === "HALF_OPEN";
  }
  maybeAdvanceCircuit(now2 = Date.now()) {
    if (this.circuit === "OPEN" && this.quarantinedUntil != null && now2 >= this.quarantinedUntil) {
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
    const now2 = Date.now();
    for (const p of this.providers) {
      if (p.isHardDown(now2)) continue;
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
      const pct2 = r.requestCount > 0 ? `${(100 * r.successCount / r.requestCount).toFixed(1)}%` : "n/a";
      lines.push(
        r.label.padEnd(28) + pct2.padStart(9) + String(r.timeoutCount).padStart(8) + String(r.count429).padStart(5) + String(r.count5xx).padStart(5) + `${Math.round(r.latency.p50)}`.padStart(7) + `${Math.round(r.latency.p95)}`.padStart(7) + `  ${r.healthScore.toFixed(2).padStart(5)}  ${r.circuit}`
      );
    }
    return lines.join("\n");
  }
  /** Keep public nodes under their request-per-second cap. */
  acquireSlot() {
    return new Promise((resolve) => {
      const start = () => {
        this.inFlight++;
        const now2 = Date.now();
        const wait = Math.max(0, this.nextStartAt - now2);
        this.nextStartAt = Math.max(this.nextStartAt, now2) + MIN_GAP_MS;
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
  pickOrder(now2 = Date.now()) {
    for (const p of this.providers) p.maybeAdvanceCircuit(now2);
    const alive = this.providers.filter((p) => !p.isHardDown(now2));
    const base = alive.length > 0 ? alive : [...this.providers];
    const usable = base.filter((p) => p.isUsable(now2));
    const pool = usable.length > 0 ? usable : base;
    const preferred = this.providers[this.preferredIndex];
    pool.sort((a, b) => {
      if (preferred && a === preferred) return -1;
      if (preferred && b === preferred) return 1;
      if (a.circuit === "HALF_OPEN" && b.circuit !== "HALF_OPEN") return 1;
      if (b.circuit === "HALF_OPEN" && a.circuit !== "HALF_OPEN") return -1;
      return b.healthScore(now2) - a.healthScore(now2);
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
function createPooledSuiClient(pool) {
  const handler = {
    get(_target, prop, receiver) {
      if (prop === "then") return void 0;
      const sample = pool.activeClient();
      const val = Reflect.get(sample, prop, receiver);
      if (typeof val !== "function") return val;
      return (...args) => pool.call((c) => {
        const fn = Reflect.get(c, prop);
        return Promise.resolve(fn.apply(c, args));
      });
    }
  };
  return new Proxy(pool.activeClient(), handler);
}

// src/rpc/dashboardPool.ts
function envStr(name) {
  if (typeof process !== "undefined" && process.env) {
    const v = process.env[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  try {
    const meta = import.meta.env;
    const v = meta?.[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
  }
  return void 0;
}
function envNum(name, fallback) {
  const raw = envStr(name);
  const n2 = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n2) && n2 > 0 ? n2 : fallback;
}
function splitCsv(raw) {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
function toBrowserUrl(absolute) {
  try {
    const proxied = extFetchUrl(absolute);
    if (proxied !== absolute) return proxied;
  } catch {
  }
  return absolute;
}
function parseDashboardRpcUrls() {
  const fromList = splitCsv(envStr("SUI_RPC_URLS") ?? envStr("VITE_SUI_RPC_URLS"));
  const primary = envStr("SUI_RPC_URL") ?? envStr("VITE_SUI_RPC_URL");
  const list = [...fromList];
  if (primary) {
    const n2 = normalizeSuiRpcUrl(primary);
    if (!list.map(normalizeSuiRpcUrl).includes(n2)) list.unshift(n2);
  }
  for (const u of DASHBOARD_RPC_FALLBACK_URLS) {
    const n2 = normalizeSuiRpcUrl(u);
    if (!list.map(normalizeSuiRpcUrl).includes(n2)) list.push(n2);
  }
  const abs = list.length > 0 ? list.map(normalizeSuiRpcUrl) : [resolveServerSuiRpcUrl()];
  const unique = [...new Set(abs)];
  if (typeof window === "undefined") return unique;
  return selectBrowserDashboardRpcUrls(unique, resolveBrowserRpcUrl(), toBrowserUrl);
}
function selectBrowserDashboardRpcUrls(absoluteUrls, browserPrimary, rewrite) {
  const extras = absoluteUrls.map((u) => {
    try {
      return rewrite(u);
    } catch {
      return u;
    }
  }).filter((u) => u.startsWith("/") && u !== browserPrimary);
  return [.../* @__PURE__ */ new Set([browserPrimary, ...extras])];
}
var sharedPool = null;
var sharedClient = null;
function getDashboardRpcPool() {
  if (!sharedPool) {
    sharedPool = new RpcProviderPool({
      urls: parseDashboardRpcUrls(),
      timeoutMs: envNum("SUI_RPC_TIMEOUT_MS", envNum("VITE_SUI_RPC_TIMEOUT_MS", 8e3)),
      failuresBeforeQuarantine: envNum("SUI_RPC_FAILURES_BEFORE_QUARANTINE", 2),
      // Soft quarantine — PublicNode/Suiet flap; health probe re-opens ~20s.
      quarantineMs: envNum("SUI_RPC_QUARANTINE_MS", 12e3),
      retriesPerProvider: 0
    });
  }
  return sharedPool;
}
function getDashboardSuiClient() {
  if (!sharedClient) {
    sharedClient = createPooledSuiClient(getDashboardRpcPool());
  }
  return sharedClient;
}

// src/services/suiData/createGrpcClient.ts
import { SuiGrpcClient } from "@mysten/sui/grpc";

// src/services/suiData/config.ts
function envStr2(name) {
  if (typeof process !== "undefined" && process.env) {
    const v = process.env[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  try {
    const meta = import.meta.env;
    const v = meta?.[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
  }
  return void 0;
}
var MYSTEN_PUBLIC_GRPC_URL = "https://fullnode.mainnet.sui.io";
var PUBLICNODE_PUBLIC_GRPC_URL = "https://sui-grpc.publicnode.com:443";
var MYSTEN_PUBLIC_GRAPHQL_URL = "https://graphql.mainnet.sui.io/graphql";
var BLOCKVISION_GRPC_WEB_URL = "https://sui-mainnet-grpc-web.blockvision.org";
function resolvePublicGrpcEndpoints() {
  const key = resolveBlockvisionApiKey();
  const fromEnv = envStr2("VITE_SUI_GRPC_URL") ?? envStr2("SUI_GRPC_URL");
  if (fromEnv) return [fromEnv.replace(/\/$/, "")];
  const listRaw = envStr2("SUI_GRPC_ENDPOINTS") ?? envStr2("VITE_SUI_GRPC_ENDPOINTS");
  if (listRaw) {
    const resolved = listRaw.split(",").map((part) => resolveGrpcEndpointAlias(part.trim())).filter((u) => Boolean(u));
    if (resolved.length > 0) return resolved;
  }
  if (key) return [BLOCKVISION_GRPC_WEB_URL];
  return [MYSTEN_PUBLIC_GRPC_URL];
}
var GRPC_ENDPOINT_ALIASES = {
  publicnode: PUBLICNODE_PUBLIC_GRPC_URL,
  mysten: MYSTEN_PUBLIC_GRPC_URL,
  blockvision: BLOCKVISION_GRPC_WEB_URL
};
function resolveGrpcEndpointAlias(token) {
  if (!token) return null;
  const alias = GRPC_ENDPOINT_ALIASES[token.toLowerCase()];
  if (alias) return alias.replace(/\/$/, "");
  if (/^https?:\/\//i.test(token)) return token.replace(/\/$/, "");
  return null;
}
function resolveSuiDataTransport() {
  const raw = (envStr2("VITE_SUI_DATA_TRANSPORT") ?? envStr2("SUI_DATA_TRANSPORT") ?? "grpc").toLowerCase();
  return raw === "jsonrpc" ? "jsonrpc" : "grpc";
}
function resolveBlockvisionApiKey() {
  return envStr2("VITE_BLOCKVISION_API_KEY") ?? envStr2("BLOCKVISION_API_KEY");
}
function resolveSuiGrpcUrl() {
  const key = resolveBlockvisionApiKey();
  const fromEnv = envStr2("VITE_SUI_GRPC_URL") ?? envStr2("SUI_GRPC_URL");
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (key) return BLOCKVISION_GRPC_WEB_URL;
  return MYSTEN_PUBLIC_GRPC_URL;
}
function resolveSuiGraphqlUrl() {
  return (envStr2("VITE_SUI_GRAPHQL_URL") ?? envStr2("SUI_GRAPHQL_URL") ?? MYSTEN_PUBLIC_GRAPHQL_URL).replace(/\/$/, "");
}

// src/services/suiData/createGrpcClient.ts
function browserGrpcBaseUrl(absolute) {
  const cleaned = absolute.replace(/\/$/, "");
  try {
    const proxied = extFetchUrl(cleaned);
    if (proxied !== cleaned && proxied.startsWith("/")) {
      if (typeof window !== "undefined") return `${window.location.origin}${proxied}`;
      return proxied;
    }
  } catch {
  }
  return cleaned;
}
var shared = null;
function createDashboardGrpcClient(opts = {}) {
  const network = opts.network ?? "mainnet";
  const apiKey = opts.apiKey === void 0 ? resolveBlockvisionApiKey() : opts.apiKey ?? void 0;
  const absolute = (opts.baseUrl ?? resolveSuiGrpcUrl()).replace(/\/$/, "");
  const meta = apiKey ? { "x-api-key": apiKey } : void 0;
  const baseUrl = typeof window !== "undefined" ? browserGrpcBaseUrl(absolute) : absolute;
  return new SuiGrpcClient({
    network,
    baseUrl,
    meta
  });
}
function getDashboardGrpcClient() {
  if (!shared) shared = createDashboardGrpcClient();
  return shared;
}
function _resetDashboardGrpcClientForTests() {
  shared = null;
}

// src/services/suiData/throttle.ts
var MAX_IN_FLIGHT2 = 3;
var MIN_GAP_MS2 = 80;
var inFlight = 0;
var lastStart = 0;
var waiters = [];
function kick() {
  while (inFlight < MAX_IN_FLIGHT2 && waiters.length > 0) {
    const now2 = Date.now();
    const wait = Math.max(0, MIN_GAP_MS2 - (now2 - lastStart));
    if (wait > 0 && inFlight > 0) {
      setTimeout(kick, wait);
      return;
    }
    const next = waiters.shift();
    if (!next) return;
    inFlight += 1;
    lastStart = Date.now();
    next();
  }
}
async function withSuiDataThrottle(fn) {
  await new Promise((resolve) => {
    waiters.push(resolve);
    kick();
  });
  try {
    return await fn();
  } finally {
    inFlight = Math.max(0, inFlight - 1);
    kick();
  }
}

// src/services/suiReadProfiler.ts
var counts = {
  getObject: 0,
  multiGetObjects: 0,
  getOwnedObjects: 0,
  queryEvents: 0,
  devInspect: 0,
  graphql: 0,
  other: 0
};
function isSuiReadProfilingEnabled() {
  const v = typeof process !== "undefined" && process.env?.SUI_LP_ADVISOR_PROFILE || typeof import.meta !== "undefined" && import.meta.env?.SUI_LP_ADVISOR_PROFILE;
  return v === "1" || v === "true";
}
function recordSuiRead(method, batchSize = 1) {
  if (!isSuiReadProfilingEnabled()) return;
  const n2 = Math.max(1, batchSize);
  switch (method) {
    case "getObject":
      counts.getObject += n2;
      break;
    case "multiGetObjects":
      counts.multiGetObjects += n2;
      break;
    case "getOwnedObjects":
      counts.getOwnedObjects += n2;
      break;
    case "queryEvents":
      counts.queryEvents += n2;
      break;
    case "devInspectTransactionBlock":
      counts.devInspect += n2;
      break;
    case "graphql":
      counts.graphql += n2;
      break;
    default:
      counts.other += n2;
  }
}

// src/services/suiData/graphqlClient.ts
function graphqlEndpoint() {
  const absolute = resolveSuiGraphqlUrl();
  if (typeof window === "undefined") return absolute;
  try {
    const proxied = extFetchUrl(absolute);
    return proxied;
  } catch {
    return absolute;
  }
}
async function suiGraphqlRequest(query, variables) {
  return withSuiDataThrottle(async () => {
    recordSuiRead("graphql");
    const apiKey = resolveBlockvisionApiKey();
    const headers = { "content-type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;
    const res = await fetch(graphqlEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(2e4)
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(`GraphQL HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 240)}`);
    }
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message).join("; "));
    }
    if (body.data == null) throw new Error("GraphQL empty data");
    return body.data;
  });
}

// src/services/suiData/encodeDfName.ts
import { bcs } from "@mysten/sui/bcs";
function isHexAddress(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v);
}
function encodeValue(type, value) {
  const t = type.trim();
  if (t === "0x2::object::ID" || t.endsWith("::object::ID") || t === "address") {
    if (!isHexAddress(value) && typeof value !== "string") {
      throw new Error(`dynamic field ID expects address string, got ${typeof value}`);
    }
    return bcs.Address.serialize(String(value)).toBytes();
  }
  if (t.endsWith("::i32::I32") || t.endsWith("::I32") || typeof value === "object" && value != null && "bits" in value) {
    const bits = typeof value === "object" && value != null && "bits" in value ? Number(value.bits) : Number(value);
    return bcs.u32().serialize(bits >>> 0).toBytes();
  }
  if (t === "u64" || t.endsWith("::u64") || typeof value === "string" && /^\d+$/.test(value)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      return bcs.u64().serialize(value).toBytes();
    }
  }
  if (t === "u128") {
    return bcs.u128().serialize(value).toBytes();
  }
  if (t === "u8") return bcs.u8().serialize(Number(value)).toBytes();
  if (t === "u16") return bcs.u16().serialize(Number(value)).toBytes();
  if (t === "u32") return bcs.u32().serialize(Number(value)).toBytes();
  if (t === "bool") return bcs.bool().serialize(Boolean(value)).toBytes();
  if (t === "0x1::string::String" || t.endsWith("::string::String") || t.includes("::dynamic_object_field::Wrapper<0x1::string::String>")) {
    return bcs.string().serialize(String(value)).toBytes();
  }
  if (t.endsWith("::type_name::TypeName") || t === "0x1::type_name::TypeName") {
    const name = typeof value === "string" ? value : typeof value === "object" && value != null && "name" in value ? String(value.name) : null;
    if (name == null) throw new Error("TypeName dynamic field expects { name: string }");
    return bcs.struct("TypeName", { name: bcs.string() }).serialize({ name }).toBytes();
  }
  if (isHexAddress(value)) {
    return bcs.Address.serialize(value).toBytes();
  }
  throw new Error(`Unsupported dynamic field name type for BCS encode: ${t}`);
}
function encodeLegacyDfName(name) {
  return {
    type: name.type,
    bcs: encodeValue(name.type, name.value)
  };
}

// src/services/suiData/mapObject.ts
function mapGrpcObjectToLegacy(obj) {
  if (!obj?.objectId) return null;
  const type = obj.type ?? "unknown";
  const fields = obj.json && typeof obj.json === "object" ? obj.json : null;
  return {
    objectId: obj.objectId,
    version: String(obj.version ?? "0"),
    digest: obj.digest,
    type,
    owner: obj.owner,
    content: fields ? {
      dataType: "moveObject",
      type,
      fields,
      hasPublicTransfer: true
    } : null
  };
}
function legacyObjectResponse(obj) {
  if (obj instanceof Error) {
    return { data: null, error: { code: "notExists", message: obj.message } };
  }
  const data = mapGrpcObjectToLegacy(obj ?? void 0);
  if (!data) return { data: null, error: { code: "notExists" } };
  return { data };
}
function optionsToInclude(options) {
  const wantContent = options?.showContent !== false;
  return {
    // BCS content rarely used by dashboard; json drives legacy fields.
    json: wantContent || options?.showContent === true,
    content: options?.showBcs === true,
    display: options?.showDisplay === true,
    type: true
  };
}

// src/services/suiData/jsonRpcCompat.ts
function asOwner(input) {
  return typeof input === "string" ? input : input.owner;
}
async function paginateBalances(client, owner) {
  const all = [];
  let cursor;
  for (let i = 0; i < 40; i++) {
    const page = await withSuiDataThrottle(
      () => client.listBalances({ owner, cursor: cursor ?? void 0, limit: 50 })
    );
    for (const b of page.balances ?? []) {
      all.push({
        coinType: b.coinType,
        totalBalance: b.balance,
        coinObjectCount: 0,
        lockedBalance: {}
      });
    }
    if (!page.hasNextPage) break;
    cursor = page.cursor;
    if (!cursor) break;
  }
  return all;
}
function mapEventFilter(query) {
  if (!query || typeof query !== "object") return {};
  if ("Sender" in query && typeof query.Sender === "string") {
    return { grpc: { sender: query.Sender }, gql: { sender: query.Sender } };
  }
  if ("MoveEventType" in query && typeof query.MoveEventType === "string") {
    return {
      grpc: { eventType: query.MoveEventType },
      gql: { type: query.MoveEventType }
    };
  }
  if ("MoveEventModule" in query) {
    const m = query.MoveEventModule;
    const pkg = m?.package;
    const mod = m?.module;
    if (pkg && mod) {
      const emitModule = `${pkg}::${mod}`;
      return { grpc: { emitModule }, gql: { module: emitModule } };
    }
  }
  if ("MoveModule" in query) {
    const m = query.MoveModule;
    if (m?.package && m?.module) {
      const emitModule = `${m.package}::${m.module}`;
      return { grpc: { emitModule }, gql: { module: emitModule } };
    }
  }
  return {};
}
function isoToMs(iso) {
  if (!iso) return null;
  const n2 = Date.parse(iso);
  return Number.isFinite(n2) ? String(n2) : null;
}
async function queryEventsGraphql(args) {
  const mapped = mapEventFilter(args.query);
  const filter = mapped.gql ?? {};
  const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 50) : 50;
  const descending = args.order !== "ascending";
  const cursor = typeof args.cursor === "string" ? args.cursor : null;
  const data = await suiGraphqlRequest(
    `query($filter: EventFilter, $first: Int, $after: String, $last: Int, $before: String) {
      events(filter: $filter, first: $first, after: $after, last: $last, before: $before) {
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        nodes {
          timestamp
          sequenceNumber
          sender { address }
          transactionModule { package { address } name }
          contents { type { repr } json }
          transaction { digest }
        }
      }
    }`,
    descending ? { filter, last: limit, before: cursor } : { filter, first: limit, after: cursor }
  );
  let nodes = data.events.nodes ?? [];
  if (descending) nodes = [...nodes].reverse();
  const pageInfo = data.events.pageInfo;
  const nextCursor = descending ? pageInfo.hasPreviousPage ? pageInfo.startCursor ?? null : null : pageInfo.hasNextPage ? pageInfo.endCursor ?? null : null;
  return {
    data: nodes.map((n2) => {
      const typeStr = n2.contents?.type?.repr ?? "";
      const digest = n2.transaction?.digest ?? "";
      const seq = n2.sequenceNumber != null ? String(n2.sequenceNumber) : "0";
      return {
        id: { txDigest: digest, eventSeq: seq },
        packageId: n2.transactionModule?.package?.address ?? "",
        transactionModule: n2.transactionModule?.name ?? "",
        sender: n2.sender?.address ?? "",
        type: typeStr,
        parsedJson: n2.contents?.json ?? null,
        bcs: void 0,
        timestampMs: isoToMs(n2.timestamp)
      };
    }),
    hasNextPage: descending ? !!pageInfo.hasPreviousPage : !!pageInfo.hasNextPage,
    nextCursor
  };
}
async function queryTxByAffectedObject(args) {
  const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 50) : 50;
  const descending = args.order !== "ascending";
  const cursor = typeof args.cursor === "string" ? args.cursor : null;
  const wantEvents = !!args.options?.showEvents;
  const data = await suiGraphqlRequest(
    `query($oid: SuiAddress!, $first: Int, $after: String, $last: Int, $before: String) {
      transactions(
        filter: { affectedObject: $oid }
        first: $first
        after: $after
        last: $last
        before: $before
      ) {
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        nodes {
          digest
          sender { address }
          effects {
            timestamp
            events {
              nodes {
                sequenceNumber
                contents { type { repr } json }
              }
            }
          }
        }
      }
    }`,
    descending ? { oid: args.objectId, last: limit, before: cursor } : { oid: args.objectId, first: limit, after: cursor }
  );
  let nodes = data.transactions.nodes ?? [];
  if (descending) nodes = [...nodes].reverse();
  const pageInfo = data.transactions.pageInfo;
  const nextCursor = descending ? pageInfo.hasPreviousPage ? pageInfo.startCursor ?? null : null : pageInfo.hasNextPage ? pageInfo.endCursor ?? null : null;
  return {
    data: nodes.map((n2) => ({
      digest: n2.digest,
      timestampMs: isoToMs(n2.effects?.timestamp),
      transaction: void 0,
      effects: { status: { status: "success" } },
      events: wantEvents ? (n2.effects?.events?.nodes ?? []).map((e) => ({
        type: e.contents?.type?.repr ?? "",
        parsedJson: e.contents?.json ?? null,
        id: {
          txDigest: n2.digest ?? "",
          eventSeq: e.sequenceNumber != null ? String(e.sequenceNumber) : "0"
        }
      })) : void 0
    })),
    hasNextPage: descending ? !!pageInfo.hasPreviousPage : !!pageInfo.hasNextPage,
    nextCursor
  };
}
function mapTxFilter(filter) {
  if (!filter) return { kind: "none" };
  if ("FromAddress" in filter && typeof filter.FromAddress === "string") {
    return { kind: "sender", value: filter.FromAddress };
  }
  if ("ChangedObject" in filter && typeof filter.ChangedObject === "string") {
    return { kind: "affected", value: filter.ChangedObject };
  }
  if ("InputObject" in filter && typeof filter.InputObject === "string") {
    return { kind: "affected", value: filter.InputObject };
  }
  if ("AffectedObject" in filter && typeof filter.AffectedObject === "string") {
    return { kind: "affected", value: filter.AffectedObject };
  }
  return { kind: "none" };
}
function mapGrpcTxToLegacy(result, options) {
  const body = result.Transaction ?? result.FailedTransaction ?? result;
  const digest = body.digest;
  const events = Array.isArray(body.events) ? body.events.map((e, i) => ({
    type: e.eventType ?? e.type ?? "",
    parsedJson: e.json ?? e.parsedJson ?? null,
    id: {
      txDigest: digest ?? "",
      eventSeq: e.eventIndex != null ? String(e.eventIndex) : String(i)
    },
    timestampMs: body.timestampMs != null ? String(body.timestampMs) : null,
    sender: e.sender
  })) : void 0;
  return {
    digest,
    timestampMs: body.timestampMs != null ? String(body.timestampMs) : null,
    checkpoint: body.checkpoint != null ? String(body.checkpoint) : void 0,
    effects: body.effects ? {
      status: {
        status: body.status?.success === false ? "failure" : "success"
      },
      ...body.effects ?? {}
    } : void 0,
    transaction: options?.showInput ? body.transaction : void 0,
    events: options?.showEvents ? events : void 0,
    balanceChanges: options?.showBalanceChanges ? body.balanceChanges : void 0,
    objectChanges: options?.showObjectChanges ? body.effects?.changedObjects : void 0
  };
}
function createJsonRpcCompatClient(grpc = getDashboardGrpcClient()) {
  const client = {
    async getAllBalances(input) {
      return paginateBalances(grpc, asOwner(input));
    },
    async getBalance(input) {
      const { balance } = await withSuiDataThrottle(
        () => grpc.getBalance({ owner: input.owner, coinType: input.coinType })
      );
      return {
        coinType: balance.coinType,
        totalBalance: balance.balance,
        coinObjectCount: 0,
        lockedBalance: {}
      };
    },
    async getCoinMetadata(input) {
      const res = await withSuiDataThrottle(() => grpc.getCoinMetadata({ coinType: input.coinType }));
      const m = res.coinMetadata;
      if (!m) return null;
      return {
        id: m.id,
        decimals: m.decimals,
        name: m.name,
        symbol: m.symbol,
        description: m.description,
        iconUrl: m.iconUrl || null
      };
    },
    async getObject(input) {
      recordSuiRead("getObject");
      const include = optionsToInclude(input.options);
      try {
        const { object } = await withSuiDataThrottle(
          () => grpc.getObject({ objectId: input.id, include })
        );
        return legacyObjectResponse(object);
      } catch (e) {
        return {
          data: null,
          error: { code: "notExists", message: e instanceof Error ? e.message : String(e) }
        };
      }
    },
    async multiGetObjects(input) {
      recordSuiRead("multiGetObjects", input.ids?.length ?? 1);
      const include = optionsToInclude(input.options);
      const { objects } = await withSuiDataThrottle(
        () => grpc.getObjects({ objectIds: input.ids, include })
      );
      return (objects ?? []).map((o) => legacyObjectResponse(o));
    },
    async getOwnedObjects(input) {
      recordSuiRead("getOwnedObjects");
      const include = optionsToInclude(input.options);
      const structType = input.filter && typeof input.filter === "object" && "StructType" in input.filter ? String(input.filter.StructType) : void 0;
      const page = await withSuiDataThrottle(
        () => grpc.listOwnedObjects({
          owner: input.owner,
          type: structType,
          cursor: input.cursor ?? void 0,
          limit: input.limit ?? void 0,
          include
        })
      );
      return {
        data: (page.objects ?? []).map((o) => legacyObjectResponse(o)),
        hasNextPage: !!page.hasNextPage,
        nextCursor: page.cursor ?? null
      };
    },
    async getDynamicFields(input) {
      const page = await withSuiDataThrottle(
        () => grpc.listDynamicFields({
          parentId: input.parentId,
          cursor: input.cursor ?? void 0,
          limit: input.limit ?? void 0
        })
      );
      return {
        data: (page.dynamicFields ?? []).map((f) => ({
          name: f.name,
          bcsName: void 0,
          type: f.$kind === "DynamicObject" ? "DynamicObject" : "DynamicField",
          objectId: f.fieldId ?? f.objectId
        })),
        hasNextPage: !!page.hasNextPage,
        nextCursor: page.cursor ?? null
      };
    },
    async getDynamicFieldObject(input) {
      const name = encodeLegacyDfName(input.name);
      const include = { json: true, type: true };
      try {
        const { object } = await withSuiDataThrottle(
          () => grpc.getDynamicObjectField({ parentId: input.parentId, name, include })
        );
        return legacyObjectResponse(object);
      } catch {
        try {
          const { dynamicField } = await withSuiDataThrottle(
            () => grpc.getDynamicField({ parentId: input.parentId, name })
          );
          const fieldId = dynamicField.fieldId;
          if (!fieldId) {
            return { data: null, error: { code: "dynamicFieldNotFound", message: "missing fieldId" } };
          }
          const { object } = await withSuiDataThrottle(
            () => grpc.getObject({ objectId: fieldId, include })
          );
          return legacyObjectResponse(object);
        } catch (e) {
          return {
            data: null,
            error: { code: "dynamicFieldNotFound", message: e instanceof Error ? e.message : String(e) }
          };
        }
      }
    },
    async queryEvents(input) {
      recordSuiRead("queryEvents");
      return queryEventsGraphql(input);
    },
    async queryTransactionBlocks(input) {
      const mapped = mapTxFilter(input.filter);
      if (mapped.kind === "affected" && mapped.value) {
        return queryTxByAffectedObject({
          objectId: mapped.value,
          cursor: input.cursor,
          limit: input.limit,
          order: input.order,
          options: input.options
        });
      }
      const filter = mapped.kind === "sender" && mapped.value ? { sender: mapped.value } : void 0;
      const include = {
        effects: true,
        events: !!input.options?.showEvents,
        transaction: !!input.options?.showInput,
        balanceChanges: !!input.options?.showBalanceChanges
      };
      const descending = input.order !== "ascending";
      const page = await withSuiDataThrottle(
        () => grpc.listTransactions({
          filter,
          limit: input.limit ?? void 0,
          order: descending ? "descending" : "ascending",
          before: descending && typeof input.cursor === "string" ? input.cursor : void 0,
          after: !descending && typeof input.cursor === "string" ? input.cursor : void 0,
          include
        })
      );
      return {
        data: (page.transactions ?? []).map((t) => mapGrpcTxToLegacy(t, input.options)),
        hasNextPage: !!page.hasNextPage,
        nextCursor: page.endCursor ?? null
      };
    },
    async getTransactionBlock(input) {
      const include = {
        effects: true,
        events: !!input.options?.showEvents,
        transaction: !!input.options?.showInput,
        balanceChanges: !!input.options?.showBalanceChanges
      };
      const result = await withSuiDataThrottle(
        () => grpc.getTransaction({ digest: input.digest, include })
      );
      return mapGrpcTxToLegacy(result, input.options);
    },
    async multiGetTransactionBlocks(input) {
      const out = [];
      for (const digest of input.digests) {
        out.push(await client.getTransactionBlock({ digest, options: input.options }));
      }
      return out;
    },
    /**
     * Legacy `sui_devInspectTransactionBlock` → gRPC `simulateTransaction`.
     * Shape expected by Navi / Current / Bluefin / Cetus accrued helpers:
     * `{ error?, results?: [{ returnValues: [[bytes, typeTag], ...] }] }`.
     */
    async devInspectTransactionBlock(input) {
      recordSuiRead("devInspectTransactionBlock");
      const tx = input.transactionBlock;
      try {
        tx.setSenderIfNotSet?.(input.sender);
        tx.setSender?.(input.sender);
      } catch {
      }
      const result = await withSuiDataThrottle(
        () => grpc.simulateTransaction({
          transaction: input.transactionBlock,
          checksEnabled: false,
          include: { commandResults: true, effects: true, events: true }
        })
      );
      const failed = result.$kind === "FailedTransaction";
      const body = result.Transaction ?? result.FailedTransaction;
      const statusErr = failed || body?.status?.success === false ? body?.status?.error?.message ?? "Simulation failed" : null;
      const commandResults = result.commandResults ?? [];
      const results = commandResults.map((cmd) => ({
        returnValues: (cmd.returnValues ?? []).map((out) => {
          const bytes = out.bcs instanceof Uint8Array ? Array.from(out.bcs) : [];
          return [bytes, ""];
        }),
        mutableReferenceOutputs: (cmd.mutatedReferences ?? []).map((out) => {
          const bytes = out.bcs instanceof Uint8Array ? Array.from(out.bcs) : [];
          return [bytes, ""];
        })
      }));
      const rawEvents = Array.isArray(body?.events) ? body.events : [];
      const events = rawEvents.map((e) => {
        const eventType = typeof e.eventType === "string" && e.eventType || typeof e.type === "string" && e.type || "";
        const parsedJson = e.json && typeof e.json === "object" ? e.json : e.parsedJson && typeof e.parsedJson === "object" ? e.parsedJson : null;
        return {
          type: eventType,
          eventType,
          parsedJson,
          packageId: typeof e.packageId === "string" ? e.packageId : void 0,
          transactionModule: typeof e.module === "string" ? e.module : void 0,
          sender: typeof e.sender === "string" ? e.sender : void 0,
          bcs: e.bcs
        };
      });
      return {
        error: statusErr,
        effects: {
          status: { status: statusErr ? "failure" : "success", error: statusErr }
        },
        results,
        events
      };
    },
    async getNormalizedMoveFunction(input) {
      const res = await withSuiDataThrottle(
        () => grpc.getMoveFunction({
          packageId: input.package,
          moduleName: input.module,
          name: input.function
        })
      );
      const fn = res.function ?? res;
      return {
        visibility: fn.visibility ?? "Public",
        isEntry: Boolean(fn.isEntry),
        params: fn.parameters ?? [],
        return: fn.returns ?? fn.return ?? [],
        typeParameters: fn.typeParameters ?? []
      };
    },
    /** Escape hatch for native gRPC methods (listBalances, listOwnedObjects, …). */
    get grpc() {
      return grpc;
    }
  };
  return client;
}
var sharedCompat = null;
function getJsonRpcCompatClient() {
  if (!sharedCompat) sharedCompat = createJsonRpcCompatClient();
  return sharedCompat;
}
function _resetJsonRpcCompatClientForTests() {
  sharedCompat = null;
}

// src/services/portfolioReadRpcSource.ts
var active = null;
var jsonRpcFallbackReason = null;
function resetPortfolioReadRpcSource() {
  active = null;
  jsonRpcFallbackReason = null;
}
function recordPortfolioReadRpcSource(source) {
  active = source;
  if (source !== "jsonrpc") jsonRpcFallbackReason = null;
}
function recordPortfolioJsonRpcFallback(reason) {
  active = "jsonrpc";
  jsonRpcFallbackReason = reason;
}
function grpcUrlToRpcSource(url) {
  const u = url.replace(/\/$/, "").toLowerCase();
  if (u.includes("publicnode")) return "publicnode-grpc";
  if (u.includes("blockvision")) return "blockvision-grpc";
  const mysten = MYSTEN_PUBLIC_GRPC_URL.replace(/\/$/, "").toLowerCase();
  if (u === mysten || u.includes("sui-grpc") || u.includes("fullnode.mainnet.sui.io")) {
    return "mysten-grpc";
  }
  if (u === PUBLICNODE_PUBLIC_GRPC_URL.replace(/\/$/, "").toLowerCase()) return "publicnode-grpc";
  if (u === BLOCKVISION_GRPC_WEB_URL.replace(/\/$/, "").toLowerCase()) return "blockvision-grpc";
  return "custom-grpc";
}

// src/services/grpcEndpointHealth.ts
var PORTFOLIO_GRPC_PROBE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.PORTFOLIO_GRPC_PROBE_TIMEOUT_MS ?? 4e3);
  return Number.isFinite(raw) && raw >= 500 && raw <= 1e4 ? raw : 4e3;
})();
var PORTFOLIO_GRPC_CALL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.PORTFOLIO_GRPC_CALL_TIMEOUT_MS ?? process.env.PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS ?? 15e3);
  return Number.isFinite(raw) && raw >= 3e3 && raw <= 6e4 ? raw : 15e3;
})();
var PORTFOLIO_GRPC_CALL_RETRIES = (() => {
  const raw = Number(process.env.PORTFOLIO_GRPC_CALL_RETRIES ?? 1);
  return Number.isFinite(raw) && raw >= 0 && raw <= 3 ? raw : 1;
})();
var PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES = (() => {
  const raw = Number(process.env.PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES ?? 3);
  return Number.isFinite(raw) && raw >= 1 && raw <= 10 ? raw : 3;
})();
var PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS = (() => {
  const raw = Number(process.env.PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS ?? 5 * 6e4);
  return Number.isFinite(raw) && raw >= 1e4 ? raw : 5 * 6e4;
})();
var cooldownUntilByUrl = /* @__PURE__ */ new Map();
var consecutiveFailuresByUrl = /* @__PURE__ */ new Map();
var stickyEndpointIndex = 0;
var lastPublicNodeFailureReason = null;
var hasLockedGrpcWinner = false;
function _resetGrpcEndpointHealthForTests() {
  cooldownUntilByUrl.clear();
  consecutiveFailuresByUrl.clear();
  stickyEndpointIndex = 0;
  lastPublicNodeFailureReason = null;
  hasLockedGrpcWinner = false;
}
function hasGrpcEndpointWinner() {
  return hasLockedGrpcWinner;
}
function isGrpcEndpointOnCooldown(url, nowMs = Date.now()) {
  const until = cooldownUntilByUrl.get(url);
  return until != null && nowMs < until;
}
function classifyGrpcFailureReason(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("grpc probe timeout")) {
    return `probe-timeout:${PORTFOLIO_GRPC_PROBE_TIMEOUT_MS}ms`;
  }
  if (lower.includes("grpc call timeout")) {
    return `call-timeout:${PORTFOLIO_GRPC_CALL_TIMEOUT_MS}ms`;
  }
  if (lower.includes("grpc attempt timeout")) {
    return `call-timeout:${PORTFOLIO_GRPC_CALL_TIMEOUT_MS}ms`;
  }
  if (/enotfound|getaddrinfo|dns|name not resolved/i.test(lower)) return "dns";
  if (/certificate|cert_|tls|ssl|handshake/i.test(lower)) return "tls";
  const http = msg.match(/\b(401|403|429|500|502|503|504)\b/);
  if (http) return `http:${http[1]}`;
  if (/econnrefused|connection refused/i.test(lower)) return "conn:refused";
  if (/resource_exhausted|resource exhausted/i.test(lower)) return "grpc:resource_exhausted";
  if (/unavailable|deadline|econnreset/i.test(lower)) return "grpc:unavailable";
  if (/fetch failed|network/i.test(lower)) return "network:fetch-failed";
  if (/invalid grpc request content-type|grpc-web-text/i.test(lower)) return "grpc:invalid-content-type";
  return `error:${msg.slice(0, 160)}`;
}
function shouldCooldownImmediately(reason) {
  return /^(dns|tls|conn:refused|network:fetch-failed|grpc:invalid-content-type)/.test(reason);
}
function isImmediateGrpcEndpointFailure(err) {
  return shouldCooldownImmediately(classifyGrpcFailureReason(err));
}
function logEndpointFailure(url, reason, enteringCooldown) {
  const label = grpcUrlToRpcSource(url);
  const suffix = enteringCooldown ? " (cooldown)" : "";
  console.warn(`[portfolio-read] grpc skip ${label} (${url}): ${reason}${suffix}`);
  if (url.replace(/\/$/, "") === PUBLICNODE_PUBLIC_GRPC_URL.replace(/\/$/, "")) {
    lastPublicNodeFailureReason = reason;
  }
}
function markGrpcEndpointFailed(url, err, nowMs = Date.now()) {
  const reason = classifyGrpcFailureReason(err);
  const prev = consecutiveFailuresByUrl.get(url) ?? 0;
  const next = prev + 1;
  consecutiveFailuresByUrl.set(url, next);
  const enteringCooldown = shouldCooldownImmediately(reason) || next >= PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES;
  if (enteringCooldown) {
    cooldownUntilByUrl.set(url, nowMs + PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS);
  }
  logEndpointFailure(url, reason, enteringCooldown);
  return reason;
}
function markGrpcEndpointSuccess(index, url) {
  stickyEndpointIndex = index;
  hasLockedGrpcWinner = true;
  if (url) consecutiveFailuresByUrl.set(url, 0);
}
function planGrpcEndpointTryOrder(endpointCount, urls, nowMs = Date.now()) {
  if (endpointCount <= 0) return [];
  const avail = [];
  const pushIf = (i) => {
    if (i < 0 || i >= endpointCount) return;
    if (avail.includes(i)) return;
    if (isGrpcEndpointOnCooldown(urls[i], nowMs)) return;
    avail.push(i);
  };
  pushIf(stickyEndpointIndex);
  for (let i = 0; i < endpointCount; i++) pushIf(i);
  if (avail.length > 0) return avail;
  return [stickyEndpointIndex, ...Array.from({ length: endpointCount }, (_, i) => i).filter((i) => i !== stickyEndpointIndex)];
}
async function withTimeout(fn, ms, label) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`grpc ${label} timeout after ${ms}ms`)),
          ms
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function withGrpcProbeTimeout(fn) {
  return withTimeout(fn, PORTFOLIO_GRPC_PROBE_TIMEOUT_MS, "probe");
}
async function withGrpcCallTimeout(fn) {
  return withTimeout(fn, PORTFOLIO_GRPC_CALL_TIMEOUT_MS, "call");
}

// src/services/portfolioSuiReadClient.ts
function isGrpcTransportFailure(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|network|ECONNREFUSED|UNAVAILABLE|DEADLINE|RESOURCE_EXHAUSTED|resource.exhausted|grpc|timeout|502|503|504|429/i.test(
    msg
  );
}
function resetPortfolioJsonRpcFallbackReason() {
}
async function invokeGrpcOnEndpoint(endpointIndex, endpoints, _urls, prop, args, receiver, opts) {
  const { url, client } = endpoints[endpointIndex];
  const fn = Reflect.get(client, prop, receiver);
  if (typeof fn !== "function") {
    throw new TypeError(`suiClient.${String(prop)} is not a function`);
  }
  const runWithTimeout = opts.probe ? withGrpcProbeTimeout : withGrpcCallTimeout;
  const attempts = opts.probe ? 1 : PORTFOLIO_GRPC_CALL_RETRIES + 1;
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const out = await runWithTimeout(
        () => Promise.resolve(fn.apply(client, args))
      );
      markGrpcEndpointSuccess(endpointIndex, url);
      recordPortfolioReadRpcSource(grpcUrlToRpcSource(url));
      return out;
    } catch (e) {
      lastErr = e;
      if (opts.recordFailure && isGrpcTransportFailure(e)) {
        markGrpcEndpointFailed(url, e);
      }
      if (isImmediateGrpcEndpointFailure(e)) break;
      if (attempt + 1 >= attempts || !isGrpcTransportFailure(e)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
async function invokeThroughGrpcEndpoints(endpoints, urls, prop, args, receiver, opts = {}) {
  const probe = opts.probe === true;
  const order = planGrpcEndpointTryOrder(endpoints.length, urls);
  if (order.length === 0) throw new Error("no grpc endpoints configured");
  const callOne = (i) => invokeGrpcOnEndpoint(i, endpoints, urls, prop, args, receiver, {
    probe,
    recordFailure: true
  });
  if (!hasGrpcEndpointWinner() && order.length > 1 && probe) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let failures = 0;
      let lastErr2;
      for (const i of order) {
        void callOne(i).then((out) => {
          if (settled) return;
          settled = true;
          resolve(out);
        }).catch((e) => {
          lastErr2 = e;
          failures++;
          if (!settled && failures >= order.length) {
            reject(lastErr2 instanceof Error ? lastErr2 : new Error(String(lastErr2)));
          }
        });
      }
    });
  }
  let lastErr;
  for (const i of order) {
    try {
      return await callOne(i);
    } catch (e) {
      lastErr = e;
      if (!isGrpcTransportFailure(e)) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
function wrapGrpcEndpointFailover(endpoints) {
  if (endpoints.length === 0) return getJsonRpcCompatClient();
  const urls = endpoints.map((e) => e.url);
  return new Proxy(endpoints[0].client, {
    get(_target, prop, receiver) {
      const first = Reflect.get(endpoints[0].client, prop, receiver);
      if (typeof first !== "function") return first;
      return (...args) => invokeThroughGrpcEndpoints(endpoints, urls, prop, args, receiver);
    }
  });
}
function wrapPortfolioReadWithJsonRpcFallback(primary) {
  const fallback = getDashboardSuiClient();
  return new Proxy(primary, {
    get(_target, prop, receiver) {
      if (prop === "grpc") {
        return primary.grpc;
      }
      const primaryVal = Reflect.get(primary, prop, receiver);
      if (typeof primaryVal !== "function") {
        return primaryVal;
      }
      return async (...args) => {
        const fn = Reflect.get(primary, prop, receiver);
        if (typeof fn !== "function") {
          throw new TypeError(`suiClient.${String(prop)} is not a function`);
        }
        try {
          return await fn.apply(primary, args);
        } catch (e) {
          if (!isGrpcTransportFailure(e)) throw e;
          const reason = classifyGrpcFailureReason(e);
          recordPortfolioJsonRpcFallback(reason);
          console.warn(
            `[portfolio-read] jsonrpc fallback on ${String(prop)}: ${reason}`
          );
          const fbFn = Reflect.get(fallback, prop, receiver);
          if (typeof fbFn !== "function") throw e;
          return fbFn.apply(fallback, args);
        }
      };
    }
  });
}
function createGrpcCompatStack() {
  const urls = resolvePublicGrpcEndpoints();
  const endpoints = urls.map((url) => ({
    url,
    client: createJsonRpcCompatClient(createDashboardGrpcClient({ baseUrl: url }))
  }));
  return wrapGrpcEndpointFailover(endpoints);
}
function createPortfolioReadSuiClient() {
  if (resolveSuiDataTransport() === "jsonrpc") {
    recordPortfolioReadRpcSource("jsonrpc");
    return getDashboardSuiClient();
  }
  return wrapPortfolioReadWithJsonRpcFallback(createGrpcCompatStack());
}
var shared2 = null;
function getPortfolioReadSuiClient() {
  if (!shared2) shared2 = createPortfolioReadSuiClient();
  return shared2;
}
function _resetPortfolioReadSuiClientForTests() {
  shared2 = null;
  resetPortfolioReadRpcSource();
  resetPortfolioJsonRpcFallbackReason();
  _resetGrpcEndpointHealthForTests();
  _resetJsonRpcCompatClientForTests();
  _resetDashboardGrpcClientForTests();
}

// src/services/suiClient.ts
var suiClient = new Proxy({}, {
  get(_target, prop, receiver) {
    const client = getPortfolioReadSuiClient();
    const val = Reflect.get(client, prop, receiver);
    if (typeof val === "function") {
      return val.bind(client);
    }
    return val;
  }
});
function defaultRpcUrl() {
  return typeof window === "undefined" ? resolveServerSuiRpcUrl() : resolveBrowserRpcUrl();
}
function getRpcUrl() {
  return defaultRpcUrl();
}

// src/utils/formatting.ts
import Decimal from "decimal.js";
var STABLECOIN_SYMBOLS_UPPER = new Set(
  [
    "USDC",
    "USDT",
    "DAI",
    "BUSD",
    "TUSD",
    "USDD",
    "FDUSD",
    "USDP",
    "PYUSD",
    "USDE",
    "AUSD",
    "USDY",
    "USDX"
  ].map((s) => s.toUpperCase())
);

// src/services/spotPrice/spotChange24h.ts
function needs24h(r) {
  if (r.price == null) return false;
  if (r.change24h == null || !Number.isFinite(r.change24h)) return true;
  return false;
}

// src/config/priceSources.ts
var PYTH_USD_FEEDS = {
  SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  USDT: "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  WBTC: "0xc9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33",
  /* Підтверджено через GET /v2/price_feeds?query=…&asset_type=crypto */
  NAVX: "0x88250f854c019ef4f88a5c073d52a18bb1c6ac437033f5932cd017d24917ab46",
  DEEP: "0x29bdd5248234e33bd93d3b81100b5fa32eaa5997843847e2c2cb16d7c6d9f7ff"
};
var COINGECKO_IDS_BY_SYMBOL = {
  SUI: "sui",
  USDC: "usd-coin",
  USDT: "tether",
  BTC: "bitcoin",
  ETH: "ethereum",
  WBTC: "wrapped-bitcoin",
  WETH: "weth",
  CETUS: "cetus-protocol",
  SCA: "scallop-protocol",
  BLUE: "bluefin",
  MMT: "momentum-finance",
  DEEP: "deepbook",
  BSUI: "bucket-protocol",
  OST: "sui-ost",
  /* Додаткові id для `simple/price` 24h (р/n символи з метаданих); інше — GeckoTerminal. */
  STSUI: "alphafi-staked-sui",
  WAL: "walrus-2",
  NS: "suins-2",
  NAVX: "navx",
  E4C: "e4c",
  VSUI: "volo"
};

// src/utils/apiProxy.ts
function isProdBuild() {
  return Boolean(import.meta.env.PROD);
}
function okxCredsFromProcess() {
  if (typeof process === "undefined") return null;
  const key = process.env.OKX_API_KEY ?? process.env.VITE_OKX_API_KEY;
  const secret = process.env.OKX_SECRET_KEY ?? process.env.VITE_OKX_SECRET_KEY;
  const pass = process.env.OKX_PASSPHRASE ?? process.env.VITE_OKX_PASSPHRASE;
  if (key && secret && pass) return { key, secret, pass };
  return null;
}
function coingeckoKeyFromProcess() {
  if (typeof process === "undefined") return null;
  const key = process.env.COINGECKO_API_KEY ?? process.env.VITE_COINGECKO_API_KEY;
  if (!key || key.length < 3) return null;
  return key;
}
async function hmacSha256Base64(secret, message) {
  const te = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, te.encode(message));
  const b = new Uint8Array(sig);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
async function okxProxyFetch(method, path, bodyStr = "") {
  if (typeof window !== "undefined" || deploymentOrigin()) {
    return fetch(apiUrl("/api/okx"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, path, body: bodyStr }),
      signal: AbortSignal.timeout(3e4)
    });
  }
  const creds = okxCredsFromProcess();
  if (!creds) {
    return new Response(JSON.stringify({ code: "1", msg: "OKX credentials missing" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
  const p = path.startsWith("/") ? path : `/${path}`;
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const pre = `${ts}${method}${p}${method === "POST" ? bodyStr : ""}`;
  const sign = await hmacSha256Base64(creds.secret, pre);
  return fetch(`https://web3.okx.com${p}`, {
    method,
    headers: {
      ...method === "POST" ? { "Content-Type": "application/json" } : {},
      "OK-ACCESS-KEY": creds.key,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": creds.pass
    },
    body: method === "POST" ? bodyStr : void 0,
    signal: AbortSignal.timeout(3e4)
  });
}
async function coingeckoProxyFetch(pathWithQuery) {
  if (typeof window !== "undefined" || deploymentOrigin()) {
    return fetch(apiUrl("/api/coingecko"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathWithQuery }),
      signal: AbortSignal.timeout(15e3)
    });
  }
  const key = coingeckoKeyFromProcess();
  const p = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const headers = {};
  if (key) headers["x-cg-demo-api-key"] = key;
  return fetch(`https://api.coingecko.com${p}`, {
    headers,
    signal: AbortSignal.timeout(15e3)
  });
}

// src/services/spotPrice/coingecko24hBatch.ts
var CG_FREE_BASE = "https://api.coingecko.com/api/v3";
function buildSimplePriceUrl(base, ids) {
  const u = new URL(`${base}/simple/price`);
  u.searchParams.set("ids", ids.join(","));
  u.searchParams.set("vs_currencies", "usd");
  u.searchParams.set("include_24hr_change", "true");
  return u;
}
async function fetchCgUrl(url, headers) {
  try {
    const r = await fetch(extFetchUrl(url.toString()), { headers, signal: AbortSignal.timeout(8e3) });
    if (r.ok) return await r.json();
  } catch {
  }
  return {};
}
async function coingeckoSimpleBatch(ids) {
  if (ids.length === 0) return {};
  const uniq = [...new Set(ids)];
  const key = (typeof import.meta.env.VITE_COINGECKO_API_KEY === "string" && import.meta.env.VITE_COINGECKO_API_KEY.length > 0 ? import.meta.env.VITE_COINGECKO_API_KEY : void 0) ?? (typeof process !== "undefined" ? process.env.COINGECKO_API_KEY ?? process.env.VITE_COINGECKO_API_KEY : void 0);
  if (isProdBuild() && typeof key === "string" && key.length >= 3) {
    const u2 = buildSimplePriceUrl(CG_FREE_BASE, uniq);
    const path = `${u2.pathname}${u2.search}`;
    try {
      const r = await coingeckoProxyFetch(path);
      if (r.ok) return await r.json();
    } catch {
    }
  }
  if (typeof key === "string" && key.length >= 3) {
    const u2 = buildSimplePriceUrl(CG_FREE_BASE, uniq);
    const hit = await fetchCgUrl(u2, { "x-cg-demo-api-key": String(key) });
    if (Object.keys(hit).length > 0) return hit;
  }
  const u = buildSimplePriceUrl(CG_FREE_BASE, uniq);
  return fetchCgUrl(u, {});
}
function coingeckoIdForSymbol(symbol) {
  return COINGECKO_IDS_BY_SYMBOL[symbol.toUpperCase()] ?? null;
}

// src/services/spotPrice/aftermathSpot.ts
import { Aftermath } from "aftermath-ts-sdk";
var sdk = null;
var initFailed = false;
var inFlight2 = null;
async function getSdk() {
  if (initFailed) return null;
  if (sdk) return sdk;
  if (inFlight2) return inFlight2;
  inFlight2 = (async () => {
    try {
      const a = new Aftermath("MAINNET");
      await a.init({ fullnodeUrl: getRpcUrl() });
      sdk = a;
      return a;
    } catch {
      initFailed = true;
      return null;
    } finally {
      inFlight2 = null;
    }
  })();
  return inFlight2;
}
function normalizeAftermath24h(fraction) {
  if (!Number.isFinite(fraction)) return null;
  if (Math.abs(fraction) > 1.5) return fraction;
  if (Math.abs(fraction) < 1e-6) return null;
  return fraction * 100;
}
async function fetchAftermathBatch(coinTypes) {
  if (coinTypes.length === 0) return {};
  const a = await getSdk();
  if (!a) return {};
  try {
    const p = a.Prices();
    const m = await p.getCoinsToPriceInfo({ coins: coinTypes });
    const out = {};
    for (const c of coinTypes) {
      const info = m[c];
      if (info && typeof info.price === "number" && Number.isFinite(info.price) && info.price > 0) {
        const ch = normalizeAftermath24h(info.priceChange24HoursPercentage);
        out[c] = { price: info.price, change24h: ch };
      }
    }
    return out;
  } catch {
    return {};
  }
}

// src/utils/constants.ts
var GECKO_NETWORK = "sui-network";
var PROTOCOL_PACKAGES = {
  CETUS_CLMM: "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb",
  /** Cetus DLMM `dlmm_pool.package_id` from `@cetusprotocol/dlmm-sdk` 1.3.3 `dlmmMainnet`. */
  CETUS_DLMM: "0x5664f9d3fd82c84023870cfbda8ea84e14c8dd56ce557ad2116e0668581a682b",
  /** Cetus DLMM `dlmm_pool.published_at` (upgrade pointer). */
  CETUS_DLMM_PUBLISHED_AT: "0x6b989f9b05bd11a00f1c7779443d66802c5e71631f59e87be5d2a616991f151e",
  /** Sync with [@mmt-finance/clmm-sdk](https://github.com/mmt-finance/clmm-sdk) MainnetConfig + [офіційні deployments](https://developers.mmt.finance/clmm-smart-contracts/deployments). */
  MOMENTUM_CLMM: "0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1",
  /** Для повного шляху MoveEvent (`published_at::liquidity::…`); не плутати з packageId. */
  MOMENTUM_PUBLISHED_AT: "0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860",
  /** Bluefin Spot AMM/CLMM (pools, positions NFT) */
  BLUEFIN_CLMM: "0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267",
  /** older constant name in repo — spot router package */
  BLUEFIN_SPOT: "0xb104ecc75397f3a65735ef26c85a037da1d197e26f4f275a9990a577ba0e6c4c",
  /** Original package-id — stable across upgrades, used for NFT StructType filter.
   *  Source: turbos.gitbook.io/turbos/developer-docs/dev-overview */
  TURBOS: "0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1",
  /** Latest published-at upgrade (v0.1.8) — prefix for current event types. */
  TURBOS_PUBLISHED_AT: "0xa5a0c25c79e428eba04fb98b3fb2a34db45ab26d4c8faf0d7e39d66a63891e64",
  /** Shared Positions table — parentId for dynamic field lookup by nftId. */
  TURBOS_POSITIONS_TABLE: "0xf5762ae5ae19a2016bb233c72d9a4b2cba5a302237a82724af66292ae43ae52d",
  FLOWX_V3: "0xba153169476e8c3114962261d1edc70de5ad9781b83cc617ecc8c1923191cae0",
  AFTERMATH: "0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c",
  SCALLOP_MARKET: "0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9",
  SCALLOP_VERSION: "0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7"
};
var MOMENTUM_PUBLISHED_AT = PROTOCOL_PACKAGES.MOMENTUM_PUBLISHED_AT;
var SCALLOP_SCOIN_TYPES = [
  "0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI"
];
var MOMENTUM_LST_TYPES = [
  "0x2b6602099970374cf58a2a1b9d96f005fccceb81e92eb059873baf420eb6c717::x_sui::X_SUI"
];
var PROTOCOL_TOKEN_VERIFIED = /* @__PURE__ */ new Set([
  ...SCALLOP_SCOIN_TYPES,
  ...MOMENTUM_LST_TYPES
]);
var MIN_UNVERIFIED_VALUE_USD = 0.01;
var RPC_CONCURRENCY = 10;

// src/services/spotPrice/http.ts
var GT_HEADER = { Accept: "application/json;version=20230302" };

// src/services/spotPrice/geckoSimpleBatch.ts
var GT = "https://api.geckoterminal.com/api/v2";
var CHUNK = 30;
async function geckoTokenPricesBatch(coinTypes) {
  if (coinTypes.length === 0) return {};
  const out = {};
  for (let i = 0; i < coinTypes.length; i += CHUNK) {
    const slice = coinTypes.slice(i, i + CHUNK);
    const addrs = slice.join(",");
    const u = extFetchUrl(
      `${GT}/simple/networks/${GECKO_NETWORK}/token_price/${encodeURIComponent(addrs)}`
    );
    try {
      const r = await fetch(u, { headers: GT_HEADER, signal: AbortSignal.timeout(8e3) });
      if (!r.ok) continue;
      const j = await r.json();
      const tp = j.data?.attributes?.token_prices;
      if (!tp) continue;
      for (const c of slice) {
        const s = tp[c];
        if (s == null) continue;
        const p = Number(s);
        out[c] = Number.isFinite(p) && p > 0 ? p : null;
      }
    } catch {
    }
  }
  return out;
}

// src/services/spotPrice/geckoTokenDetail.ts
function poolIdToAddress(relationshipId) {
  const prefix = `${GECKO_NETWORK}_`;
  if (relationshipId.startsWith(prefix)) return relationshipId.slice(prefix.length);
  return null;
}
async function change24hFromTopPool(tokenJson) {
  const relId = tokenJson.data?.relationships?.top_pools?.data?.[0]?.id;
  if (!relId) return null;
  const poolAddr = poolIdToAddress(relId);
  if (!poolAddr) return null;
  const u = extFetchUrl(
    `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools/${encodeURIComponent(poolAddr)}`
  );
  try {
    const r = await fetch(u, { headers: GT_HEADER, signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return null;
    const j = await r.json();
    const h = j.data?.attributes?.price_change_percentage?.h24;
    if (h == null || h === "") return null;
    const n2 = Number(h);
    return Number.isFinite(n2) ? n2 : null;
  } catch {
    return null;
  }
}
function parseTokenAttributes(j) {
  const a = j.data?.attributes;
  if (!a?.price_usd) return { price: null, change24h: null };
  const price = Number(a.price_usd);
  const p = Number.isFinite(price) ? price : null;
  const raw = a.h24_price_change_percentage;
  if (raw != null && raw !== "") {
    const c = Number(raw);
    if (Number.isFinite(c)) return { price: p, change24h: c };
  }
  return { price: p, change24h: null };
}
async function geckoTokenDetail(coinType) {
  const tryOne = async (ct) => {
    const u = extFetchUrl(
      `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens/${encodeURIComponent(ct)}`
    );
    const r = await fetch(u, { headers: GT_HEADER, signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return null;
    const j = await r.json();
    const base = parseTokenAttributes(j);
    if (base.change24h != null) return base;
    if (base.price == null) return base;
    const ch = await change24hFromTopPool(j);
    if (ch != null) return { ...base, change24h: ch };
    return base;
  };
  try {
    const first = await tryOne(coinType);
    if (first) return first;
    const parts = coinType.split("::");
    const short = parts[0]?.startsWith("0x") ? parts[0] : null;
    if (short && short !== coinType) {
      return await tryOne(short) ?? { price: null, change24h: null };
    }
  } catch {
  }
  return { price: null, change24h: null };
}

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

// src/services/spotPrice/dexScreenerSpot.ts
var DS = "https://api.dexscreener.com";
function pickBest(pairs, coinTypeNorm) {
  const pkgNorm = (coinTypeNorm.split("::")[0] ?? "").toLowerCase();
  const matchFull = (addr) => !!addr && normalizeCoinTypeForMatch(addr) === coinTypeNorm;
  const matchPkg = (addr) => {
    if (!addr) return false;
    const p = addr.split("::")[0] ?? addr;
    try {
      return normalizeCoinTypeForMatch(p).toLowerCase() === pkgNorm;
    } catch {
      return p.toLowerCase() === pkgNorm;
    }
  };
  const byLiq = (a, b) => parseFloat(String(b.liquidity?.usd ?? "0")) - parseFloat(String(a.liquidity?.usd ?? "0"));
  const fullBase = pairs.filter((p) => matchFull(p.baseToken?.address));
  if (fullBase.length > 0) return [...fullBase].sort(byLiq)[0];
  const pkgBase = pairs.filter((p) => matchPkg(p.baseToken?.address) && !matchPkg(p.quoteToken?.address));
  if (pkgBase.length > 0) return [...pkgBase].sort(byLiq)[0];
  const fullQuote = pairs.filter((p) => matchFull(p.quoteToken?.address));
  if (fullQuote.length > 0) return [...fullQuote].sort(byLiq)[0];
  const pkgAny = pairs.filter((p) => matchPkg(p.baseToken?.address) || matchPkg(p.quoteToken?.address));
  if (pkgAny.length > 0) {
    const pkgAnyBase = pkgAny.filter((p) => matchPkg(p.baseToken?.address));
    return [...pkgAnyBase.length > 0 ? pkgAnyBase : pkgAny].sort(byLiq)[0];
  }
  if (pairs.length === 0) return null;
  return [...pairs].sort(byLiq)[0];
}
function parsePair(top) {
  const price = parseFloat(String(top.priceUsd ?? ""));
  if (!Number.isFinite(price) || price <= 0) return null;
  const h = top.priceChange?.h24;
  return {
    price,
    change24h: h != null && Number.isFinite(h) ? h : null
  };
}
function packageId(coinType) {
  const p0 = coinType.split("::")[0];
  return p0?.startsWith("0x") ? p0 : null;
}
async function dexScreenerPrice(coinType) {
  const norm2 = normalizeCoinTypeForMatch(coinType);
  const addr = packageId(coinType);
  if (addr) {
    try {
      const u = extFetchUrl(`${DS}/latest/dex/tokens/${addr}`);
      const r = await fetch(u, { signal: AbortSignal.timeout(8e3) });
      if (r.ok) {
        const j = await r.json();
        const pairs = j.pairs;
        if (pairs?.length) {
          const top = pickBest(pairs, norm2);
          if (top) {
            const p = parsePair(top);
            if (p) return { price: p.price, change24h: p.change24h };
          }
        }
      }
    } catch {
    }
  }
  try {
    const u = extFetchUrl(`${DS}/latest/dex/search?q=${encodeURIComponent(coinType)}`);
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    const pairs = j.pairs;
    if (!pairs?.length) return null;
    const top = pickBest(pairs, norm2);
    if (!top) return null;
    const p = parsePair(top);
    return p ? { price: p.price, change24h: p.change24h } : null;
  } catch {
    return null;
  }
}

// src/services/spotPrice/dexpPaprikaSpot.ts
var DEXP = "https://api.dexpaprika.com";
async function dexpPaprikaPrice(coinType, symbol) {
  try {
    return await dexpPaprikaPriceInner(coinType, symbol);
  } catch {
    return null;
  }
}
async function dexpPaprikaPriceInner(coinType, symbol) {
  const want = normalizeCoinTypeForMatch(coinType);
  const tryDetail = async (idPath) => {
    const u = extFetchUrl(`${DEXP}/networks/sui/tokens/${idPath}`);
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    const s = j.summary;
    if (!s?.price_usd) return null;
    const h24 = s["24h"];
    const ch = typeof h24 === "object" && h24 != null && "last_price_usd_change" in h24 ? h24.last_price_usd_change : null;
    return {
      price: s.price_usd,
      change24h: typeof ch === "number" && Number.isFinite(ch) ? ch : null
    };
  };
  const enc = encodeURIComponent(want);
  let q = await tryDetail(enc);
  if (q) return q;
  const su = extFetchUrl(
    `${DEXP}/search?query=${encodeURIComponent(symbol)}&networks=${encodeURIComponent("sui")}`
  );
  const sr = await fetch(su);
  if (sr.ok) {
    const j = await sr.json();
    const tok = (j.tokens ?? []).find(
      (t) => t.chain === "sui" && t.id && normalizeCoinTypeForMatch(t.id) === want
    );
    if (tok && typeof tok.price_usd === "number" && Number.isFinite(tok.price_usd)) {
      return {
        price: tok.price_usd,
        change24h: typeof tok.price_usd_change === "number" ? tok.price_usd_change : null
      };
    }
  }
  const s2 = await fetch(
    extFetchUrl(`${DEXP}/search?query=${encodeURIComponent(coinType)}&networks=sui`)
  );
  if (s2.ok) {
    const j2 = await s2.json();
    const tok2 = (j2.tokens ?? []).find(
      (t) => t.chain === "sui" && t.id && normalizeCoinTypeForMatch(t.id) === want
    );
    if (tok2 && typeof tok2.price_usd === "number" && Number.isFinite(tok2.price_usd)) {
      return {
        price: tok2.price_usd,
        change24h: typeof tok2.price_usd_change === "number" ? tok2.price_usd_change : null
      };
    }
  }
  return null;
}

// src/services/spotPrice/okxDexApi.ts
var CHAIN_SUI = "784";
var PRICE_INFO_PATH = "/api/v6/dex/market/price-info";
var BATCH = 100;
var DEFAULT_FETCH_TIMEOUT_MS = 12e3;
var DEFAULT_FETCH_RETRIES = 2;
var DEFAULT_RETRY_BACKOFF_MS = 1500;
var OKX_CIRCUIT_OPEN_MS = 4 * 60 * 1e3;
var _okxCircuitTrippedAt = 0;
function okxCircuitOpen() {
  return Date.now() - _okxCircuitTrippedAt < OKX_CIRCUIT_OPEN_MS;
}
function okxTripCircuit() {
  if (!okxCircuitOpen()) {
    _okxCircuitTrippedAt = Date.now();
    if (import.meta.env.DEV) {
      console.warn("[OKX] circuit tripped \u2014 skipping OKX calls for", OKX_CIRCUIT_OPEN_MS / 6e4, "min");
    }
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function okxFetchTimeoutMs() {
  const v = import.meta.env.VITE_OKX_TIMEOUT_MS;
  const n2 = v != null && v !== "" ? Number.parseInt(String(v), 10) : Number.NaN;
  if (Number.isFinite(n2) && n2 >= 5e3 && n2 <= 3e5) return n2;
  return DEFAULT_FETCH_TIMEOUT_MS;
}
function okxFetchExtraRetries() {
  const v = import.meta.env.VITE_OKX_RETRIES;
  const n2 = v != null && v !== "" ? Number.parseInt(String(v), 10) : Number.NaN;
  if (Number.isFinite(n2) && n2 >= 0 && n2 <= 5) return n2;
  return DEFAULT_FETCH_RETRIES;
}
function okxCreds() {
  const key = import.meta.env.VITE_OKX_API_KEY || (typeof process !== "undefined" ? process.env.OKX_API_KEY ?? process.env.VITE_OKX_API_KEY : void 0);
  const secret = import.meta.env.VITE_OKX_SECRET_KEY || (typeof process !== "undefined" ? process.env.OKX_SECRET_KEY ?? process.env.VITE_OKX_SECRET_KEY : void 0);
  const pass = import.meta.env.VITE_OKX_PASSPHRASE || (typeof process !== "undefined" ? process.env.OKX_PASSPHRASE ?? process.env.VITE_OKX_PASSPHRASE : void 0);
  if (typeof key === "string" && key.length > 0 && typeof secret === "string" && secret.length > 0 && typeof pass === "string" && pass.length > 0) {
    return { key, secret, pass };
  }
  return null;
}
function okxTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function hmacSha256Base642(secret, message) {
  const te = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, te.encode(message));
  const b = new Uint8Array(sig);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function okxSuccess(j) {
  return j.code === "0" || j.code === 0;
}
function okxUrlOnWire(requestPath) {
  return extFetchUrl(`https://web3.okx.com${requestPath.startsWith("/") ? requestPath : `/${requestPath}`}`);
}
async function okxSignedRequestOnce(method, pathWithQuery, bodyStr = "") {
  if (okxCircuitOpen()) return null;
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  if (isProdBuild()) {
    try {
      const r = await okxProxyFetch(method, path, bodyStr);
      const json = await r.json();
      return { ok: r.ok, status: r.status, json };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ETIMEDOUT|AbortError|network|fetch/i.test(msg)) okxTripCircuit();
      return null;
    }
  }
  const creds = okxCreds();
  if (!creds) return null;
  const ts = okxTimestamp();
  const pre = `${ts}${method}${path}${method === "POST" ? bodyStr : ""}`;
  const sign = await hmacSha256Base642(creds.secret, pre);
  const url = okxUrlOnWire(path);
  const timeoutMs = okxFetchTimeoutMs();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      signal: ac.signal,
      headers: {
        ...method === "POST" ? { "Content-Type": "application/json" } : {},
        "OK-ACCESS-KEY": creds.key,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": creds.pass
      },
      body: method === "POST" ? bodyStr : void 0
    });
    const json = await r.json();
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    const msg = e instanceof Error ? e.message : String(e);
    if (isAbort || /ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(msg)) okxTripCircuit();
    return null;
  } finally {
    clearTimeout(t);
  }
}
var lastOkx429LogAt = 0;
async function okxSignedRequest(method, pathWithQuery, bodyStr = "") {
  const maxAttempts = 1 + okxFetchExtraRetries();
  let last = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await okxSignedRequestOnce(method, pathWithQuery, bodyStr);
    if (!last) return null;
    if (last.status !== 429) return last;
    const backoffMs = 800 * (attempt + 1) * (attempt + 1);
    const now2 = Date.now();
    if (now2 - lastOkx429LogAt > 3e4) {
      lastOkx429LogAt = now2;
      console.warn("[OKX] 429 backoff", {
        attempt: attempt + 1,
        backoffMs,
        path: pathWithQuery.split("?")[0]
      });
    }
    if (attempt >= 1) return last;
    await sleep(backoffMs);
  }
  return last;
}
async function okxSignedGet(pathWithQuery) {
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const res = await okxSignedRequest("GET", path);
  if (!res) return null;
  if (res.ok && okxSuccess(res.json)) return res.json;
  if (import.meta.env.DEV) {
    console.warn("[OKX] GET", path.split("?")[0], res.status, res.json?.code, res.json?.msg);
  }
  return null;
}
function parseChangePct(s) {
  if (s == null || s === "") return null;
  const n2 = parseFloat(String(s).trim());
  return Number.isFinite(n2) ? n2 : null;
}
var OKX_PRICE_INFO_TTL_MS = (() => {
  const raw = typeof process !== "undefined" ? process.env.OKX_PRICE_INFO_CACHE_MS : void 0;
  const n2 = raw != null && raw !== "" ? Number.parseInt(String(raw), 10) : Number.NaN;
  return Number.isFinite(n2) && n2 >= 5e3 && n2 <= 6e5 ? n2 : 6e4;
})();
var priceInfoCache = /* @__PURE__ */ new Map();
function priceInfoCacheKey(coinType) {
  return normalizeCoinTypeForMatch(coinType);
}
async function postPriceInfoChunk(bodyStr) {
  const extra = okxFetchExtraRetries();
  const maxAttempt = 1 + extra;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempt; attempt++) {
    const res = await okxSignedRequest("POST", PRICE_INFO_PATH, bodyStr);
    if (res && res.ok && okxSuccess(res.json) && Array.isArray(res.json.data)) {
      if (import.meta.env.DEV && attempt > 0) {
        console.log("[OKX] price-info retry success", { attempt: attempt + 1 });
      }
      return res.json;
    }
    lastErr = res ? `HTTP ${res.status} code=${res.json?.code}` : "no response";
    if (okxCircuitOpen()) break;
    if (attempt < maxAttempt - 1) {
      await sleep(DEFAULT_RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  if (import.meta.env.DEV) {
    console.warn("[OKX] price-info chunk failed after retries", { lastErr, attempts: maxAttempt });
  }
  return null;
}
async function okxPriceInfoByCoinType(coinTypes) {
  const out = /* @__PURE__ */ new Map();
  if (!isOkxDexConfigured() || coinTypes.length === 0) return out;
  const unique = [...new Set(coinTypes.map((c) => c.trim()).filter(Boolean))];
  const now2 = Date.now();
  const needFetch = [];
  for (const ct of unique) {
    const hit = priceInfoCache.get(priceInfoCacheKey(ct));
    if (hit && hit.expiresAt > now2) {
      out.set(ct, hit.info);
      continue;
    }
    needFetch.push(ct);
  }
  if (needFetch.length === 0) return out;
  const bodyTemplate = needFetch.map((tokenContractAddress) => ({
    chainIndex: CHAIN_SUI,
    tokenContractAddress
  }));
  for (let i = 0; i < bodyTemplate.length; i += BATCH) {
    const chunk = bodyTemplate.slice(i, i + BATCH);
    const bodyStr = JSON.stringify(chunk);
    const j = await postPriceInfoChunk(bodyStr);
    if (j == null) continue;
    const normToCt = /* @__PURE__ */ new Map();
    for (const b of chunk) {
      const norm2 = normalizeCoinTypeForMatch(b.tokenContractAddress);
      normToCt.set(norm2, b.tokenContractAddress);
      const pkg = norm2.split("::")[0];
      if (pkg && !normToCt.has(pkg)) normToCt.set(pkg, b.tokenContractAddress);
    }
    if (import.meta.env.DEV) {
      console.debug("[OKX price-info] raw response:", JSON.stringify(j.data));
    }
    for (const row of j.data) {
      const p = parseFloat(String(row?.price ?? ""));
      if (!Number.isFinite(p) || p <= 0) continue;
      const raw = String(row.tokenContractAddress ?? "");
      const normRaw = normalizeCoinTypeForMatch(raw);
      const pkgRaw = normRaw.split("::")[0] ?? normRaw;
      const ct = normToCt.get(normRaw) ?? normToCt.get(pkgRaw);
      if (!ct) {
        if (import.meta.env.DEV) {
          console.warn("[OKX price-info] unmatched tokenContractAddress:", raw);
        }
        continue;
      }
      const change5m = parseChangePct(row.priceChange5M);
      const change1h = parseChangePct(row.priceChange1H);
      const change24h = parseChangePct(row.priceChange24H);
      if (import.meta.env.DEV) {
        console.debug(
          `[OKX price-info] ${ct.split("::")[2] ?? ct} \u2192 $${p} 5m=${change5m} 1h=${change1h} 24h=${change24h}`
        );
      }
      out.set(ct, { price: p, change5m, change1h, change24h });
      priceInfoCache.set(priceInfoCacheKey(ct), {
        info: { price: p, change5m, change1h, change24h },
        expiresAt: now2 + OKX_PRICE_INFO_TTL_MS
      });
    }
  }
  for (const ct of unique) {
    if (out.has(ct)) continue;
    const hit = priceInfoCache.get(priceInfoCacheKey(ct));
    if (hit) out.set(ct, hit.info);
  }
  return out;
}
function isOkxDexConfigured() {
  return isProdBuild() || okxCreds() != null;
}
function isOkxCircuitOpen() {
  return okxCircuitOpen();
}

// src/services/spotPrice/currentSpotCache.ts
var MEM_TTL_MS = 5 * 60 * 1e3;
var PERSIST_TTL_MS = 2 * 60 * 60 * 1e3;
var LS_KEY = "sui_lp_current_spot_v4";
var MAX_PERSIST_KEYS = 450;
var mem = /* @__PURE__ */ new Map();
var nowFn = () => Date.now();
function now() {
  return nowFn();
}
function readPersisted() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY) ?? localStorage.getItem("sui_lp_current_spot_v3");
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}
function writePersisted(coinType, e) {
  if (typeof window === "undefined") return;
  try {
    const o = { ...readPersisted() };
    o[coinType] = {
      price: e.price,
      change24h: e.change24h,
      change5m: e.change5m ?? null,
      change1h: e.change1h ?? null,
      source: e.source,
      observedAt: e.observedAt,
      lastReadAt: e.lastReadAt,
      cachedAt: e.observedAt
    };
    const keys = Object.keys(o);
    if (keys.length > MAX_PERSIST_KEYS) {
      keys.map((k) => ({ k, t: o[k]?.observedAt ?? o[k]?.cachedAt ?? 0 })).sort((a, b) => a.t - b.t).slice(0, keys.length - MAX_PERSIST_KEYS).forEach(({ k }) => {
        delete o[k];
      });
    }
    localStorage.setItem(LS_KEY, JSON.stringify(o));
  } catch {
  }
}
function getFromPersisted(coinType) {
  const o = readPersisted();
  const e = o[coinType];
  if (!e || !Number.isFinite(e.price) || e.price <= 0) return null;
  const observedAt = e.observedAt ?? e.cachedAt ?? 0;
  if (now() - observedAt > PERSIST_TTL_MS) return null;
  return {
    observedAt,
    lastReadAt: e.lastReadAt ?? observedAt,
    cachedAt: observedAt,
    price: e.price,
    change24h: e.change24h,
    change5m: e.change5m ?? null,
    change1h: e.change1h ?? null,
    source: e.source
  };
}
function getFreshMemSpot(coinType) {
  const e0 = mem.get(coinType);
  if (!e0) return null;
  if (now() - e0.observedAt <= MEM_TTL_MS) return e0;
  return null;
}
function getCurrentSpot(coinType) {
  const e0 = mem.get(coinType);
  if (e0) {
    if (now() - e0.observedAt <= MEM_TTL_MS) {
      e0.lastReadAt = now();
      return e0;
    }
    mem.delete(coinType);
  }
  const e1 = getFromPersisted(coinType);
  if (e1) {
    e1.lastReadAt = now();
    mem.set(coinType, e1);
    return e1;
  }
  return null;
}
function setCurrentSpot(coinType, data) {
  const observedAt = data.observedAt ?? now();
  const e = {
    price: data.price,
    change24h: data.change24h,
    change5m: data.change5m ?? null,
    change1h: data.change1h ?? null,
    source: data.source,
    observedAt,
    lastReadAt: now(),
    cachedAt: observedAt
  };
  mem.set(coinType, e);
  writePersisted(coinType, e);
}
function seedFromCache(coinTypes) {
  const hits = /* @__PURE__ */ new Map();
  const missing = [];
  for (const c of coinTypes) {
    const e = getCurrentSpot(c);
    if (e) hits.set(c, e);
    else missing.push(c);
  }
  return { hits, missing: [...new Set(missing)] };
}
function isCompleteSpotEntry(e) {
  if (e.source === "okx" || e.source === "dexscreener") {
    return e.change5m != null && e.change1h != null;
  }
  return true;
}
function seedForNetworkRefetch(coinTypes) {
  const freshHits = /* @__PURE__ */ new Map();
  const need = [];
  for (const c of coinTypes) {
    const e = getFreshMemSpot(c);
    if (e && isCompleteSpotEntry(e)) freshHits.set(c, e);
    else need.push(c);
  }
  return { freshHits, needNetwork: [...new Set(need)] };
}

// src/utils/concurrency.ts
async function mapPool(items, limit, fn) {
  if (items.length === 0) return [];
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const j = i++;
      if (j >= items.length) return;
      out[j] = await fn(items[j], j);
    }
  }
  const n2 = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: n2 }, () => worker()));
  return out;
}

// src/services/spotPrice/resolveSpots.ts
function syncSpotCacheFromOut(out) {
  for (const [ct, row] of out) {
    if (row.price == null) continue;
    setCurrentSpot(ct, {
      price: row.price,
      change24h: row.change24h,
      change5m: row.change5m ?? null,
      change1h: row.change1h ?? null,
      source: row.priceSource
    });
  }
}
var STABLE_SYMBOLS = /^(USDC|USDT|DAI|BUSD|FDUSD|USDZ|PYUSD|TUSD|FRAX|USDD)$/;
var DEXSCREENER_CONCURRENCY = 6;
function isStableSymbol(symbol) {
  return STABLE_SYMBOLS.test(symbol.toUpperCase());
}
function okxChange24h(change24h, symbol) {
  if (change24h === 0 && !isStableSymbol(symbol)) return null;
  return change24h;
}
async function resolveSpots(coinTypes, symbolByType, opts) {
  const out = /* @__PURE__ */ new Map();
  const { freshHits } = opts?.forceRefresh ? { freshHits: /* @__PURE__ */ new Map() } : seedForNetworkRefetch(coinTypes);
  for (const [ct, h] of freshHits) {
    const change24h = h.source === "okx" ? okxChange24h(h.change24h, symbolByType(ct)) : h.change24h;
    out.set(ct, {
      price: h.price,
      change24h,
      change5m: h.change5m ?? null,
      change1h: h.change1h ?? null,
      priceSource: h.source
    });
  }
  if (isOkxDexConfigured() && coinTypes.length > 0) {
    try {
      const okx = await okxPriceInfoByCoinType(coinTypes);
      for (const [ct, v] of okx) {
        if (!Number.isFinite(v.price) || v.price <= 0) continue;
        const change24h = okxChange24h(v.change24h, symbolByType(ct));
        const row = {
          price: v.price,
          change24h,
          change5m: v.change5m,
          change1h: v.change1h,
          priceSource: "okx"
        };
        out.set(ct, row);
        setCurrentSpot(ct, {
          price: v.price,
          change24h,
          change5m: v.change5m,
          change1h: v.change1h,
          source: "okx"
        });
      }
    } catch {
    }
  }
  let work = coinTypes.filter((ct) => out.get(ct)?.price == null);
  if (work.length) {
    await applyCoingeckoSpotOverlay(out, work, symbolByType);
    work = coinTypes.filter((ct) => out.get(ct)?.price == null);
  }
  if (work.length === 0) {
    await fill24hGaps(out, symbolByType);
    await applyCoingeckoSpotOverlay(out, coinTypes, symbolByType);
    syncSpotCacheFromOut(out);
    return out;
  }
  if (work.length) {
    const parts = await mapPool(work, DEXSCREENER_CONCURRENCY, dexScreenerPrice);
    work.forEach((c, j) => {
      const d = parts[j];
      if (d?.price) {
        const row = { price: d.price, change24h: d.change24h, priceSource: "dexscreener" };
        out.set(c, row);
        setCurrentSpot(c, { price: row.price, change24h: row.change24h, source: "dexscreener" });
      }
    });
  }
  let still = work.filter((c) => !out.get(c)?.price);
  if (still.length) {
    const af = await fetchAftermathBatch(still);
    for (const c of still) {
      const a = af[c];
      if (a?.price) {
        const row = { price: a.price, change24h: a.change24h, priceSource: "aftermath" };
        out.set(c, row);
        setCurrentSpot(c, { price: row.price, change24h: row.change24h, source: "aftermath" });
      }
    }
  }
  still = work.filter((c) => !out.get(c)?.price);
  if (still.length) {
    const gBatch = await geckoTokenPricesBatch(still);
    for (const c of still) {
      const p = gBatch[c];
      if (p != null) {
        out.set(c, { price: p, change24h: null, priceSource: "geckoterminal" });
        setCurrentSpot(c, { price: p, change24h: null, source: "geckoterminal" });
      }
    }
  }
  still = work.filter((c) => !out.get(c)?.price);
  if (still.length) {
    const pbatch = 8;
    for (let i = 0; i < still.length; i += pbatch) {
      const chunk = still.slice(i, i + pbatch);
      const results = await Promise.all(chunk.map((c) => dexpPaprikaPrice(c, symbolByType(c))));
      chunk.forEach((c, j) => {
        const p = results[j];
        if (p?.price) {
          out.set(c, { price: p.price, change24h: p.change24h, priceSource: "dexpaprika" });
          setCurrentSpot(c, { price: p.price, change24h: p.change24h, source: "dexpaprika" });
        } else {
          out.set(c, { price: null, change24h: null, priceSource: "unavailable" });
        }
      });
    }
  }
  await fill24hGaps(out, symbolByType);
  await applyCoingeckoSpotOverlay(out, coinTypes, symbolByType);
  syncSpotCacheFromOut(out);
  return out;
}
async function applyCoingeckoSpotOverlay(out, coinTypes, symbolByType) {
  const idByCt = /* @__PURE__ */ new Map();
  for (const ct of coinTypes) {
    const id = coingeckoIdForSymbol(symbolByType(ct));
    if (id) idByCt.set(ct, id);
  }
  if (idByCt.size === 0) return;
  const ids = [.../* @__PURE__ */ new Set([...idByCt.values()])];
  const cg = await coingeckoSimpleBatch(ids);
  for (const [ct, id] of idByCt) {
    const src = out.get(ct)?.priceSource;
    if (src === "okx") continue;
    const row = cg[id];
    if (!row || typeof row.usd !== "number" || !Number.isFinite(row.usd) || row.usd <= 0) {
      continue;
    }
    const cgChange = row.usd_24h_change != null && Number.isFinite(row.usd_24h_change) ? row.usd_24h_change : null;
    const existing = out.get(ct);
    if (!existing?.price) {
      out.set(ct, { price: row.usd, change24h: cgChange, priceSource: "coingecko" });
      setCurrentSpot(ct, { price: row.usd, change24h: cgChange, source: "coingecko" });
    } else {
      if (existing.change24h == null && cgChange != null) {
        out.set(ct, { ...existing, change24h: cgChange });
        setCurrentSpot(ct, { price: existing.price, change24h: cgChange, source: existing.priceSource });
      }
    }
  }
}
function coinTypesNeeding24h(out) {
  return [...out.entries()].filter(([, r]) => needs24h(r)).map(([ct]) => ct);
}
async function fill24hGaps(out, symbolByType) {
  if (coinTypesNeeding24h(out).length === 0) return;
  const needH24a = coinTypesNeeding24h(out);
  if (needH24a.length) {
    const parts = await mapPool(needH24a, DEXSCREENER_CONCURRENCY, dexScreenerPrice);
    needH24a.forEach((ct, j) => {
      const d = parts[j];
      const cur = out.get(ct);
      if (!cur?.price) return;
      if (d?.change24h != null && Number.isFinite(d.change24h)) {
        out.set(ct, { ...cur, change24h: d.change24h });
      }
    });
  }
  const needCg = coinTypesNeeding24h(out);
  if (needCg.length === 0) return;
  const idSet = /* @__PURE__ */ new Set();
  for (const ct of needCg) {
    const id = coingeckoIdForSymbol(symbolByType(ct));
    if (id) idSet.add(id);
  }
  if (idSet.size) {
    const cg = await coingeckoSimpleBatch([...idSet]);
    for (const ct of needCg) {
      const id = coingeckoIdForSymbol(symbolByType(ct));
      if (!id) continue;
      const cur = out.get(ct);
      if (!cur) continue;
      if (!needs24h(cur)) continue;
      const row = cg[id];
      if (row && typeof row.usd_24h_change === "number" && Number.isFinite(row.usd_24h_change)) {
        out.set(ct, { ...cur, change24h: row.usd_24h_change });
      }
    }
  }
  const still = coinTypesNeeding24h(out);
  const B = 6;
  for (let i = 0; i < still.length; i += B) {
    const chunk = still.slice(i, i + B);
    const parts = await Promise.all(chunk.map((ct) => geckoTokenDetail(ct)));
    chunk.forEach((ct, j) => {
      const p = parts[j];
      const cur = out.get(ct);
      if (!cur?.price) return;
      if (!needs24h(cur)) return;
      if (p.change24h != null && Number.isFinite(p.change24h)) {
        out.set(ct, { ...cur, change24h: p.change24h });
      }
    });
  }
}

// src/services/balanceService.ts
import Decimal2 from "decimal.js";
async function loadBalancesWithMetadata(walletAddress, client) {
  const balances = await client.getAllBalances({ owner: walletAddress });
  return mapPool(balances, RPC_CONCURRENCY, async (b) => {
    const meta = await client.getCoinMetadata({ coinType: b.coinType });
    return { b, meta };
  });
}
function emptyRow() {
  return { price: null, change24h: null, priceSource: "unavailable" };
}
function spotsMapFromCacheHits(coinTypes) {
  const { hits } = seedFromCache(coinTypes);
  const m = /* @__PURE__ */ new Map();
  for (const ct of coinTypes) {
    const h = hits.get(ct);
    if (h) {
      m.set(ct, {
        price: h.price,
        change24h: h.change24h,
        change5m: h.change5m ?? null,
        change1h: h.change1h ?? null,
        priceSource: h.source
      });
    } else {
      m.set(ct, emptyRow());
    }
  }
  return m;
}
function usdPerOneUsdc(spots, withMeta) {
  for (const { b, meta } of withMeta) {
    if ((meta?.symbol ?? "").toUpperCase() !== "USDC") continue;
    const p = spots.get(b.coinType)?.price;
    if (p != null && Number.isFinite(p) && p > 0) return p;
  }
  return 1;
}
function buildTokenRows(withMeta, spots) {
  const usdPerUsdc = usdPerOneUsdc(spots, withMeta);
  const out = withMeta.map(({ b, meta }) => {
    const decimals = meta?.decimals ?? 0;
    const raw = BigInt(b.totalBalance);
    const human = new Decimal2(b.totalBalance).div(new Decimal2(10).pow(decimals)).toNumber();
    const sp = spots.get(b.coinType) ?? emptyRow();
    const price = sp.price;
    const priceUSDC = price != null && Number.isFinite(price) && usdPerUsdc > 0 ? price / usdPerUsdc : null;
    const valueUSD = price != null && Number.isFinite(price) ? human * price : null;
    const symbol = meta?.symbol ?? symbolFromType(b.coinType);
    const scallop = symbol.toLowerCase().startsWith("s") && coinTypeScallopLike(b.coinType) || void 0;
    const mom = MOMENTUM_LST_TYPES.includes(b.coinType) || b.coinType.includes("::x_sui::X_SUI");
    return {
      coinType: b.coinType,
      symbol,
      name: meta?.name ?? symbol,
      decimals,
      description: meta?.description ?? void 0,
      iconUrl: meta?.iconUrl ?? null,
      rawBalance: raw,
      humanBalance: human,
      priceUSD: price,
      priceUSDC,
      valueUSD,
      change24h: sp.change24h,
      change5m: sp.change5m ?? null,
      change1h: sp.change1h ?? null,
      coinObjectCount: b.coinObjectCount,
      scallopDeposit: scallop,
      momentumLST: mom,
      priceSource: sp.priceSource
    };
  });
  out.sort(
    (a, b) => (b.valueUSD ?? 0) - (a.valueUSD ?? 0) || b.humanBalance - a.humanBalance
  );
  return out;
}
async function getWalletBalance(walletAddress, client = suiClient, onPartial, options) {
  let withMeta;
  try {
    withMeta = await loadBalancesWithMetadata(walletAddress, client);
  } catch {
    await new Promise((r) => setTimeout(r, 1e3));
    withMeta = await loadBalancesWithMetadata(walletAddress, client);
  }
  const types = withMeta.map(({ b }) => b.coinType);
  const symbolByType = (ct) => {
    const row = withMeta.find((x) => x.b.coinType === ct);
    return row?.meta?.symbol ?? symbolFromType(ct);
  };
  if (onPartial) {
    onPartial(buildTokenRows(withMeta, spotsMapFromCacheHits(types)));
  }
  let spots;
  try {
    const rs = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
    spots = await resolveSpots(types, symbolByType, rs);
  } catch {
    spots = spotsMapFromCacheHits(types);
  }
  return buildTokenRows(withMeta, spots);
}
function symbolFromType(coinType) {
  const parts = coinType.split("::");
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : "UNKNOWN";
}
function coinTypeScallopLike(coinType) {
  return coinType.includes("scallop") || coinType.toLowerCase().includes("ssui");
}

// src/utils/supplyLiquidationPrice.ts
function normalizeLiquidationThresholdFactor(raw) {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 1 ? raw / 100 : raw;
}
function liqFactor(s) {
  return normalizeLiquidationThresholdFactor(s.liquidationThresholdFactor);
}
function computeSupplyLiquidationPriceUSD(supplies, index, totalBorrowedUSD) {
  if (totalBorrowedUSD <= 0) return null;
  const target = supplies[index];
  if (!target || target.currentAmount <= 0 || liqFactor(target) <= 0) {
    return null;
  }
  let otherLiqValue = 0;
  for (let i = 0; i < supplies.length; i++) {
    if (i === index) continue;
    const s = supplies[i];
    const lt2 = liqFactor(s);
    if (s.currentAmount <= 0 || lt2 <= 0) continue;
    const price = s.currentValueUSD / s.currentAmount;
    if (!Number.isFinite(price) || price <= 0) continue;
    otherLiqValue += s.currentAmount * price * lt2;
  }
  const debtFromThis = totalBorrowedUSD - otherLiqValue;
  if (debtFromThis <= 0) return null;
  const lt = liqFactor(target);
  const liqPrice = debtFromThis / (target.currentAmount * lt);
  if (!Number.isFinite(liqPrice) || liqPrice <= 0) return null;
  return liqPrice;
}
function enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD) {
  return supplies.map((s, i) => ({
    ...s,
    liquidationPriceUSD: computeSupplyLiquidationPriceUSD(supplies, i, totalBorrowedUSD)
  }));
}

// src/services/lendingService.ts
var _client = null;
async function getClient() {
  if (_client) return _client;
  const { AlphalendClient } = await import("@alphafi/alphalend-sdk");
  _client = new AlphalendClient("mainnet");
  return _client;
}
function rewardSymbol(r) {
  if (r.symbol) return r.symbol;
  if (r.coinType) return r.coinType.split("::").pop() ?? r.coinType;
  return "?";
}
function extractAprParts(apr) {
  if (!apr) return { total: 0, baseAPR: 0, stakingAPR: 0, rewardAPR: 0, rewardTokens: [] };
  const baseAPR = safeNum(apr.interestApr) / 100;
  const stakingAPR = safeNum(apr.stakingApr) / 100;
  const rewardTokens = (apr.rewards ?? []).map((r) => ({ symbol: rewardSymbol(r), coinType: r.coinType, apr: safeNum(r.rewardApr) / 100 })).filter((r) => r.apr > 0);
  const rewardAPR = rewardTokens.reduce((s, r) => s + r.apr, 0);
  return { total: baseAPR + stakingAPR + rewardAPR, baseAPR, stakingAPR, rewardAPR, rewardTokens };
}
async function getLendingPositions(walletAddress) {
  const client = await getClient();
  const [marketsRaw, portfolios] = await Promise.all([
    client.getAllMarkets(),
    client.getUserPortfolio(walletAddress)
  ]);
  if (!portfolios || portfolios.length === 0) return EMPTY_SNAP;
  const marketByIdRaw = /* @__PURE__ */ new Map();
  if (marketsRaw) {
    for (const m of marketsRaw) {
      const data = await m.getMarketData?.() ?? m;
      const id = Number(data.marketId);
      if (!Number.isNaN(id)) marketByIdRaw.set(id, data);
    }
  }
  const p = portfolios[0];
  const totalSuppliedUSD = safeNum(p.totalSuppliedUsd);
  const totalBorrowedUSD = safeNum(p.totalBorrowedUsd);
  const liquidationUSD = safeNum(p.liquidationThreshold);
  const safeBorrowLimitUSD = safeNum(p.safeBorrowLimit);
  const healthFactor = totalBorrowedUSD > 0 ? liquidationUSD / totalBorrowedUSD : null;
  const supplies = [];
  for (const [marketIdNum, amtDecimal] of p.suppliedAmounts.entries()) {
    const mkt = marketByIdRaw.get(marketIdNum);
    if (!mkt) continue;
    const amount = safeNum(amtDecimal);
    if (amount === 0) continue;
    const priceUsd = mkt.price != null ? parseFloat(String(mkt.price)) : 0;
    const ltFactor = normalizeLiquidationThresholdFactor(safeNum(mkt.liquidationThreshold));
    const supplyParts = extractAprParts(mkt.supplyApr);
    supplies.push({
      id: `alphalend-supply-${marketIdNum}`,
      asset: mkt.symbol ?? mkt.coinType.split("::").pop() ?? `Mkt${marketIdNum}`,
      coinType: mkt.coinType,
      sCoinType: "",
      suppliedAmount: amount,
      currentAmount: amount,
      earnedInterest: 0,
      earnedInterestUSD: 0,
      supplyAPR: supplyParts.total,
      supplyRewardAPR: supplyParts.rewardAPR,
      aprBreakdown: {
        baseAPR: supplyParts.baseAPR,
        ...supplyParts.stakingAPR > 0 ? { stakingAPR: supplyParts.stakingAPR } : {},
        rewardAPR: supplyParts.rewardAPR,
        rewards: supplyParts.rewardTokens
      },
      currentValueUSD: amount * priceUsd,
      liquidationThresholdFactor: ltFactor > 0 ? ltFactor : void 0,
      startedAt: 0,
      daysActive: 0,
      events: [],
      protocol: "AlphaLend",
      iconUrl: null
    });
  }
  const suppliesWithLiq = enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD);
  const collateral = suppliesWithLiq.map((s) => ({
    asset: s.asset,
    amount: s.currentAmount,
    valueUSD: s.currentValueUSD,
    collateralWeight: 0,
    effectiveValueUSD: s.currentValueUSD
  }));
  const borrows = [];
  for (const [marketIdNum, amtDecimal] of p.borrowedAmounts.entries()) {
    const mkt = marketByIdRaw.get(marketIdNum);
    if (!mkt) continue;
    const amount = safeNum(amtDecimal);
    if (amount === 0) continue;
    const priceUsd = mkt.price != null ? parseFloat(String(mkt.price)) : 0;
    const borrowParts = extractAprParts(mkt.borrowApr);
    const rewardAPR = borrowParts.rewardAPR;
    const borrowAPR = borrowParts.baseAPR - rewardAPR;
    borrows.push({
      id: `alphalend-borrow-${marketIdNum}`,
      obligationId: p.positionId ?? "",
      asset: mkt.symbol ?? mkt.coinType.split("::").pop() ?? `Mkt${marketIdNum}`,
      coinType: mkt.coinType,
      borrowedAmount: amount,
      currentDebt: amount,
      accruedInterest: 0,
      accruedInterestUSD: 0,
      borrowAPR,
      borrowRewardAPR: rewardAPR,
      netBorrowCost: borrowAPR,
      // already net
      aprBreakdown: {
        baseAPR: borrowParts.baseAPR,
        rewardAPR: borrowParts.rewardAPR,
        rewards: borrowParts.rewardTokens
      },
      currentDebtUSD: amount * priceUsd,
      collateral,
      healthFactor: healthFactor ?? 0,
      liquidationThreshold: liquidationUSD,
      ...safeBorrowLimitUSD > 0 ? { safeBorrowLimit: safeBorrowLimitUSD } : {},
      startedAt: 0,
      daysActive: 0,
      events: [],
      protocol: "AlphaLend",
      iconUrl: null
    });
  }
  const rewardsToClaim = (p.rewardsToClaim ?? []).filter((r) => safeNum(r.rewardAmount) > 0).map((r) => {
    const mkt = [...marketByIdRaw.values()].find((m) => m.coinType === r.coinType);
    const priceUsd = mkt?.price != null ? parseFloat(String(mkt.price)) : 0;
    const amount = safeNum(r.rewardAmount);
    return {
      coinType: r.coinType,
      symbol: mkt?.symbol ?? r.coinType.split("::").pop() ?? r.coinType,
      amount,
      valueUSD: amount * priceUsd
    };
  });
  const netAPR = safeNum(p.netApr) / 100 || null;
  const dailyEarningsUSD = safeNum(p.dailyEarnings) || null;
  return {
    supplies: suppliesWithLiq,
    borrows,
    totalSuppliedUSD,
    totalBorrowedUSD,
    netValueUSD: totalSuppliedUSD - totalBorrowedUSD,
    healthFactor,
    netAPR,
    dailyEarningsUSD,
    rewardsToClaim,
    protocol: "AlphaLend"
  };
}
var EMPTY_SNAP = {
  supplies: [],
  borrows: [],
  totalSuppliedUSD: 0,
  totalBorrowedUSD: 0,
  netValueUSD: 0,
  healthFactor: null,
  rewardsToClaim: [],
  protocol: "AlphaLend"
};
function safeNum(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  if (typeof v === "object" && "toNumber" in v) {
    return v.toNumber();
  }
  if (typeof v === "object" && "toString" in v) {
    return parseFloat(v.toString()) || 0;
  }
  return 0;
}

// src/services/naviService.ts
var NAVI_ORIGIN = "https://open-api.naviprotocol.io";
var SDK_VER = "1.4.3";
function naviUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return extFetchUrl(`${NAVI_ORIGIN}${p}`);
}
function naviLog(...args) {
  if (import.meta.env.DEV) {
    console.log("[Navi]", ...args);
  }
}
function n(v) {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const x = parseFloat(v);
    return isFinite(x) ? x : 0;
  }
  return 0;
}
function pct(v) {
  return n(v) / 100;
}
function coinSymbol(coinType) {
  return coinType.split("::").pop() ?? "?";
}
function normalizeType(ct) {
  const parts = ct.trim().split("::");
  if (parts.length !== 3) return ct.trim();
  const pkg = parts[0];
  if (pkg.startsWith("0x") || pkg.startsWith("0X")) {
    const hex = pkg.slice(2).padStart(64, "0");
    return `0x${hex}::${parts[1]}::${parts[2]}`;
  }
  return ct.trim();
}
var _poolCache = null;
async function fetchPools() {
  const now2 = Date.now();
  if (_poolCache && now2 - _poolCache.ts < 5 * 6e4) return _poolCache.data;
  const url = naviUrl(`/api/navi/pools?env=prod&sdk=${SDK_VER}&market=main`);
  naviLog("fetching pools:", url);
  const res = await fetch(url, { signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw new Error(`Navi pools API ${res.status}`);
  const json = await res.json();
  const data = json.data ?? [];
  naviLog(`pools loaded: ${data.length}`);
  _poolCache = { ts: now2, data };
  return data;
}
var _cfgCache = null;
async function fetchConfig() {
  const now2 = Date.now();
  if (_cfgCache && now2 - _cfgCache.ts < 10 * 6e4) return _cfgCache.data;
  const url = naviUrl(`/api/navi/config?env=prod&sdk=${SDK_VER}&market=main`);
  naviLog("fetching config:", url);
  const res = await fetch(url, { signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw new Error(`Navi config API ${res.status}`);
  const json = await res.json();
  const data = json.data;
  naviLog("config uiGetter:", data?.uiGetter);
  _cfgCache = { ts: now2, data };
  return data;
}
async function fetchRewards(walletAddress, priceByType, symbolByType) {
  try {
    const { getUserAvailableLendingRewards } = await import("@naviprotocol/lending");
    const { SuiJsonRpcClient: SuiJsonRpcClient2 } = await import("@mysten/sui/jsonRpc");
    const client = new SuiJsonRpcClient2({ url: resolveBrowserRpcUrl(), network: "mainnet" });
    const rawRewards = await getUserAvailableLendingRewards(walletAddress, {
      client,
      env: "prod"
    });
    const agg = /* @__PURE__ */ new Map();
    for (const r of rawRewards) {
      const rawCt = r.rewardCoinType ?? "";
      if (!rawCt) continue;
      const ct = normalizeType(rawCt);
      const amt = typeof r.userClaimableReward === "number" ? r.userClaimableReward : Number(r.userClaimableReward);
      if (!isFinite(amt) || amt <= 0) continue;
      agg.set(ct, (agg.get(ct) ?? 0) + amt);
    }
    return [...agg.entries()].map(([coinType, amount]) => {
      const price = (priceByType.get(coinType) ?? 0) || (getCurrentSpot(coinType)?.price ?? 0);
      return {
        coinType,
        symbol: symbolByType.get(coinType) ?? coinSymbol(coinType),
        amount,
        valueUSD: price > 0 ? amount * price : 0
      };
    });
  } catch (e) {
    console.error("[Navi] fetchRewards error:", e);
    return [];
  }
}
function readU256LE(bytes, off) {
  let val = 0n;
  for (let i = 0; i < 32; i++) {
    val |= BigInt(bytes[off + i] ?? 0) << BigInt(i * 8);
  }
  return [val, off + 32];
}
function readULEB128(bytes, off) {
  let result = 0;
  let shift = 0;
  while (true) {
    const b = bytes[off++] ?? 0;
    result |= (b & 127) << shift;
    if ((b & 128) === 0) break;
    shift += 7;
  }
  return [result, off];
}
function parseUserState(raw) {
  let off = 0;
  const [len, newOff] = readULEB128(raw, off);
  off = newOff;
  naviLog(`BCS: parsing ${len} user state entries from ${raw.length} bytes`);
  const entries = [];
  for (let i = 0; i < len; i++) {
    const assetId = raw[off++] ?? 0;
    let bb, sb;
    [bb, off] = readU256LE(raw, off);
    [sb, off] = readU256LE(raw, off);
    entries.push({ assetId, supplyBalance: sb, borrowBalance: bb });
    naviLog(`BCS entry ${i}: assetId=${assetId}, borrowBalance=${bb}, supplyBalance=${sb}`);
  }
  return entries;
}
async function buildGetUserStateTxBytes(uiGetter, storageId, userAddress) {
  naviLog("building tx for devInspect", { uiGetter, storageId, userAddress });
  const { Transaction: Transaction5 } = await import("@mysten/sui/transactions");
  const { SuiJsonRpcClient: SuiJsonRpcClient2 } = await import("@mysten/sui/jsonRpc");
  const client = new SuiJsonRpcClient2({ url: resolveBrowserRpcUrl(), network: "mainnet" });
  const tx = new Transaction5();
  tx.moveCall({
    target: `${uiGetter}::getter_unchecked::get_user_state`,
    arguments: [tx.object(storageId), tx.pure.address(userAddress)]
  });
  const bytes = await tx.build({ client, onlyTransactionKind: true });
  naviLog("tx built, bytes length:", bytes.length);
  return btoa(String.fromCharCode(...bytes));
}
async function devInspect(txBase64, sender) {
  naviLog("calling sui_devInspectTransactionBlock");
  const rpcUrl = resolveBrowserRpcUrl();
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sui_devInspectTransactionBlock",
      params: [sender, txBase64, null, null]
    }),
    signal: AbortSignal.timeout(3e4)
  });
  if (!res.ok) throw new Error(`Sui RPC ${res.status}`);
  const data = await res.json();
  naviLog("devInspect response keys:", Object.keys(data));
  if (data.error) {
    console.error("[Navi] devInspect RPC error:", data.error);
  }
  if (data.result) {
    naviLog("devInspect results count:", data.result?.results?.length);
  }
  return data;
}
var INDEX_SCALE = 10n ** 27n;
function applyIndex(raw, index) {
  if (raw === 0n || index === 0n) return 0n;
  return (raw * index + INDEX_SCALE / 2n) / INDEX_SCALE;
}
function bignumToHuman(amount, decimals = 9) {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const frac = amount % scale;
  return Number(whole) + Number(frac) / Number(scale);
}
async function getNaviPositions(walletAddress) {
  naviLog("getNaviPositions called for:", walletAddress);
  const [pools, cfg] = await Promise.all([fetchPools(), fetchConfig()]);
  if (!pools || pools.length === 0) {
    console.warn("[Navi] no pools returned, returning empty");
    return EMPTY_NAVI_SNAP;
  }
  const poolById = /* @__PURE__ */ new Map();
  for (const p of pools) {
    if (typeof p.id === "number") poolById.set(p.id, p);
  }
  console.log("[Navi] poolById keys:", [...poolById.keys()]);
  const firstPool = pools[0];
  console.log("[Navi] pool index field check \u2014 currentSupplyIndex:", firstPool?.currentSupplyIndex, ", currentBorrowIndex:", firstPool?.currentBorrowIndex);
  const symbolCache = /* @__PURE__ */ new Map();
  for (const p of pools) {
    if (p.token?.coinType && p.token?.symbol) {
      symbolCache.set(p.token.coinType, p.token.symbol);
    }
  }
  const uiGetter = cfg?.uiGetter ?? "";
  const storageId = cfg?.storage ?? "";
  if (!uiGetter || !storageId) {
    console.error("[Navi] missing config \u2014 uiGetter:", uiGetter, "storage:", storageId);
    throw new Error("Navi config missing uiGetter/storage");
  }
  const txBase64 = await buildGetUserStateTxBytes(uiGetter, storageId, walletAddress);
  const rpcResult = await devInspect(txBase64, walletAddress);
  if (rpcResult.error) {
    throw new Error(`Navi devInspect error: ${JSON.stringify(rpcResult.error)}`);
  }
  const returnValues = rpcResult.result?.results?.[0]?.returnValues?.map(
    (rv) => rv[0]
  ) ?? [];
  console.log("[Navi] returnValues count:", returnValues.length);
  if (returnValues.length === 0) {
    console.warn("[Navi] no returnValues from devInspect \u2014 wallet has no Navi positions or RPC issue");
    return EMPTY_NAVI_SNAP;
  }
  const userStates = parseUserState(returnValues[0]);
  console.log("[Navi] parsed userStates count:", userStates.length);
  const activeStates = [];
  for (const state of userStates) {
    if (state.supplyBalance === 0n && state.borrowBalance === 0n) continue;
    const pool = poolById.get(state.assetId);
    if (!pool) {
      console.warn("[Navi] no pool found for assetId:", state.assetId);
      continue;
    }
    const supplyIndex = BigInt(pool.currentSupplyIndex ?? "0");
    const borrowIndex = BigInt(pool.currentBorrowIndex ?? "0");
    const decimals = pool.token?.decimals ?? 9;
    console.log(`[Navi] assetId=${state.assetId} pool=${pool.token?.symbol} supplyIndex=${supplyIndex} borrowIndex=${borrowIndex}`);
    const supplyAdj = applyIndex(state.supplyBalance, supplyIndex);
    const borrowAdj = applyIndex(state.borrowBalance, borrowIndex);
    const supplyHuman = bignumToHuman(supplyAdj, 9);
    const factor = 10 ** decimals;
    const supplyHumanTrunc = Math.trunc(supplyHuman * factor) / factor;
    const borrowHuman = bignumToHuman(borrowAdj, 9);
    const borrowHumanTrunc = Math.trunc(borrowHuman * factor) / factor;
    console.log(`[Navi] assetId=${state.assetId}: supplyHuman=${supplyHumanTrunc}, borrowHuman=${borrowHumanTrunc}`);
    if (supplyHumanTrunc === 0 && borrowHumanTrunc === 0) continue;
    activeStates.push({ pool, supplyHuman: supplyHumanTrunc, borrowHuman: borrowHumanTrunc });
  }
  console.log("[Navi] activeStates count:", activeStates.length);
  if (activeStates.length === 0) {
    console.warn("[Navi] no active positions after filtering");
    return EMPTY_NAVI_SNAP;
  }
  const supplies = [];
  for (const { pool, supplyHuman } of activeStates) {
    if (supplyHuman <= 0) continue;
    const aprInfo = pool.supplyIncentiveApyInfo ?? {};
    const baseAPR = pct(aprInfo.vaultApr);
    const rewardAPR = pct(aprInfo.boostedApr);
    const rewardCoins = aprInfo.rewardCoin ?? [];
    const perTokenAPR = rewardCoins.length > 0 ? rewardAPR / rewardCoins.length : 0;
    const rewards = rewardCoins.map((ct) => ({
      symbol: symbolCache.get(ct) ?? coinSymbol(ct),
      coinType: ct,
      apr: perTokenAPR
    }));
    const priceUSD = n(pool.oracle?.price);
    const ltFactor = normalizeLiquidationThresholdFactor(n(pool.liquidationFactor?.threshold));
    supplies.push({
      id: `navi-supply-${pool.id}`,
      asset: pool.token?.symbol ?? coinSymbol(pool.suiCoinType ?? ""),
      coinType: pool.suiCoinType ?? pool.coinType ?? "",
      sCoinType: "",
      suppliedAmount: supplyHuman,
      currentAmount: supplyHuman,
      earnedInterest: 0,
      earnedInterestUSD: 0,
      supplyAPR: baseAPR + rewardAPR,
      supplyRewardAPR: rewardAPR,
      aprBreakdown: { baseAPR, rewardAPR, rewards },
      currentValueUSD: supplyHuman * priceUSD,
      liquidationThresholdFactor: ltFactor > 0 ? ltFactor : void 0,
      startedAt: 0,
      daysActive: 0,
      events: [],
      protocol: "Navi",
      iconUrl: pool.token?.logoUri ?? null
    });
  }
  const collateral = supplies.map((s) => ({
    asset: s.asset,
    amount: s.currentAmount,
    valueUSD: s.currentValueUSD,
    collateralWeight: 0,
    effectiveValueUSD: s.currentValueUSD
  }));
  const borrows = [];
  for (const { pool, borrowHuman } of activeStates) {
    if (borrowHuman <= 0) continue;
    const aprInfo = pool.borrowIncentiveApyInfo ?? {};
    const baseAPR = pct(aprInfo.vaultApr);
    const rewardAPR = pct(aprInfo.boostedApr);
    const netBorrowCost = baseAPR - rewardAPR;
    const rewardCoins = aprInfo.rewardCoin ?? [];
    const perTokenAPR = rewardCoins.length > 0 ? rewardAPR / rewardCoins.length : 0;
    const rewards = rewardCoins.map((ct) => ({
      symbol: symbolCache.get(ct) ?? coinSymbol(ct),
      coinType: ct,
      apr: perTokenAPR
    }));
    const priceUSD = n(pool.oracle?.price);
    borrows.push({
      id: `navi-borrow-${pool.id}`,
      obligationId: "",
      asset: pool.token?.symbol ?? coinSymbol(pool.suiCoinType ?? ""),
      coinType: pool.suiCoinType ?? pool.coinType ?? "",
      borrowedAmount: borrowHuman,
      currentDebt: borrowHuman,
      accruedInterest: 0,
      accruedInterestUSD: 0,
      borrowAPR: netBorrowCost,
      borrowRewardAPR: rewardAPR,
      netBorrowCost,
      aprBreakdown: { baseAPR, rewardAPR, rewards },
      currentDebtUSD: borrowHuman * priceUSD,
      collateral,
      healthFactor: 0,
      liquidationThreshold: 0,
      startedAt: 0,
      daysActive: 0,
      events: [],
      protocol: "Navi",
      iconUrl: pool.token?.logoUri ?? null
    });
  }
  const totalSuppliedUSD = supplies.reduce((s, x) => s + x.currentValueUSD, 0);
  const totalBorrowedUSD = borrows.reduce((s, x) => s + x.currentDebtUSD, 0);
  const netValueUSD = totalSuppliedUSD - totalBorrowedUSD;
  let liquidationValue = 0;
  for (const { pool, supplyHuman } of activeStates) {
    const lt = normalizeLiquidationThresholdFactor(n(pool.liquidationFactor?.threshold));
    const priceUSD = n(pool.oracle?.price);
    liquidationValue += supplyHuman * priceUSD * lt;
  }
  const healthFactor = totalBorrowedUSD > 0 ? liquidationValue / totalBorrowedUSD : null;
  for (const b of borrows) {
    b.healthFactor = healthFactor ?? 0;
    b.liquidationThreshold = liquidationValue;
  }
  const suppliesWithLiq = enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD);
  let weightedSupply = 0;
  for (const s of suppliesWithLiq) weightedSupply += s.supplyAPR * s.currentValueUSD;
  let weightedBorrow = 0;
  for (const b of borrows) weightedBorrow += b.netBorrowCost * b.currentDebtUSD;
  const netAPR = netValueUSD > 0 ? (weightedSupply - weightedBorrow) / netValueUSD : null;
  const dailyEarningsUSD = netValueUSD && netAPR != null && isFinite(netAPR) ? netValueUSD * netAPR / 365 : null;
  const priceByType = /* @__PURE__ */ new Map();
  const symbolByType = /* @__PURE__ */ new Map();
  for (const pool of pools) {
    const candidates = [
      pool.suiCoinType,
      pool.coinType,
      pool.token?.coinType
    ].filter(Boolean);
    for (const raw of candidates) {
      const ct = normalizeType(raw);
      const price = n(pool.oracle?.price);
      if (price > 0) priceByType.set(ct, price);
      const sym = pool.token?.symbol ?? "";
      if (sym) symbolByType.set(ct, sym);
    }
  }
  const rewardsToClaim = await fetchRewards(walletAddress, priceByType, symbolByType).catch(() => []);
  console.log(
    "[Navi] final snapshot: supplies=%d borrows=%d netValueUSD=%s",
    suppliesWithLiq.length,
    borrows.length,
    netValueUSD.toFixed(2)
  );
  return {
    supplies: suppliesWithLiq,
    borrows,
    totalSuppliedUSD,
    totalBorrowedUSD,
    netValueUSD,
    healthFactor,
    netAPR,
    dailyEarningsUSD,
    rewardsToClaim,
    protocol: "Navi"
  };
}
var EMPTY_NAVI_SNAP = {
  supplies: [],
  borrows: [],
  totalSuppliedUSD: 0,
  totalBorrowedUSD: 0,
  netValueUSD: 0,
  healthFactor: null,
  rewardsToClaim: [],
  protocol: "Navi"
};

// src/utils/rateLimiter.ts
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
function createRateLimiter(minIntervalMs) {
  let lastCallAt = 0;
  return async function(fn) {
    const now2 = Date.now();
    const wait = Math.max(0, minIntervalMs - (now2 - lastCallAt));
    if (wait > 0) await sleep2(wait);
    try {
      return await fn();
    } finally {
      lastCallAt = Date.now();
    }
  };
}
var _legacyLimiter = createRateLimiter(0);

// src/services/okxHistoricalUsd.ts
var CHAIN_SUI2 = "784";
var NATIVE_SUI_NORM = normalizeCoinTypeForMatch("0x2::sui::SUI");
function isNativeSuiCoinType(coinType) {
  return normalizeCoinTypeForMatch(coinType) === NATIVE_SUI_NORM;
}
function okxWalletTokenAddressParam(coinType) {
  return isNativeSuiCoinType(coinType) ? "" : coinType;
}
function parseWalletHistoricalData(data) {
  if (!Array.isArray(data)) return [];
  const rows = [];
  for (const block of data) {
    if (!block || typeof block !== "object") continue;
    const prices = block.prices;
    if (!Array.isArray(prices)) continue;
    for (const p of prices) {
      if (!p || typeof p !== "object") continue;
      const time = String(p.time ?? "");
      const price = String(p.price ?? "");
      if (time && price) rows.push({ time, price });
    }
  }
  return rows;
}
function parseOkxHistoricalCandlesData(data) {
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const row of data) {
    if (Array.isArray(row) && row.length >= 5) {
      const tsRaw = Number(row[0]);
      const closeRaw = typeof row[4] === "string" ? parseFloat(row[4]) : typeof row[4] === "number" ? row[4] : NaN;
      const confirm = row.length >= 8 ? String(row[7]).trim() : "1";
      if (!Number.isFinite(tsRaw) || !Number.isFinite(closeRaw) || closeRaw <= 0) continue;
      if (confirm === "0") continue;
      const tsMs = tsRaw < 1e12 ? tsRaw * 1e3 : tsRaw;
      out.push({ tsMs, close: closeRaw });
      continue;
    }
    if (row && typeof row === "object") {
      const o = row;
      const tsRaw = o.ts ?? o.time;
      const cr = o.c ?? o.close;
      const ts = typeof tsRaw === "string" ? Number.parseInt(tsRaw, 10) : typeof tsRaw === "number" ? tsRaw : NaN;
      const close = typeof cr === "string" ? parseFloat(cr) : typeof cr === "number" ? cr : NaN;
      const confirmRaw = String(o.confirm ?? "1").trim();
      if (confirmRaw === "0") continue;
      if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue;
      const tsMs = ts < 1e12 ? ts * 1e3 : ts;
      out.push({ tsMs, close });
    }
  }
  return out;
}
async function dexCandlesFetch(coinType, bar, pivot) {
  const tokenContractAddress = isNativeSuiCoinType(coinType) ? "" : coinType;
  const q = new URLSearchParams({
    chainIndex: CHAIN_SUI2,
    tokenContractAddress,
    bar,
    limit: "299"
  });
  if (pivot.afterMs != null) q.set("after", String(Math.floor(pivot.afterMs)));
  if (pivot.beforeMs != null) q.set("before", String(Math.floor(pivot.beforeMs)));
  const path = `/api/v6/dex/market/historical-candles?${q.toString()}`;
  let j;
  try {
    j = await okxSignedGet(path);
  } catch {
    return [];
  }
  if (j == null || j.data == null) return [];
  return parseOkxHistoricalCandlesData(j.data);
}
var OKX_BAR_DURATION_MS = {
  "1Dutc": 864e5,
  "4H": 144e5,
  "1H": 36e5,
  "15m": 9e5,
  "1m": 6e4
};
function closestCandleToTarget(rows, targetMs, barDurationMs) {
  if (rows.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const r of rows) {
    const openMs = r.tsMs;
    const closeMs = openMs + barDurationMs;
    const dist = Math.max(0, openMs - targetMs, targetMs - closeMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
}
var DEX_BARS_CASCADE = ["1Dutc", "4H", "1H", "15m", "1m"];
async function okxDexHistoricalClosestUsd(coinType, timestampSec) {
  if (!Number.isFinite(timestampSec) || timestampSec <= 0) return null;
  const targetMs = Math.floor(timestampSec * 1e3);
  for (const bar of DEX_BARS_CASCADE) {
    const barDurationMs = OKX_BAR_DURATION_MS[bar] ?? 36e5;
    const merged = /* @__PURE__ */ new Map();
    const [afterBranch, beforeBranch] = await Promise.all([
      dexCandlesFetch(coinType, bar, { afterMs: targetMs }),
      dexCandlesFetch(coinType, bar, { beforeMs: targetMs })
    ]);
    for (const c of [...afterBranch, ...beforeBranch]) merged.set(Math.floor(c.tsMs), c);
    const cand = closestCandleToTarget([...merged.values()], targetMs, barDurationMs);
    if (cand && cand.close > 0) {
      const openSec = Math.floor(cand.tsMs / 1e3);
      const midpointOffsetSec = Math.floor(barDurationMs / 2e3);
      return {
        usdPerToken: cand.close,
        quoteAsOfUnixSec: openSec + midpointOffsetSec
      };
    }
  }
  return null;
}
function walletPriceTimeToMs(raw) {
  const t = Number.parseFloat(raw);
  if (!Number.isFinite(t)) return null;
  return t < 1e12 ? t * 1e3 : t;
}
function pickClosestPriceWithMeta(rows, targetMs) {
  if (rows.length === 0) return null;
  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    const timeMs = walletPriceTimeToMs(r.time);
    if (timeMs == null) continue;
    const px = parseFloat(r.price);
    if (!Number.isFinite(px) || px <= 0) continue;
    const d = Math.abs(timeMs - targetMs);
    if (d < bestDelta) {
      bestDelta = d;
      best = { price: px, timeMs };
    }
  }
  if (best == null) return null;
  return { usdPerToken: best.price, quoteAsOfUnixSec: Math.floor(best.timeMs / 1e3) };
}
async function walletHistoricalOneWindow(coinType, targetMs, halfSpanMs, period, limit) {
  const begin = String(targetMs - halfSpanMs);
  const end = String(targetMs + halfSpanMs);
  const token = okxWalletTokenAddressParam(coinType);
  const q = new URLSearchParams({
    chainIndex: CHAIN_SUI2,
    limit,
    begin,
    end,
    period
  });
  if (token) q.set("tokenAddress", token);
  const path = `/api/v5/wallet/token/historical-price?${q.toString()}`;
  let j;
  try {
    j = await okxSignedGet(path);
  } catch {
    return null;
  }
  if (j == null) return null;
  const rows = parseWalletHistoricalData(j.data);
  const pick = pickClosestPriceWithMeta(rows, targetMs);
  return pick ?? null;
}
async function okxWalletHistoricalClosestUsd(coinType, timestampSec) {
  if (!Number.isFinite(timestampSec) || timestampSec <= 0) return null;
  const targetMs = Math.floor(timestampSec * 1e3);
  const tiers = [
    { halfSpanMs: 5 * 60 * 1e3, period: "1m", limit: "72" },
    { halfSpanMs: 24 * 60 * 60 * 1e3, period: "15m", limit: "144" },
    { halfSpanMs: 7 * 24 * 60 * 60 * 1e3, period: "1H", limit: "336" }
  ];
  for (const t of tiers) {
    const px = await walletHistoricalOneWindow(coinType, targetMs, t.halfSpanMs, t.period, t.limit);
    if (px != null) return px;
  }
  return null;
}
async function okxCurrentSpotUsd(coinType) {
  const m = await okxPriceInfoByCoinType([coinType]);
  const n2 = normalizeCoinTypeForMatch(coinType);
  for (const [k, v] of m) {
    if (normalizeCoinTypeForMatch(k) === n2 && v.price > 0) return v.price;
  }
  return null;
}

// src/services/pythSymbolStatic.ts
var ALIAS = {
  SUI: "SUI",
  USDC: "USDC",
  USDT: "USDT",
  BTC: "BTC",
  ETH: "ETH",
  WETH: "ETH",
  WBTC: "WBTC",
  BSUI: "SUI",
  /* LST / обгортки ≈ SUI для Pyth feed */
  AFSUI: "SUI",
  STSUI: "SUI",
  VSUI: "SUI",
  XSUI: "SUI",
  X_SUI: "SUI",
  HASUI: "SUI",
  FSUI: "SUI"
};
function normSymbol(symbol) {
  return symbol.toUpperCase().split(/[\/\s-]/)[0] ?? "";
}
function getPythStaticFeedId(symbol) {
  const raw = normSymbol(symbol);
  const k = ALIAS[raw] ?? (raw in PYTH_USD_FEEDS ? raw : null);
  if (!k) return null;
  return PYTH_USD_FEEDS[k] ?? null;
}

// src/services/pythFeedDiscovery.ts
var LS_KEY2 = "pyth-hermes-feed-cache-v1";
var LS_NEGATIVE = "pyth-hermes-no-feed-v1";
var memory = null;
var negativeMemory = null;
function loadFromStorage() {
  if (typeof localStorage === "undefined") return /* @__PURE__ */ new Map();
  try {
    const raw = localStorage.getItem(LS_KEY2);
    if (!raw) return /* @__PURE__ */ new Map();
    const o = JSON.parse(raw);
    const m = /* @__PURE__ */ new Map();
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && v.startsWith("0x") && v.length > 4) m.set(k.toUpperCase(), v);
    }
    return m;
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function loadNegative() {
  if (typeof localStorage === "undefined") return /* @__PURE__ */ new Set();
  try {
    const raw = localStorage.getItem(LS_NEGATIVE);
    if (!raw) return /* @__PURE__ */ new Set();
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return /* @__PURE__ */ new Set();
    return new Set(a.filter((x) => typeof x === "string").map((x) => x.toUpperCase()));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function getNegative() {
  if (!negativeMemory) negativeMemory = loadNegative();
  return negativeMemory;
}
function getMap() {
  if (!memory) memory = loadFromStorage();
  return memory;
}
function getCachedPythFeedId(symbol) {
  const k = symbol.toUpperCase().split(/[\/\s-]/)[0] ?? "";
  if (getNegative().has(k)) return null;
  return getMap().get(k) ?? null;
}

// src/services/pythBenchmark.ts
function resolveFeed(symbol) {
  return getPythStaticFeedId(symbol) ?? getCachedPythFeedId(symbol);
}
var pythLimiter = createRateLimiter(200);
var PYTH_FETCH_TIMEOUT_MS = 1e4;
async function getPythBenchmarkUsd(symbol, timestampSec) {
  const id = resolveFeed(symbol);
  if (!id) return null;
  const feedId = id.startsWith("0x") ? id.slice(2) : id;
  return pythLimiter(async () => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), PYTH_FETCH_TIMEOUT_MS);
    try {
      const u = new URL(`https://hermes.pyth.network/v2/updates/price/${Math.floor(timestampSec)}`);
      u.searchParams.append("ids[]", feedId);
      u.searchParams.set("parsed", "true");
      const r = await fetch(extFetchUrl(u.toString()), { signal: ac.signal });
      if (!r.ok) return null;
      const j = await r.json();
      const p = j.parsed?.[0]?.price;
      if (!p) return null;
      const px = Number(p.price) * 10 ** p.expo;
      return Number.isFinite(px) && px > 0 ? px : null;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  });
}

// src/services/poolAddressCache.ts
var LS = "sui_lp_pool_for_token_v1";
var DAY = 24 * 60 * 60 * 1e3;
var TTL = 24 * DAY;
function read() {
  try {
    const r = localStorage.getItem(LS);
    if (!r) return {};
    return JSON.parse(r);
  } catch {
    return {};
  }
}
function write(s) {
  try {
    localStorage.setItem(LS, JSON.stringify(s));
  } catch {
  }
}
function norm(t) {
  return `${GECKO_NETWORK}:${t}`;
}
var poolAddressCache = {
  get(tokenKey) {
    const s = read();
    const e = s[norm(tokenKey)];
    if (!e) return null;
    if (Date.now() - e.at > TTL) {
      const next = { ...s };
      delete next[norm(tokenKey)];
      write(next);
      return null;
    }
    return e.address;
  },
  set(tokenKey, address) {
    const s = read();
    s[norm(tokenKey)] = { address, at: Date.now() };
    write(s);
  }
};

// src/services/priceCache.ts
var HOUR_MS = 60 * 60 * 1e3;
var LS_KEY3 = "sui_lp_price_cache_v5";
var CACHE_TTL_MS = 30 * 24 * HOUR_MS;
function readStore() {
  try {
    const raw = localStorage.getItem(LS_KEY3);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function writeStore(s) {
  try {
    localStorage.setItem(LS_KEY3, JSON.stringify(s));
  } catch {
  }
}
function roundToHour(tsSec) {
  return Math.floor(tsSec / 3600) * 3600;
}
function cacheKey(symbol, ts) {
  return `${symbol}_${roundToHour(ts)}`;
}
var priceCache = {
  /** Returns the cached entry, or null if not cached / expired. */
  get(symbol, tsSec) {
    const k = cacheKey(symbol, tsSec);
    const store = readStore();
    const e = store[k];
    if (!e) return null;
    if (Date.now() - e.cachedAt > CACHE_TTL_MS) {
      delete store[k];
      writeStore(store);
      return null;
    }
    return { price: e.price, quoteAsOfUnixSec: e.quoteAsOfUnixSec };
  },
  /** quoteAsOfUnixSec: null for Pyth (second-accurate → caller uses tsSec); candle midpoint for OHLCV. */
  set(symbol, tsSec, price, quoteAsOfUnixSec) {
    const k = cacheKey(symbol, tsSec);
    const store = readStore();
    store[k] = { price, cachedAt: Date.now(), quoteAsOfUnixSec };
    writeStore(store);
  }
};

// src/services/priceService.ts
var STABLECOIN_USD_SYMBOLS = /* @__PURE__ */ new Set([
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "TUSD",
  "FDUSD",
  "PYUSD",
  "USDD",
  "FRAX",
  "LUSD",
  "SUSD",
  "GUSD"
]);
var GT_ACCEPT = { Accept: "application/json;version=20230302" };
var gtLimiter = createRateLimiter(2100);
var GT_FETCH_TIMEOUT_MS = 15e3;
function asPositive(px) {
  const n2 = px == null ? NaN : typeof px === "number" ? px : Number(px);
  return Number.isFinite(n2) && n2 > 0 ? n2 : null;
}
async function getUsdPerTokenAtTimestamp(tokenSymbol, coinType, timestampSec) {
  const tsSec = Math.floor(timestampSec);
  const empty = () => ({
    usdPerToken: null,
    source: "cache",
    approximate: false,
    quoteAsOfUnixSec: null
  });
  if (STABLECOIN_USD_SYMBOLS.has(tokenSymbol.toUpperCase())) {
    return {
      usdPerToken: 1,
      source: "pyth",
      approximate: false,
      quoteAsOfUnixSec: tsSec
    };
  }
  const cachedHit = priceCache.get(tokenSymbol, tsSec);
  if (cachedHit != null) {
    return {
      usdPerToken: cachedHit.price,
      source: "cache",
      approximate: false,
      quoteAsOfUnixSec: cachedHit.quoteAsOfUnixSec ?? tsSec
    };
  }
  const finalize = (usdPerToken, source, approximate, quoteAsOfUnixSec) => {
    const cacheQuote = source === "pyth" ? null : quoteAsOfUnixSec;
    priceCache.set(tokenSymbol, tsSec, usdPerToken, cacheQuote);
    return { usdPerToken, source, approximate, quoteAsOfUnixSec };
  };
  let pythPx = null;
  try {
    pythPx = asPositive(await getPythBenchmarkUsd(tokenSymbol, tsSec));
  } catch {
    pythPx = null;
  }
  if (pythPx != null) return finalize(pythPx, "pyth", false, tsSec);
  if (isOkxDexConfigured() && !isOkxCircuitOpen()) {
    try {
      const c = await okxDexHistoricalClosestUsd(coinType, tsSec);
      const px = c != null ? asPositive(c.usdPerToken) : null;
      if (px != null) return finalize(px, "okx_dex_candles", false, c.quoteAsOfUnixSec);
    } catch {
    }
    try {
      const w = await okxWalletHistoricalClosestUsd(coinType, tsSec);
      const wp = w != null ? asPositive(w.usdPerToken) : null;
      if (wp != null) return finalize(wp, "okx_wallet_hist", false, w.quoteAsOfUnixSec);
    } catch {
    }
  }
  let poolId = null;
  try {
    poolId = await getTopPoolForToken(coinType);
  } catch {
    poolId = null;
  }
  if (poolId) {
    try {
      const gt = await fetchOhlcvClosest(poolId, tsSec);
      if (gt != null && gt.close > 0) {
        return finalize(gt.close, "geckoterminal", false, gt.quoteAsOfUnixSec);
      }
    } catch {
    }
  }
  if (isOkxDexConfigured() && !isOkxCircuitOpen()) {
    try {
      const spot = asPositive(await okxCurrentSpotUsd(coinType));
      if (spot != null) {
        return {
          usdPerToken: spot,
          source: "okx_dex_spot_current",
          approximate: true,
          quoteAsOfUnixSec: Math.floor(Date.now() / 1e3)
        };
      }
    } catch {
    }
  }
  return empty();
}
async function getTopPoolForToken(tokenAddress) {
  const cached2 = poolAddressCache.get(tokenAddress);
  if (cached2) return cached2;
  const u = new URL(
    `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens/${tokenAddress}/pools`
  );
  u.searchParams.set("page", "1");
  return gtLimiter(async () => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), GT_FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(u.toString(), { headers: GT_ACCEPT, signal: ac.signal });
      if (!r.ok) return null;
      const j = await r.json();
      const addr = j.data?.[0]?.attributes?.address;
      if (addr) poolAddressCache.set(tokenAddress, addr);
      return addr ?? null;
    } finally {
      clearTimeout(t);
    }
  });
}
function ohlcvRowTimeToUnixSec(t0) {
  if (typeof t0 !== "number" || !Number.isFinite(t0)) return null;
  if (t0 > 1e12) return Math.floor(t0 / 1e3);
  if (t0 > 1e9) return Math.floor(t0);
  return null;
}
async function fetchOhlcvClosest(poolAddress, timestampSec) {
  const aggregatesHours = [1, 4, 24];
  for (const aggregateHours of aggregatesHours) {
    const one = await fetchOhlcvAggregatedRow(poolAddress, timestampSec, aggregateHours);
    if (one != null && one.close > 0) return one;
  }
  return null;
}
async function fetchOhlcvAggregatedRow(poolAddress, timestampSec, aggregateHours) {
  const candleDurationSec = aggregateHours * 3600;
  const beforeTs = timestampSec + candleDurationSec + 3600;
  const base = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools/${poolAddress}/ohlcv/hour`;
  const u = new URL(base);
  u.searchParams.set("aggregate", String(aggregateHours));
  u.searchParams.set("before_timestamp", String(beforeTs));
  u.searchParams.set("limit", "20");
  u.searchParams.set("currency", "usd");
  return gtLimiter(async () => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), GT_FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(u.toString(), { headers: GT_ACCEPT, signal: ac.signal });
      if (!r.ok) return null;
      const j = await r.json();
      const rows = j.data?.attributes?.ohlcv_list;
      if (!rows || rows.length === 0) return null;
      let bestRow = null;
      let bestDist = Infinity;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 5) continue;
        const openTs2 = ohlcvRowTimeToUnixSec(row[0]);
        if (openTs2 == null) continue;
        const close2 = row[4];
        if (typeof close2 !== "number" || !Number.isFinite(close2) || close2 <= 0) continue;
        const closeTs = openTs2 + candleDurationSec;
        const dist = Math.max(0, openTs2 - timestampSec, timestampSec - closeTs);
        if (dist < bestDist) {
          bestDist = dist;
          bestRow = row;
        }
      }
      if (!bestRow) return null;
      const close = bestRow[4];
      if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) return null;
      const openTs = ohlcvRowTimeToUnixSec(bestRow[0]);
      const quoteAsOfUnixSec = openTs != null ? openTs + Math.floor(candleDurationSec / 2) : null;
      return { close, quoteAsOfUnixSec };
    } finally {
      clearTimeout(t);
    }
  });
}

// src/utils/suiObjectRead.ts
function suiErrorText(error) {
  if (error == null) return "";
  if (typeof error === "string") return error;
  return error.message || error.error || error.code || "rpc error";
}
function isDynamicFieldNotFound(error) {
  const text = suiErrorText(error).toLowerCase();
  const code = typeof error === "object" && error ? String(error.code ?? "").toLowerCase() : "";
  return code === "dynamicfieldnotfound" || text.includes("dynamicfieldnotfound") || text.includes("dynamic field not found");
}
function classifySuiObjectRead(res, thrown) {
  if (thrown != null) {
    const reason = thrown instanceof Error ? thrown.message : String(thrown);
    if (isDynamicFieldNotFound(reason)) return { kind: "not_found", reason };
    return { kind: "unavailable", reason: reason || "rpc throw" };
  }
  if (res == null) return { kind: "unavailable", reason: "empty rpc response" };
  if (res.error != null && suiErrorText(res.error)) {
    if (isDynamicFieldNotFound(res.error)) return { kind: "not_found", reason: suiErrorText(res.error) };
    return { kind: "unavailable", reason: suiErrorText(res.error) };
  }
  if (res.data == null) return { kind: "unavailable", reason: "malformed content" };
  return { kind: "ok", reason: "" };
}

// src/services/currentService.ts
import { Transaction } from "@mysten/sui/transactions";
import { bcs as bcs2 } from "@mysten/sui/bcs";
var API = "https://api.current.finance";
var PROTOCOL_PKG = "0x45bae0425e9098ce5cba3d3fa2836220ad24c9f88aa0dffffb5a52b49319fc70";
var COIN_DECIMALS_REGISTRY = "0x53785858526d8ed3826cfc245b0fd53f16179036f38fc024c3851ef07b1538d7";
var DECIMAL_SCALE = 10n ** 18n;
var SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
var MARKET_OBJECT_BY_TYPE = {
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket": "0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df",
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EmberMarket": "0x8e85c433f791685c65fa66923110b8385e13f955daf8792ef805ce2d47139bbc",
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::AltCoinMarket": "0x6f5230c346e27132b8d4d92cb3f4f9c7f4e736d5c32b8f0a2b063c97e67d78f7",
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EthenaMarket": "0xeeef7e9abe201e16c3ca6417b91fa49bec28edcb077eb2fd4a1f126c251e6899",
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MatrixGoldMarket": "0xafe28c816d322a56bdab27b90d4b5e882a0a34ee2d9f02c6a07402a2b69be900",
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::Market01": "0x2d682541f1e983e48d5c628f013d11d4c8f96f410338532791d3ece882766220"
};
var MARKET_LIST_TYPES = [
  "MainMarket",
  "EmberMarket",
  "AltCoinMarket",
  "EthenaMarket",
  "MatrixGoldMarket",
  "Market01"
];
var decimalSchema = bcs2.struct("Decimal", { value: bcs2.u256() });
var overviewSchema = bcs2.struct("ObligationDetail", {
  emode_group_id: bcs2.u8(),
  borrows: bcs2.vector(
    bcs2.struct("ObligationBorrow", {
      asset: bcs2.string(),
      borrow_index: decimalSchema,
      debt: decimalSchema
    })
  ),
  deposits: bcs2.vector(
    bcs2.struct("ObligationDeposit", {
      asset: bcs2.string(),
      ctoken_amount: bcs2.u64()
    })
  )
});
function with0x(t) {
  const s = t.trim();
  return s.startsWith("0x") || s.startsWith("0X") ? s : `0x${s}`;
}
function typeKey(t) {
  return t.trim().replace(/^0x/i, "").toLowerCase();
}
async function getJson(path) {
  const res = await fetch(extFetchUrl(`${API}${path}`), { signal: AbortSignal.timeout(2e4) });
  if (!res.ok) throw new Error(`Current API ${res.status} ${path}`);
  const json = await res.json();
  if (json.code != null && json.code !== 0) {
    throw new Error(`Current API ${json.message ?? json.code} ${path}`);
  }
  return json.data;
}
var marketCache = null;
function currentMarketListMeta() {
  if (!marketCache) return { receivedAtMs: null, ageMs: null, partial: false, failedMarkets: [] };
  return {
    receivedAtMs: marketCache.ts,
    ageMs: Date.now() - marketCache.ts,
    partial: marketCache.partial,
    failedMarkets: marketCache.failed
  };
}
async function fetchMarketListPage(marketType) {
  const q = marketType ? `/market/getMarketList?page=1&size=100&marketType=${encodeURIComponent(marketType)}` : "/market/getMarketList?page=1&size=100";
  const data = await getJson(q);
  return data?.content ?? [];
}
async function fetchAllMarketRows() {
  const now2 = Date.now();
  if (!marketCache || now2 - marketCache.ts >= 6e4) {
    const failed = [];
    const pages = await Promise.all(
      MARKET_LIST_TYPES.map(async (t) => {
        try {
          return await fetchMarketListPage(t);
        } catch (err) {
          console.warn("[Current] market list skipped", t, err);
          failed.push(t);
          return [];
        }
      })
    );
    const merged = [];
    const seen = /* @__PURE__ */ new Set();
    for (const page of pages) {
      for (const row of page) {
        const key = `${typeKey(row.marketType ?? "")}|${typeKey(row.token ?? "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
    }
    if (merged.length === 0) {
      try {
        merged.push(...await fetchMarketListPage());
      } catch (err) {
        console.warn("[Current] unfiltered market list failed", err);
        failed.push("unfiltered");
      }
    }
    marketCache = {
      ts: now2,
      rows: merged,
      partial: failed.length > 0 || merged.length === 0,
      failed
    };
  }
  return marketCache.rows;
}
function rowsForMarket(all, marketType) {
  const key = typeKey(marketType);
  return all.filter((r) => typeKey(r.marketType ?? "") === key);
}
function venueNameFromType(marketType) {
  const name = marketType.split("::").pop() ?? "Market";
  if (name === "MainMarket") return "Main";
  if (name === "EmberMarket") return "Ember";
  if (name === "AltCoinMarket") return "AltCoin";
  if (name === "EthenaMarket") return "Ethena";
  if (name === "MatrixGoldMarket") return "Matrix Gold";
  if (name === "Market01") return "sUSN Market";
  return name.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
}
function resolveCurrentSupplyBaseApr(listSupplyApy, chainSupplyApy) {
  if (typeof listSupplyApy === "number" && Number.isFinite(listSupplyApy)) {
    return { baseApr: listSupplyApy, baseKnown: true };
  }
  if (typeof chainSupplyApy === "number" && Number.isFinite(chainSupplyApy)) {
    return { baseApr: chainSupplyApy, baseKnown: true };
  }
  return { baseApr: Number.NaN, baseKnown: false };
}
function resolveCurrentVenueLabel(marketObjectId, listed, marketType) {
  const idKey = typeKey(marketObjectId);
  const rows = listed.filter((r) => typeKey(r.marketID ?? "") === idKey);
  const apiName = rows.find((r) => r.name?.trim())?.name?.trim();
  const typeShort = marketType.split("::").pop() ?? "";
  if (apiName && apiName !== typeShort) return apiName;
  return venueNameFromType(marketType);
}
function resolveMarketObjectId(marketType, listed) {
  const fromList = listed.find((r) => r.marketID)?.marketID;
  if (typeof fromList === "string" && fromList.startsWith("0x")) return fromList;
  const key = typeKey(marketType);
  for (const [t, id] of Object.entries(MARKET_OBJECT_BY_TYPE)) {
    if (typeKey(t) === key) return id;
  }
  return null;
}
async function readLendingMarketId(obligationId) {
  const client = suiClient;
  const obj = await client.getObject({ id: obligationId, options: { showContent: true } });
  const id = obj.data?.content?.fields?.lending_market_id;
  return typeof id === "string" && id.startsWith("0x") ? id : null;
}
function flowKey(marketType, coin) {
  return `${typeKey(marketType)}|${typeKey(coin)}`;
}
function marketByToken(rows, asset) {
  const key = typeKey(asset);
  return rows.find((r) => typeKey(r.token ?? "") === key);
}
async function inspectOverview(marketType, marketId, obligationId, sender) {
  const client = suiClient;
  const tx = new Transaction();
  tx.moveCall({
    target: `${PROTOCOL_PKG}::obligation_query::get_obligation_overview`,
    typeArguments: [with0x(marketType)],
    arguments: [tx.object(marketId), tx.pure.id(obligationId)]
  });
  const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
  if (res.error) throw new Error(`Current overview: ${res.error}`);
  const raw = res.results?.[0]?.returnValues?.[0]?.[0];
  if (!raw) throw new Error("Current overview: empty return");
  return parseCurrentObligationOverviewReturn(raw);
}
function parseCurrentObligationOverviewReturn(raw) {
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  const parsed = overviewSchema.parse(bytes);
  return {
    emode_group_id: parsed.emode_group_id,
    deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
    borrows: Array.isArray(parsed.borrows) ? parsed.borrows : []
  };
}
function parseRatesVectorReturn(raw) {
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  const vec = bcs2.vector(decimalSchema);
  return vec.parse(bytes);
}
async function inspectRates(marketType, marketId, assets, sender) {
  const out = /* @__PURE__ */ new Map();
  if (assets.length === 0) return out;
  const client = suiClient;
  const tx = new Transaction();
  for (const asset of assets) {
    tx.moveCall({
      target: `${PROTOCOL_PKG}::market_query::get_asset_market_rates`,
      typeArguments: [with0x(marketType)],
      arguments: [tx.object(marketId), tx.pure.string(asset.replace(/^0x/i, "")), tx.object("0x6")]
    });
  }
  const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
  if (res.error) throw new Error(`Current rates: ${res.error}`);
  for (let i = 0; i < assets.length; i++) {
    const raw = res.results?.[i]?.returnValues?.[0]?.[0];
    if (!raw) continue;
    const parsed = parseRatesVectorReturn(raw);
    out.set(typeKey(assets[i]), {
      exchange: BigInt(parsed[0]?.value ?? 0),
      borrowIndex: BigInt(parsed[1]?.value ?? 0)
    });
  }
  return out;
}
var overviewDecimal = bcs2.struct("OverviewDecimal", { value: bcs2.u256() });
var assetOverviewSchema = bcs2.struct("AssetConfiguration", {
  coin_type: bcs2.string(),
  interest_model: bcs2.struct("InterestModel", {
    base_borrow_rate_per_sec: overviewDecimal,
    borrow_rate_on_mid_kink: overviewDecimal,
    mid_kink: overviewDecimal,
    borrow_rate_on_high_kink: overviewDecimal,
    high_kink: overviewDecimal,
    max_borrow_rate: overviewDecimal
  }),
  utilization_rate: overviewDecimal,
  borrow_paused: bcs2.bool(),
  deposit_paused: bcs2.bool(),
  withdraw_paused: bcs2.bool(),
  liquidation_paused: bcs2.bool(),
  flash_loan_paused: bcs2.bool(),
  reserve: bcs2.u64(),
  asset_setting: bcs2.struct("BorrowConfig", {
    min_borrow_amount: bcs2.u64(),
    max_borrow_amount: bcs2.u64(),
    max_deposit_amount: bcs2.u64(),
    repay_fee_rate: overviewDecimal,
    liquidation_fee_rate: overviewDecimal
  }),
  deposit_usage: bcs2.struct("AssetDeposit", {
    is_collateral: bcs2.bool(),
    valuation: bcs2.struct("AssetValuation", {
      coin_type: bcs2.string(),
      amount: bcs2.u64(),
      usd: overviewDecimal,
      price: overviewDecimal
    }),
    ctoken_amount: bcs2.u64(),
    exchange_rate: overviewDecimal
  }),
  borrow_usage: bcs2.struct("AssetBorrow", {
    valuation: bcs2.struct("BorrowValuation", {
      coin_type: bcs2.string(),
      amount: bcs2.u64(),
      usd: overviewDecimal,
      price: overviewDecimal
    }),
    borrow_index: overviewDecimal
  })
});
function wadMul(a, b) {
  return a * b / DECIMAL_SCALE;
}
function wadDiv(a, b) {
  if (b === 0n) return 0n;
  return a * DECIMAL_SCALE / b;
}
function borrowRatePerSec(model, utilization) {
  const base = BigInt(model.base_borrow_rate_per_sec.value);
  const mid = BigInt(model.mid_kink.value);
  const high = BigInt(model.high_kink.value);
  const onMid = BigInt(model.borrow_rate_on_mid_kink.value);
  const onHigh = BigInt(model.borrow_rate_on_high_kink.value);
  const max = BigInt(model.max_borrow_rate.value);
  const gap = (a, b) => a > b ? a - b : 0n;
  if (utilization <= mid) return wadMul(wadDiv(utilization, mid), gap(onMid, base)) + base;
  if (utilization <= high) return wadMul(wadDiv(gap(utilization, mid), gap(high, mid)), gap(onHigh, onMid)) + onMid;
  return wadMul(wadDiv(gap(utilization, high), gap(DECIMAL_SCALE, high)), gap(max, onHigh)) + onHigh;
}
function aprFromPerSec(perSec) {
  const annual = perSec * SECONDS_PER_YEAR * 1000000000000n / DECIMAL_SCALE;
  return Number(annual) / 1e12;
}
async function inspectInterestApr(marketType, marketId, assets, sender) {
  const out = /* @__PURE__ */ new Map();
  if (assets.length === 0) return out;
  const client = suiClient;
  const tx = new Transaction();
  for (const asset of assets) {
    tx.moveCall({
      target: `${PROTOCOL_PKG}::market_query::get_asset_market_overview`,
      typeArguments: [with0x(marketType)],
      arguments: [
        tx.object(marketId),
        tx.pure.string(asset.replace(/^0x/i, "")),
        tx.object(COIN_DECIMALS_REGISTRY),
        tx.pure.u64(DECIMAL_SCALE),
        tx.pure.u64(DECIMAL_SCALE),
        tx.object("0x6")
      ]
    });
  }
  const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
  if (res.error) throw new Error(`Current interest overview: ${res.error}`);
  for (let i = 0; i < assets.length; i++) {
    const raw = res.results?.[i]?.returnValues?.[0]?.[0];
    if (!raw) continue;
    const asset = assetOverviewSchema.parse(Uint8Array.from(raw));
    const utilization = BigInt(asset.utilization_rate.value);
    const fee = BigInt(asset.asset_setting.repay_fee_rate.value);
    const borrowPerSec = asset.borrow_paused ? 0n : borrowRatePerSec(asset.interest_model, utilization);
    const supplyPerSec = wadMul(wadMul(borrowRatePerSec(asset.interest_model, utilization), DECIMAL_SCALE - fee), utilization);
    out.set(typeKey(assets[i]), { supply: aprFromPerSec(supplyPerSec), borrow: aprFromPerSec(borrowPerSec) });
  }
  return out;
}
function humanFromRaw(raw, decimals) {
  const scale = 10 ** decimals;
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const whole = v / BigInt(scale);
  const frac = v % BigInt(scale);
  const n2 = Number(whole) + Number(frac) / scale;
  return neg ? -n2 : n2;
}
function coinRaw(scaled, scale = DECIMAL_SCALE) {
  if (scale === 0n) return 0n;
  return scaled / scale;
}
var YEAR_MS = 365 * 24 * 60 * 60 * 1e3;
function normTypeName(s) {
  const parts = s.trim().replace(/^0x/i, "").split("::");
  if (parts.length < 3) return s.trim().replace(/^0x/i, "");
  return `${parts[0].padStart(64, "0").toLowerCase()}::${parts.slice(1).join("::")}`;
}
function readDecimals(meta) {
  const d = Number(meta?.tokenInfo?.decimals);
  return Number.isFinite(d) && d >= 0 && d <= 18 ? d : null;
}
function readPrice(meta) {
  const p = Number(meta?.tokenInfo?.price);
  return Number.isFinite(p) && p > 0 ? p : null;
}
async function readMiningRewardApr(marketId, side, reserveCoin, exchangeOrIndex, reserveDecimals, reservePrice, listed, priceCatalog) {
  const catalog = priceCatalog ?? listed;
  const readAtMs = Date.now();
  if (!(reservePrice > 0) || exchangeOrIndex <= 0n || !(reserveDecimals >= 0)) {
    return { status: "unavailable", apr: null, parts: [], reason: "reserve price or scale missing", readAtMs };
  }
  let market;
  try {
    market = await suiClient.getObject({ id: marketId, options: { showContent: true } });
  } catch (err) {
    return { status: "unavailable", apr: null, parts: [], reason: err instanceof Error ? err.message : String(err), readAtMs };
  }
  const marketClass = classifySuiObjectRead(market);
  if (marketClass.kind !== "ok") {
    return { status: "unavailable", apr: null, parts: [], reason: marketClass.reason || "market object", readAtMs };
  }
  const content = fieldsOf(market.data?.content);
  const miner = fieldsOf(content?.liquidity_miner);
  const tableId = uidOf(miner?.[side]);
  if (!miner) {
    return { status: "unavailable", apr: null, parts: [], reason: "malformed liquidity miner", readAtMs };
  }
  if (!tableId) {
    return { status: "empty", apr: 0, parts: [], reason: "no mining table", readAtMs };
  }
  let df;
  try {
    df = await suiClient.getDynamicFieldObject({
      parentId: tableId,
      name: { type: "0x1::type_name::TypeName", value: { name: normTypeName(reserveCoin) } }
    });
  } catch (err) {
    const classified = classifySuiObjectRead(null, err);
    if (classified.kind === "not_found") return { status: "empty", apr: 0, parts: [], readAtMs };
    return { status: "unavailable", apr: null, parts: [], reason: classified.reason, readAtMs };
  }
  const dfClass = classifySuiObjectRead(df);
  if (dfClass.kind === "not_found") return { status: "empty", apr: 0, parts: [], readAtMs };
  if (dfClass.kind !== "ok") {
    return { status: "unavailable", apr: null, parts: [], reason: dfClass.reason, readAtMs };
  }
  const manager = fieldsOf(fieldsOf(df.data?.content)?.value);
  if (!manager) {
    return { status: "unavailable", apr: null, parts: [], reason: "malformed reward manager", readAtMs };
  }
  const totalShares = BigInt(String(manager.total_shares ?? "0"));
  if (totalShares <= 0n) return { status: "empty", apr: 0, parts: [], readAtMs };
  const underlyingRaw = coinRaw(totalShares * exchangeOrIndex);
  const tvl = humanFromRaw(underlyingRaw, reserveDecimals) * reservePrice;
  if (!(tvl > 0)) return { status: "unavailable", apr: null, parts: [], reason: "reserve tvl missing", readAtMs };
  const now2 = Date.now();
  const parts = [];
  let missingMeta = false;
  const rewards = Array.isArray(manager.pool_rewards) ? manager.pool_rewards : [];
  for (const reward of rewards) {
    const f = fieldsOf(reward) ?? {};
    const start = Number(f.start_time_ms ?? 0);
    const end = Number(f.end_time_ms ?? 0);
    if (!(start <= now2 && now2 < end) || end <= start) continue;
    const coin = typeNameString(f.coin_type ?? f.coinType);
    if (!coin) continue;
    const meta = marketByToken(catalog, coin);
    const dec = readDecimals(meta);
    const price = readPrice(meta);
    const raw = String(f.total_rewards ?? "0");
    if (dec == null || price == null) {
      missingMeta = true;
      parts.push({
        symbol: meta?.tokenInfo?.symbol ?? coin.split("::").pop() ?? "?",
        coinType: with0x(coin),
        apr: null,
        amountRaw: raw,
        decimals: dec,
        priceUsd: price
      });
      continue;
    }
    const total = humanFromRaw(BigInt(raw), dec);
    const annual = total * (YEAR_MS / (end - start));
    const apr = annual * price / tvl;
    parts.push({
      symbol: meta?.tokenInfo?.symbol ?? coin.split("::").pop() ?? "?",
      coinType: with0x(coin),
      apr,
      amountRaw: raw,
      decimals: dec,
      priceUsd: price
    });
  }
  const priced = parts.filter((p) => p.apr != null);
  if (parts.length === 0) return { status: "empty", apr: 0, parts: [], readAtMs };
  if (missingMeta) {
    return {
      status: "partial",
      apr: priced.reduce((s, p) => s + (p.apr ?? 0), 0),
      parts,
      reason: "reward metadata incomplete",
      readAtMs
    };
  }
  return { status: "complete", apr: priced.reduce((s, p) => s + (p.apr ?? 0), 0), parts, readAtMs };
}
function moveDecimal(v) {
  if (v == null) return 0n;
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") return BigInt(v);
  const o = v;
  if (o.value != null) return BigInt(o.value);
  if (o.fields?.value != null) return BigInt(o.fields.value);
  return 0n;
}
function fieldsOf(v) {
  if (!v || typeof v !== "object") return null;
  const o = v;
  if (o.fields && typeof o.fields === "object") return o.fields;
  return o;
}
function uidOf(v) {
  if (typeof v === "string" && v.startsWith("0x")) return v;
  const f = fieldsOf(v);
  const id = f?.id;
  if (typeof id === "string" && id.startsWith("0x")) return id;
  if (id && typeof id === "object") {
    const inner = id.id;
    if (typeof inner === "string" && inner.startsWith("0x")) return inner;
  }
  return null;
}
function typeNameString(v) {
  if (typeof v === "string") return v;
  const f = fieldsOf(v);
  if (typeof f?.name === "string") return f.name;
  return "";
}
function mulDec(a, b) {
  return a * b / DECIMAL_SCALE;
}
function divDec(a, b) {
  if (b === 0n) return 0n;
  return a * DECIMAL_SCALE / b;
}
function claimableRows(pool, ob, now2) {
  const share = BigInt(String(ob.share ?? "0"));
  const totalShares = BigInt(String(pool.total_shares ?? "0"));
  if (share <= 0n || totalShares <= 0n) return [];
  const poolLast = BigInt(String(pool.last_update_time_ms ?? "0"));
  const obLast = BigInt(String(ob.last_update_time_ms ?? "0"));
  const rewards = Array.isArray(pool.pool_rewards) ? pool.pool_rewards : [];
  const slots = Array.isArray(ob.rewards) ? ob.rewards : [];
  const totalSharesDec = totalShares * DECIMAL_SCALE;
  const out = [];
  for (let i = 0; i < rewards.length; i++) {
    const f = fieldsOf(rewards[i]) ?? {};
    const start = BigInt(String(f.start_time_ms ?? "0"));
    const end = BigInt(String(f.end_time_ms ?? "0"));
    const duration = end > start ? end - start : 0n;
    let updated = moveDecimal(f.cumulative_rewards_per_share);
    if (now2 > poolLast && duration > 0n) {
      const maxStart = start > poolLast ? start : poolLast;
      const minEnd = end < now2 ? end : now2;
      if (minEnd > maxStart) {
        const timePassed = minEnd - maxStart;
        const totalRewards = BigInt(String(f.total_rewards ?? "0"));
        const unlocked = divDec(
          mulDec(totalRewards * DECIMAL_SCALE, timePassed * DECIMAL_SCALE),
          duration * DECIMAL_SCALE
        );
        updated += divDec(unlocked, totalSharesDec);
      }
    }
    const slot = fieldsOf(slots[i]);
    let prev;
    let earned = 0n;
    if (slot && slot.cumulative_rewards_per_share != null && slot.earned_rewards != null) {
      prev = moveDecimal(slot.cumulative_rewards_per_share);
      earned = moveDecimal(slot.earned_rewards);
    } else if (obLast <= end) {
      if (obLast <= start) earned = updated * share;
      prev = updated;
    } else {
      prev = updated;
    }
    const claim = (earned + (updated - prev) * share) / DECIMAL_SCALE;
    if (claim <= 0n) continue;
    const coin = typeNameString(f.coin_type);
    if (!coin) continue;
    out.push({ coin, raw: claim });
  }
  return out;
}
async function readClaimableMining(marketId, obligationId, deposits, borrows, listed) {
  const readAtMs = Date.now();
  const bySide = {
    deposit: [...new Set(deposits.map(normTypeName))],
    borrow: [...new Set(borrows.map(normTypeName))]
  };
  if (bySide.deposit.length === 0 && bySide.borrow.length === 0) {
    return { status: "empty", rows: [], readAtMs };
  }
  let market;
  try {
    market = await suiClient.getObject({ id: marketId, options: { showContent: true } });
  } catch (err) {
    return {
      status: "unavailable",
      rows: [],
      reason: err instanceof Error ? err.message : String(err),
      readAtMs
    };
  }
  const marketClass = classifySuiObjectRead(market);
  if (marketClass.kind !== "ok") {
    return { status: "unavailable", rows: [], reason: marketClass.reason || "market object", readAtMs };
  }
  const miner = fieldsOf(fieldsOf(market.data?.content)?.liquidity_miner);
  if (!miner) return { status: "unavailable", rows: [], reason: "malformed liquidity miner", readAtMs };
  const now2 = BigInt(Date.now());
  const rawByCoin = /* @__PURE__ */ new Map();
  let sawError = false;
  let errorReason = "";
  let sawPool = false;
  const sides = ["deposit", "borrow"];
  for (const side of sides) {
    const coins = bySide[side];
    if (coins.length === 0) continue;
    const parentId = uidOf(miner[side]);
    if (!parentId) continue;
    for (const coin of coins) {
      let poolDf;
      try {
        poolDf = await suiClient.getDynamicFieldObject({
          parentId,
          name: { type: "0x1::type_name::TypeName", value: { name: coin } }
        });
      } catch (err) {
        const classified = classifySuiObjectRead(null, err);
        if (classified.kind === "not_found") continue;
        sawError = true;
        errorReason = classified.reason;
        continue;
      }
      const poolClass = classifySuiObjectRead(poolDf);
      if (poolClass.kind === "not_found") continue;
      if (poolClass.kind !== "ok") {
        sawError = true;
        errorReason = poolClass.reason;
        continue;
      }
      const pool = fieldsOf(fieldsOf(poolDf.data?.content)?.value);
      if (!pool) {
        sawError = true;
        errorReason = "malformed reward pool";
        continue;
      }
      sawPool = true;
      const obParent = uidOf(pool.obligation_reward_managers);
      if (!obParent) continue;
      let obDf;
      try {
        obDf = await suiClient.getDynamicFieldObject({
          parentId: obParent,
          name: { type: "0x2::object::ID", value: obligationId }
        });
      } catch (err) {
        const classified = classifySuiObjectRead(null, err);
        if (classified.kind === "not_found") continue;
        sawError = true;
        errorReason = classified.reason;
        continue;
      }
      const obClass = classifySuiObjectRead(obDf);
      if (obClass.kind === "not_found") continue;
      if (obClass.kind !== "ok") {
        sawError = true;
        errorReason = obClass.reason;
        continue;
      }
      const ob = fieldsOf(fieldsOf(obDf.data?.content)?.value);
      if (!ob) {
        sawError = true;
        errorReason = "malformed obligation rewards";
        continue;
      }
      for (const row of claimableRows(pool, ob, now2)) {
        rawByCoin.set(row.coin, (rawByCoin.get(row.coin) ?? 0n) + row.raw);
      }
    }
  }
  const rows = [];
  let missingMeta = false;
  for (const [coin, raw] of rawByCoin) {
    if (raw <= 0n) continue;
    const meta = marketByToken(listed, coin);
    const decimals = readDecimals(meta);
    const price = readPrice(meta);
    const amount = decimals != null ? humanFromRaw(raw, decimals) : null;
    if (decimals == null || price == null || amount == null) missingMeta = true;
    rows.push({
      coinType: with0x(coin),
      symbol: meta?.tokenInfo?.symbol ?? coin.split("::").pop() ?? "?",
      amountRaw: raw.toString(),
      decimals,
      amount,
      valueUSD: amount != null && price != null ? amount * price : null
    });
  }
  if (sawError && rows.length === 0 && !sawPool) {
    return { status: "unavailable", rows: [], reason: errorReason || "reward read failed", readAtMs };
  }
  if (rows.length === 0 && !sawError) return { status: "empty", rows: [], readAtMs };
  if (sawError || missingMeta) {
    return { status: "partial", rows, reason: errorReason || "reward metadata incomplete", readAtMs };
  }
  return { status: "complete", rows, readAtMs };
}
function mergeClaimed(rows) {
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const prev = map.get(r.coinType);
    if (!prev) {
      map.set(r.coinType, { ...r });
      continue;
    }
    prev.amount += r.amount;
    prev.valueUSD += r.valueUSD;
  }
  return [...map.values()];
}
var TX_DEPOSIT = 1;
var TX_WITHDRAW = 2;
var TX_BORROW = 3;
var TX_REPAY = 4;
var TX_LIQUIDATE = 5;
function num(v) {
  const n2 = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n2) ? n2 : 0;
}
async function usdAt(symbol, coinType, timestampMs, fallback, cache3) {
  const sec = Math.floor(timestampMs / 1e3);
  const key = `${typeKey(coinType || symbol)}:${sec}`;
  const hit = cache3.get(key);
  if (hit) return hit;
  const quote = symbol ? await getUsdPerTokenAtTimestamp(symbol, with0x(coinType), sec).catch(() => null) : null;
  if (quote?.usdPerToken != null && quote.usdPerToken > 0) {
    const row = { px: quote.usdPerToken, spot: quote.approximate };
    cache3.set(key, row);
    return row;
  }
  return { px: Number.isFinite(fallback) && fallback > 0 ? fallback : 0, spot: true };
}
async function fetchMarketHistory(address, marketType) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const q = new URLSearchParams({
      userAddress: address,
      marketType,
      product: "1",
      page: String(page),
      size: "50"
    });
    const data = await getJson(`/user/getMarketTransactionHistory?${q}`);
    out.push(...data?.content ?? []);
    if (data?.last !== false) break;
  }
  return out;
}
async function loadCashflowTokens(address, marketTypes, listed) {
  const items = [];
  const historyFailed = /* @__PURE__ */ new Set();
  const pages = await mapPool(marketTypes, 4, async (marketType) => {
    try {
      const page = await fetchMarketHistory(address, marketType);
      return { marketType, page };
    } catch (err) {
      historyFailed.add(typeKey(marketType));
      console.warn("[Current] history skipped", marketType, err);
      return { marketType, page: [] };
    }
  });
  for (const { marketType, page } of pages) {
    for (const item of page) items.push({ ...item, marketType });
  }
  items.sort((a, b) => (a.chainTimestampMS ?? 0) - (b.chainTimestampMS ?? 0));
  const cache3 = /* @__PURE__ */ new Map();
  const deposited = /* @__PURE__ */ new Map();
  const borrowed = /* @__PURE__ */ new Map();
  const borrowedCoins = /* @__PURE__ */ new Set();
  const add = (map, coin, amount) => {
    map.set(coin, (map.get(coin) ?? 0) + amount);
  };
  for (const item of items) {
    const coin = typeKey(item.token ?? "");
    const market = item.marketType ?? "";
    if (!coin || !market) continue;
    const key = flowKey(market, coin);
    const decimals = Number(item.tokenInfo?.decimals ?? 0);
    const scale = 10 ** (Number.isFinite(decimals) ? decimals : 0);
    const human = num(item.amount) / scale;
    const refundHuman = num(item.refund) / scale;
    if (!(human > 0)) continue;
    const type = item.type;
    if (type === TX_DEPOSIT) add(deposited, key, human);
    else if (type === TX_WITHDRAW) add(deposited, key, -human);
    else if (type === TX_BORROW) {
      borrowedCoins.add(key);
      add(borrowed, key, human);
    } else if (type === TX_REPAY) {
      add(borrowed, key, -Math.max(0, human - refundHuman));
    } else if (type === TX_LIQUIDATE) {
      if (borrowedCoins.has(key)) add(borrowed, key, -human);
      else add(deposited, key, -human);
    }
  }
  let claimedRewardsUSD = 0;
  let usedSpotPrice = false;
  const claims = await getJson(`/user/getLiquidityMiningHistory/${address}`).catch(
    () => []
  );
  for (const row of claims ?? []) {
    const ts = row.chainTimestampMs ?? 0;
    for (const reward of row.rewards ?? []) {
      const coin = reward.rewardCoinType ?? "";
      const meta = marketByToken(listed, coin);
      const decimals = Number(meta?.tokenInfo?.decimals ?? (coin.endsWith("::sui::SUI") ? 9 : 6));
      const human = num(reward.rewardAmount) / 10 ** (Number.isFinite(decimals) ? decimals : 9);
      if (!(human > 0)) continue;
      const symbol = meta?.tokenInfo?.symbol ?? coin.split("::").pop() ?? "";
      const fallback = Number(meta?.tokenInfo?.price ?? 0);
      const { px, spot } = await usdAt(symbol, coin, ts, fallback, cache3);
      if (spot) usedSpotPrice = true;
      if (px > 0) claimedRewardsUSD += human * px;
    }
  }
  return { deposited, borrowed, claimedRewardsUSD, usedSpotPrice, historyFailed };
}
function currentAdvisorTimingEnabled() {
  return process.env.VITEST !== "true" && process.env.SUI_LP_ADVISOR_DEV_TIMING === "1";
}
function logCurrentAdvisorStep(step, ms) {
  console.log(`[advisor-state] current/${step}: ${ms.toFixed(0)}ms`);
}
async function currentAdvisorTimed(step, fn) {
  if (!currentAdvisorTimingEnabled()) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    logCurrentAdvisorStep(step, performance.now() - t0);
  }
}
async function getCurrentPositions(walletAddress, options) {
  const obligations = await currentAdvisorTimed(
    "obligations-rest",
    () => getJson(`/user/getObligationList/${walletAddress}`)
  );
  const rows = (obligations ?? []).filter((o) => o.obligationObject && o.marketType);
  if (rows.length === 0) return EMPTY_CURRENT_SNAP;
  const supplies = [];
  const borrows = [];
  const claimed = [];
  const marketTypes = [];
  const marketOf = /* @__PURE__ */ new Map();
  const borrowWeightOf = /* @__PURE__ */ new Map();
  const maxLtvOf = /* @__PURE__ */ new Map();
  const allListed = await currentAdvisorTimed("markets-rest", () => fetchAllMarketRows());
  let devInspectMs = 0;
  let miningMs = 0;
  let claimableMs = 0;
  async function currentAdvisorAccum(bucket, fn) {
    if (!currentAdvisorTimingEnabled()) return fn();
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      const delta = performance.now() - t0;
      if (bucket === "devInspect") devInspectMs += delta;
      else if (bucket === "mining") miningMs += delta;
      else claimableMs += delta;
    }
  }
  let skippedObligations = 0;
  for (const ob of rows) {
    const marketType = ob.marketType;
    try {
      if (!marketTypes.includes(marketType)) marketTypes.push(marketType);
      const listed = rowsForMarket(allListed, marketType);
      const priceRows = listed.length > 0 ? listed : allListed;
      const marketObjectId = resolveMarketObjectId(marketType, listed) ?? await readLendingMarketId(ob.obligationObject) ?? void 0;
      if (!marketObjectId) {
        throw new Error(`Current market object missing for ${marketType}`);
      }
      const overview = await currentAdvisorAccum(
        "devInspect",
        () => inspectOverview(marketType, marketObjectId, ob.obligationObject, walletAddress)
      );
      const assets = [
        ...overview.deposits.map((d) => d.asset),
        ...overview.borrows.map((b) => b.asset)
      ];
      const rates = await currentAdvisorAccum(
        "devInspect",
        () => inspectRates(marketType, marketObjectId, assets, walletAddress)
      );
      const chainApr = await currentAdvisorAccum(
        "devInspect",
        async () => listed.length > 0 ? /* @__PURE__ */ new Map() : await inspectInterestApr(marketType, marketObjectId, assets, walletAddress).catch((err) => {
          console.warn("[Current] interest overview", marketType, err);
          return /* @__PURE__ */ new Map();
        })
      );
      const depositMiningReads = overview.deposits.map((dep) => {
        const own = marketByToken(listed, dep.asset);
        const meta = own ?? marketByToken(priceRows, dep.asset);
        const rate = rates.get(typeKey(dep.asset));
        const exchange = rate?.exchange ?? DECIMAL_SCALE;
        const decimals = Number(meta?.tokenInfo?.decimals ?? 9);
        const price = Number(meta?.tokenInfo?.price ?? 0);
        return readMiningRewardApr(
          marketObjectId,
          "deposit",
          dep.asset,
          exchange,
          decimals,
          price,
          priceRows,
          allListed
        ).catch((err) => ({
          status: "unavailable",
          apr: null,
          parts: [],
          reason: err instanceof Error ? err.message : String(err),
          readAtMs: Date.now()
        }));
      });
      const borrowMiningReads = overview.borrows.map((bor) => {
        const own = marketByToken(listed, bor.asset);
        const meta = own ?? marketByToken(priceRows, bor.asset);
        const decimals = Number(meta?.tokenInfo?.decimals ?? 6);
        const price = Number(meta?.tokenInfo?.price ?? 0);
        return readMiningRewardApr(
          marketObjectId,
          "borrow",
          bor.asset,
          DECIMAL_SCALE,
          decimals,
          price,
          priceRows,
          allListed
        ).catch((err) => ({
          status: "unavailable",
          apr: null,
          parts: [],
          reason: err instanceof Error ? err.message : String(err),
          readAtMs: Date.now()
        }));
      });
      const [miningBundle, mined] = await Promise.all([
        currentAdvisorAccum(
          "mining",
          () => Promise.all([Promise.all(depositMiningReads), Promise.all(borrowMiningReads)])
        ),
        currentAdvisorAccum(
          "claimable",
          () => readClaimableMining(
            marketObjectId,
            ob.obligationObject,
            overview.deposits.map((d) => d.asset),
            overview.borrows.map((b) => b.asset),
            priceRows
          ).catch((err) => ({
            status: "unavailable",
            rows: [],
            reason: err instanceof Error ? err.message : String(err),
            readAtMs: Date.now()
          }))
        )
      ]);
      const [depositMiningResults, borrowMiningResults] = miningBundle;
      for (let i = 0; i < overview.deposits.length; i++) {
        const dep = overview.deposits[i];
        const mining = depositMiningResults[i];
        const own = marketByToken(listed, dep.asset);
        const meta = own ?? marketByToken(priceRows, dep.asset);
        const rate = rates.get(typeKey(dep.asset));
        const exchange = rate?.exchange ?? DECIMAL_SCALE;
        const decimals = Number(meta?.tokenInfo?.decimals ?? 9);
        const raw = coinRaw(BigInt(dep.ctoken_amount) * exchange);
        const amount = humanFromRaw(raw, decimals);
        if (amount <= 0) continue;
        const price = Number(meta?.tokenInfo?.price ?? 0);
        const usd = amount * (Number.isFinite(price) ? price : 0);
        const { baseApr, baseKnown } = resolveCurrentSupplyBaseApr(
          own?.supplyAPY,
          chainApr.get(typeKey(dep.asset))?.supply
        );
        const rewardKnown = mining.status === "complete" || mining.status === "empty";
        const rewardApr = rewardKnown ? mining.apr ?? 0 : 0;
        const symbol = meta?.tokenInfo?.symbol ?? dep.asset.split("::").pop() ?? "?";
        const supply = {
          id: `current-supply-${ob.obligationObject}-${typeKey(dep.asset)}`,
          asset: symbol,
          coinType: with0x(dep.asset),
          sCoinType: "",
          suppliedAmount: amount,
          currentAmount: amount,
          earnedInterest: 0,
          earnedInterestUSD: 0,
          supplyAPR: baseKnown ? baseApr + (rewardKnown ? rewardApr : 0) : rewardKnown ? rewardApr : Number.NaN,
          supplyRewardAPR: rewardKnown ? rewardApr : void 0,
          aprBreakdown: {
            baseAPR: baseKnown ? baseApr : Number.NaN,
            rewardAPR: rewardKnown ? rewardApr : Number.NaN,
            rewards: mining.parts.filter((p) => p.apr != null).map((p) => ({ symbol: p.symbol, coinType: p.coinType, apr: p.apr })),
            rewardReadStatus: mining.status
          },
          currentValueUSD: usd,
          liquidationThresholdFactor: normalizeLiquidationThresholdFactor(Number(own?.liqLTV ?? 0)) || void 0,
          startedAt: 0,
          daysActive: 0,
          events: [],
          protocol: "Current",
          venue: resolveCurrentVenueLabel(marketObjectId, listed, marketType),
          iconUrl: meta?.tokenInfo?.icon ?? null
        };
        const maxLtv = normalizeLiquidationThresholdFactor(Number(own?.maxLTV ?? 0));
        if (maxLtv > 0) maxLtvOf.set(supply, maxLtv);
        marketOf.set(supply, marketType);
        supplies.push(supply);
      }
      for (let i = 0; i < overview.borrows.length; i++) {
        const bor = overview.borrows[i];
        const mining = borrowMiningResults[i];
        const own = marketByToken(listed, bor.asset);
        const meta = own ?? marketByToken(priceRows, bor.asset);
        const rate = rates.get(typeKey(bor.asset));
        const marketIndex = rate?.borrowIndex ?? DECIMAL_SCALE;
        const stored = BigInt(bor.borrow_index.value);
        const debt = BigInt(bor.debt.value);
        const scaled = stored > 0n ? debt * marketIndex / stored : debt;
        const decimals = Number(meta?.tokenInfo?.decimals ?? 6);
        const amount = humanFromRaw(coinRaw(scaled), decimals);
        if (amount <= 0) continue;
        const price = Number(meta?.tokenInfo?.price ?? 0);
        const usd = amount * (Number.isFinite(price) ? price : 0);
        const borrowListApy = own?.borrowAPY;
        const chainBorrow = chainApr.get(typeKey(bor.asset))?.borrow;
        const borrowBaseKnown = typeof borrowListApy === "number" && Number.isFinite(borrowListApy) || typeof chainBorrow === "number" && Number.isFinite(chainBorrow);
        const baseApr = borrowBaseKnown ? Number(
          typeof borrowListApy === "number" && Number.isFinite(borrowListApy) ? borrowListApy : chainBorrow
        ) : Number.NaN;
        const bwRaw = Number(own?.borrowWeight ?? 1);
        const borrowWeight = Number.isFinite(bwRaw) && bwRaw > 0 ? bwRaw : 1;
        const rewardKnown = mining.status === "complete" || mining.status === "empty";
        const rewardApr = rewardKnown ? mining.apr ?? 0 : 0;
        const netCost = borrowBaseKnown ? baseApr - (rewardKnown ? rewardApr : 0) : rewardKnown ? -rewardApr : Number.NaN;
        const symbol = meta?.tokenInfo?.symbol ?? bor.asset.split("::").pop() ?? "?";
        const borrow = {
          id: `current-borrow-${ob.obligationObject}-${typeKey(bor.asset)}`,
          obligationId: ob.obligationObject,
          asset: symbol,
          coinType: with0x(bor.asset),
          borrowedAmount: amount,
          currentDebt: amount,
          accruedInterest: 0,
          accruedInterestUSD: 0,
          borrowAPR: netCost,
          borrowRewardAPR: rewardKnown ? rewardApr : void 0,
          netBorrowCost: netCost,
          aprBreakdown: {
            baseAPR: borrowBaseKnown ? baseApr : Number.NaN,
            rewardAPR: rewardKnown ? rewardApr : Number.NaN,
            rewards: mining.parts.filter((p) => p.apr != null).map((p) => ({ symbol: p.symbol, coinType: p.coinType, apr: p.apr })),
            rewardReadStatus: mining.status
          },
          currentDebtUSD: usd,
          collateral: [],
          healthFactor: 0,
          liquidationThreshold: 0,
          startedAt: 0,
          daysActive: 0,
          events: [],
          protocol: "Current",
          venue: resolveCurrentVenueLabel(marketObjectId, listed, marketType),
          iconUrl: meta?.tokenInfo?.icon ?? null
        };
        borrowWeightOf.set(borrow, borrowWeight);
        marketOf.set(borrow, marketType);
        borrows.push(borrow);
      }
      if (mined.status === "unavailable") {
        console.warn("[Current] claimable rewards unavailable", ob.obligationObject, mined.reason);
      } else {
        for (const row of mined.rows) {
          if (row.amount == null || row.valueUSD == null) continue;
          claimed.push({
            coinType: row.coinType,
            symbol: row.symbol,
            amount: row.amount,
            valueUSD: row.valueUSD
          });
        }
      }
    } catch (err) {
      skippedObligations += 1;
      console.warn("[Current] obligation skipped", ob.obligationObject, marketType, err);
    }
  }
  if (skippedObligations > 0) {
    throw new Error(
      `Current: ${skippedObligations} obligation(s) failed to load (borrows unavailable, not confirmed zero)`
    );
  }
  if (currentAdvisorTimingEnabled()) {
    logCurrentAdvisorStep("devInspect", devInspectMs);
    logCurrentAdvisorStep("mining", miningMs);
    logCurrentAdvisorStep("claimable-rewards", claimableMs);
  }
  const totalSuppliedUSD = supplies.reduce((s, x) => s + x.currentValueUSD, 0);
  const totalBorrowedUSD = borrows.reduce((s, x) => s + x.currentDebtUSD, 0);
  const marketKeys = /* @__PURE__ */ new Set();
  for (const s of supplies) {
    const m = marketOf.get(s);
    if (m) marketKeys.add(m);
  }
  for (const b of borrows) {
    const m = marketOf.get(b);
    if (m) marketKeys.add(m);
  }
  let healthFactor = null;
  for (const marketType of marketKeys) {
    const mSupplies = supplies.filter((s) => marketOf.get(s) === marketType);
    const mBorrows = borrows.filter((b) => marketOf.get(b) === marketType);
    const mRiskDebt = mBorrows.reduce(
      (s, x) => s + x.currentDebtUSD * (borrowWeightOf.get(x) ?? 1),
      0
    );
    const mLiq = mSupplies.reduce(
      (s, x) => s + x.currentValueUSD * (x.liquidationThresholdFactor ?? 0),
      0
    );
    const mSafe = mSupplies.reduce(
      (s, x) => s + x.currentValueUSD * (maxLtvOf.get(x) ?? 0),
      0
    );
    const mHf = mRiskDebt > 0 ? mLiq / mRiskDebt : null;
    for (const b of mBorrows) {
      const bw = borrowWeightOf.get(b) ?? 1;
      b.healthFactor = mHf ?? 0;
      b.liquidationThreshold = mLiq;
      b.safeBorrowLimit = bw > 0 ? mSafe / bw : mSafe;
      b.collateral = mSupplies.map((s) => ({
        asset: s.asset,
        amount: s.currentAmount,
        valueUSD: s.currentValueUSD,
        collateralWeight: s.liquidationThresholdFactor ?? 0,
        effectiveValueUSD: s.currentValueUSD * (s.liquidationThresholdFactor ?? 0)
      }));
    }
    if (mHf != null && mHf > 0) {
      healthFactor = healthFactor == null ? mHf : Math.min(healthFactor, mHf);
    }
    if (mRiskDebt > 0 && mSupplies.length > 0) {
      const priced = enrichSupplyLiquidationPrices(mSupplies, mRiskDebt);
      for (let i = 0; i < mSupplies.length; i++) {
        mSupplies[i].liquidationPriceUSD = priced[i].liquidationPriceUSD ?? null;
      }
    } else {
      for (const s of mSupplies) s.liquidationPriceUSD = null;
    }
  }
  const supplyYield = supplies.reduce((s, x) => s + x.currentValueUSD * x.supplyAPR, 0);
  const borrowCost = borrows.reduce((s, x) => s + x.currentDebtUSD * x.netBorrowCost, 0);
  const netValueUSD = totalSuppliedUSD - totalBorrowedUSD;
  const netAPR = totalSuppliedUSD > 0 ? (supplyYield - borrowCost) / totalSuppliedUSD : null;
  const rewardsToClaim = mergeClaimed(claimed);
  const unclaimedUSD = rewardsToClaim.reduce((s, r) => s + r.valueUSD, 0);
  let cashflowUsd = null;
  if (!options?.skipCashflow) {
    const loaded = await currentAdvisorTimed(
      "cashflow",
      () => loadCashflowTokens(walletAddress, marketTypes, allListed).catch(() => null)
    );
    if (loaded) {
      const listPrice = (coin) => {
        const p = Number(marketByToken(allListed, coin)?.tokenInfo?.price ?? 0);
        return Number.isFinite(p) && p > 0 ? p : 0;
      };
      const positionKey = (pos, coinType) => {
        const market = marketOf.get(pos) ?? "";
        return market ? flowKey(market, coinType) : "";
      };
      let supplyInterestUSD = 0;
      const seenSupply = /* @__PURE__ */ new Set();
      for (const s of supplies) {
        const key = positionKey(s, s.coinType);
        if (!key || loaded.historyFailed.has(typeKey(marketOf.get(s) ?? ""))) continue;
        seenSupply.add(key);
        const net = loaded.deposited.get(key) ?? 0;
        s.netDeposited = net;
        const px = s.currentAmount > 0 ? s.currentValueUSD / s.currentAmount : listPrice(s.coinType);
        supplyInterestUSD += (s.currentAmount - net) * px;
      }
      for (const [key, net] of loaded.deposited) {
        if (seenSupply.has(key)) continue;
        const coin = key.split("|")[1] ?? "";
        supplyInterestUSD += -net * listPrice(coin);
      }
      let borrowInterestUSD = 0;
      const seenBorrow = /* @__PURE__ */ new Set();
      for (const b of borrows) {
        const key = positionKey(b, b.coinType);
        if (!key || loaded.historyFailed.has(typeKey(marketOf.get(b) ?? ""))) continue;
        seenBorrow.add(key);
        const net = loaded.borrowed.get(key) ?? 0;
        b.netBorrowed = net;
        const px = b.currentDebt > 0 ? b.currentDebtUSD / b.currentDebt : listPrice(b.coinType);
        borrowInterestUSD += (b.currentDebt - net) * px;
      }
      for (const [key, net] of loaded.borrowed) {
        if (seenBorrow.has(key)) continue;
        const coin = key.split("|")[1] ?? "";
        borrowInterestUSD += -net * listPrice(coin);
      }
      cashflowUsd = {
        supplyInterestUSD,
        borrowInterestUSD,
        claimedRewardsUSD: loaded.claimedRewardsUSD,
        resultUSD: supplyInterestUSD - borrowInterestUSD + loaded.claimedRewardsUSD + unclaimedUSD,
        usedSpotPrice: loaded.usedSpotPrice
      };
    }
  }
  return {
    supplies,
    borrows,
    totalSuppliedUSD,
    totalBorrowedUSD,
    netValueUSD,
    healthFactor,
    netAPR,
    dailyEarningsUSD: totalSuppliedUSD > 0 ? (supplyYield - borrowCost) / 365 : null,
    rewardsToClaim,
    cashflowUsd,
    protocol: "Current"
  };
}
var EMPTY_CURRENT_SNAP = {
  supplies: [],
  borrows: [],
  totalSuppliedUSD: 0,
  totalBorrowedUSD: 0,
  netValueUSD: 0,
  healthFactor: null,
  rewardsToClaim: [],
  protocol: "Current"
};

// src/config/junkTokens.ts
var JUNK_COIN_TYPE_DENYLIST = /* @__PURE__ */ new Set([
  // Приклад: додай пакети/типи, які не хочеш бачити
]);

// src/services/verifiedTokenList.ts
import { normalizeSuiAddress as normalizeSuiAddress2 } from "@mysten/sui/utils";

// src/config/hardcodedVerifiedCoins.ts
var HARDCODED_VERIFIED = [
  {
    type: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
    symbol: "SUI",
    name: "Sui",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png",
    tags: ["native"]
  },
  {
    type: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    symbol: "USDC",
    name: "USD Coin (Native)",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
    tags: ["native", "stablecoin"]
  },
  {
    type: "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
    symbol: "USDC",
    name: "USD Coin (Wormhole)",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
    tags: ["bridge", "stablecoin"]
  },
  {
    type: "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/325/large/Tether.png",
    tags: ["bridge", "stablecoin"]
  },
  {
    type: "0x375f70cf2ae4c6a1be136734bae85e1db1f125af768cc55e9fd2b84418fe692c::usdt::USDT",
    symbol: "USDT",
    name: "Tether (legacy)",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/325/large/Tether.png",
    tags: ["bridge", "stablecoin"]
  },
  {
    type: "0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY",
    symbol: "USDY",
    name: "Ondo US Dollar Yield",
    decimals: 6,
    iconUrl: "https://coin-images.coingecko.com/coins/images/31050/large/usdy.png",
    tags: ["stablecoin"]
  },
  {
    type: "0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2ab8f6b9c8902f14df2ff2::ausd::AUSD",
    symbol: "AUSD",
    name: "Agora USD",
    decimals: 6,
    iconUrl: "",
    tags: ["stablecoin"]
  },
  {
    type: "0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI",
    symbol: "afSUI",
    name: "Aftermath Staked SUI",
    decimals: 9,
    iconUrl: "https://aftermath.finance/afsui-icon.png",
    tags: ["lst"]
  },
  {
    type: "0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI",
    symbol: "stSUI",
    name: "Spring Staked SUI",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/51233/large/Token_%281%29.png?1730446421",
    tags: ["lst"]
  },
  {
    type: "0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI",
    symbol: "stSUI",
    name: "AlphaFi Staked SUI",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/54211/large/b_r2Ps67_400x400.png",
    tags: ["lst"]
  },
  {
    type: "0x2b6602099970374cf58a2a1b9d96f005fccceb81e92eb059873baf420eb6c717::x_sui::X_SUI",
    symbol: "xSUI",
    name: "Momentum Staked SUI",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/54113/large/xsui.png",
    tags: ["lst"]
  },
  {
    type: "0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT",
    symbol: "vSUI",
    name: "Volo Staked SUI",
    decimals: 9,
    iconUrl: "",
    tags: ["lst"]
  },
  {
    type: "0x790f258062909e3a0ffc78b3c53ac2f62d7084c3bab95644bdeb05add7250001::super_sui::SUPER_SUI",
    symbol: "superSUI",
    name: "Mstable Super SUI",
    decimals: 9,
    iconUrl: "",
    tags: ["lst"]
  },
  {
    type: "0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::wbtc::WBTC",
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    iconUrl: "https://coin-images.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
    tags: ["bridge"]
  },
  {
    type: "0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 8,
    iconUrl: "https://coin-images.coingecko.com/coins/images/2518/large/weth.png",
    tags: ["bridge"]
  },
  {
    type: "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC",
    symbol: "LBTC",
    name: "Lombard Staked BTC",
    decimals: 8,
    iconUrl: "",
    tags: ["bridge"]
  },
  {
    type: "0x6864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS",
    symbol: "CETUS",
    name: "Cetus Protocol",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/29445/large/cetus.png",
    tags: ["defi"]
  },
  {
    type: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
    symbol: "DEEP",
    name: "DeepBook",
    decimals: 6,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x3a5143bb1196e3bcdfab6203d1683ae29edd26294fc8bfeafe4aaa9d2704df37::coin::COIN",
    symbol: "TURBOS",
    name: "Turbos Finance",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0xaafb102dd0902f5055cadecd687fb5b71c0ad4ac9f2e8823cc491cb2e1db89d9::buck::BUCK",
    symbol: "BUCK",
    name: "Bucket Protocol",
    decimals: 9,
    iconUrl: "",
    tags: ["stablecoin"]
  },
  {
    type: "0x5ca17430c1d046fae9edeaa8fd76c7b4193a00d764a0ecfa9418d733ad27bb20::sca::SCA",
    symbol: "SCA",
    name: "Scallop",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  /** Актуальний mainnet BLUE (CoinGecko / Bluefin liquidity). */
  {
    type: "0xe1b45a0e641b9955a20aa0ad1c1f4ad86aad8afb07296d4085e349a50e90bdca::blue::BLUE",
    symbol: "BLUE",
    name: "Bluefin",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/30883/large/BLUE_200x200.png?1733350278",
    tags: ["defi"]
  },
  /** Ранній/альтернативний BLUE — та сама іконка для OKX/metadata по старій адресі. */
  {
    type: "0xb848cce11ef3a8f62eccea6eb5b35a12c4c2b1ee1af7755d02d7bd6218e8226f::blue::BLUE",
    symbol: "BLUE",
    name: "Bluefin (legacy package)",
    decimals: 9,
    iconUrl: "https://coin-images.coingecko.com/coins/images/30883/large/BLUE_200x200.png?1733350278",
    tags: ["defi"]
  },
  {
    type: "0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS",
    symbol: "NS",
    name: "SuiNS",
    decimals: 6,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x88250f854c019ef4f88a5c073d52a18bb1c6ac437033f5932cd017d24917ab46::navi::NAVX",
    symbol: "NAVX",
    name: "Navi Protocol",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
    symbol: "WAL",
    name: "Walrus",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA",
    symbol: "IKA",
    name: "IKA",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  },
  {
    type: "0x87dfe1248a1dc4ce473bd9cb2937d66cdc6c30fee63f3fe0dbb55c7a09d35dec::up::UP",
    symbol: "UP",
    name: "Uni Protocol",
    decimals: 9,
    iconUrl: "",
    tags: ["defi"]
  }
];

// src/services/verifiedTokenList.ts
var DEFAULT_LIST_URLS = [
  "https://raw.githubusercontent.com/suiet/sui-coin-list/main/src/coins.json",
  "https://cdn.jsdelivr.net/gh/suiet/sui-coin-list@main/src/coins.json"
];
var BLOCKLIST_URL = "https://guardians.suiet.app/coin-list.json";
var LS_VERIFIED = "suiet_verified_coins";
var LS_BLOCK = "suiet_blocklist_coins";
var LS_TS = (k) => `${k}_at`;
var LEGACY_TTL = 24 * 60 * 60 * 1e3;
var CACHE_KEY = "sui_verified_tokens_v2";
var CACHE_TTL = 6 * 60 * 60 * 1e3;
var MIN_LIQ_USD = 1e4;
var AF_CHUNK = 28;
var GT_PAGES = 3;
function normalizeCoinType(coinType) {
  const t = coinType.trim();
  const parts = t.split("::");
  if (parts.length !== 3) return t;
  try {
    const addr = normalizeSuiAddress2(parts[0]);
    return `${addr}::${parts[1]}::${parts[2]}`;
  } catch {
    return t;
  }
}
function isVerified(coinType, verifiedList) {
  return verifiedList.has(normalizeCoinType(coinType));
}
function migrateOldCaches() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_VERIFIED);
    localStorage.removeItem(LS_TS(LS_VERIFIED));
  } catch {
  }
}
function readV2Cache() {
  if (typeof localStorage === "undefined") return { data: [], ok: false };
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { data: [], ok: false };
    const { data, timestamp } = JSON.parse(raw);
    if (!Array.isArray(data) || !timestamp) return { data: [], ok: false };
    if (Date.now() - timestamp > CACHE_TTL) return { data: [], ok: false };
    if (data.length < 10) return { data: [], ok: false };
    return { data, ok: true };
  } catch {
    return { data: [], ok: false };
  }
}
function writeV2Cache(coins) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: coins, timestamp: Date.now() })
    );
  } catch {
  }
}
function parseCoinArray(j) {
  if (Array.isArray(j)) return j;
  if (j && typeof j === "object" && "coins" in j) {
    const c = j.coins;
    if (Array.isArray(c)) return c;
  }
  return [];
}
function stripGeckoTokenId(id) {
  if (!id.startsWith("sui-network_")) return null;
  const ct = id.slice("sui-network_".length);
  return ct.includes("::") ? ct : null;
}
function mergeMap(base) {
  const m = /* @__PURE__ */ new Map();
  for (const c of base) {
    m.set(normalizeCoinType(c.type), c);
  }
  return m;
}
async function fetchGeckoPoolTokensForWhitelist() {
  const GT2 = "https://api.geckoterminal.com/api/v2";
  const out = /* @__PURE__ */ new Map();
  for (let page = 1; page <= GT_PAGES; page++) {
    try {
      const res = await fetch(
        `${GT2}/networks/${GECKO_NETWORK}/pools?page=${page}`,
        { headers: GT_HEADER }
      );
      if (!res.ok) continue;
      const j = await res.json();
      for (const pool of j.data ?? []) {
        const liq = parseFloat(pool.attributes?.reserve_in_usd ?? "0");
        if (!Number.isFinite(liq) || liq < MIN_LIQ_USD) continue;
        for (const rel of [pool.relationships?.base_token, pool.relationships?.quote_token]) {
          const id = rel?.data?.id;
          if (!id) continue;
          const ct = stripGeckoTokenId(id);
          if (!ct || !ct.includes("::")) continue;
          const key = normalizeCoinType(ct);
          if (out.has(key)) continue;
          const last = ct.split("::").pop() ?? "UNKNOWN";
          out.set(key, {
            type: ct,
            symbol: last,
            name: last,
            decimals: 9,
            iconUrl: "",
            tags: ["gecko-verified"]
          });
        }
      }
    } catch {
    }
  }
  return [...out.values()];
}
async function fetchAftermathWhitelisted(candidates) {
  const uniq = [...new Set(candidates.map((c) => normalizeCoinType(c)))];
  if (uniq.length === 0) return [];
  const out = [];
  for (let i = 0; i < uniq.length; i += AF_CHUNK) {
    const chunk = uniq.slice(i, i + AF_CHUNK);
    const rows = await fetchAftermathBatch(chunk);
    for (const ct of chunk) {
      const p = rows[ct]?.price;
      if (p != null && Number.isFinite(p) && p > 0) {
        const last = ct.split("::").pop() ?? ct;
        out.push({
          type: ct,
          symbol: last,
          name: last,
          decimals: 9,
          iconUrl: "",
          tags: ["aftermath-verified"]
        });
      }
    }
  }
  return out;
}
async function fetchSuietList() {
  const envUrl = import.meta.env.VITE_SUIET_COIN_LIST_URL;
  const URLS = envUrl ? [envUrl, ...DEFAULT_LIST_URLS] : [...DEFAULT_LIST_URLS];
  for (const url of URLS) {
    try {
      const ctrl = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(8e3) : void 0;
      const res = await fetch(url, { signal: ctrl });
      if (!res.ok) continue;
      const json = await res.json();
      const arr = Array.isArray(json) ? json : json.coins ?? parseCoinArray(json);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((c) => ({
          ...c,
          iconUrl: c.iconUrl ?? "",
          tags: c.tags ?? ["native"],
          decimals: c.decimals ?? 9
        }));
      }
    } catch {
    }
  }
  return [];
}
async function getVerifiedCoinList() {
  migrateOldCaches();
  const v2 = readV2Cache();
  if (v2.ok) {
    return mergeMap(v2.data);
  }
  const merged = mergeMap([...HARDCODED_VERIFIED]);
  const hardTypes = HARDCODED_VERIFIED.map((c) => c.type);
  const [gecko, suiet] = await Promise.all([fetchGeckoPoolTokensForWhitelist(), fetchSuietList()]);
  for (const c of gecko) {
    const k = normalizeCoinType(c.type);
    if (!merged.has(k)) merged.set(k, c);
  }
  const seeds = [.../* @__PURE__ */ new Set([...hardTypes, ...[...merged.values()].map((c) => c.type)])];
  const afCoins = await fetchAftermathWhitelisted(seeds);
  for (const c of afCoins) {
    const k = normalizeCoinType(c.type);
    if (!merged.has(k)) merged.set(k, c);
  }
  for (const c of suiet) {
    const k = normalizeCoinType(c.type);
    const ex = merged.get(k);
    if (ex) {
      merged.set(k, {
        ...ex,
        iconUrl: c.iconUrl || ex.iconUrl,
        name: c.name || ex.name,
        symbol: c.symbol || ex.symbol,
        tags: [.../* @__PURE__ */ new Set([...ex.tags, ...c.tags])]
      });
    } else {
      merged.set(k, c);
    }
  }
  const result = [...merged.values()];
  writeV2Cache(result);
  return merged;
}
async function getSuietBlocklist() {
  const readBlockCache = () => {
    if (typeof localStorage === "undefined") return { data: [], ok: false };
    try {
      const raw = localStorage.getItem(LS_BLOCK);
      const t = localStorage.getItem(LS_TS(LS_BLOCK));
      if (!raw || !t) return { data: [], ok: false };
      if (Date.now() - Number(t) > LEGACY_TTL) return { data: [], ok: false };
      const d = JSON.parse(raw);
      return { data: Array.isArray(d) ? d : [], ok: true };
    } catch {
      return { data: [], ok: false };
    }
  };
  const write2 = (bl) => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(LS_BLOCK, JSON.stringify(bl));
      localStorage.setItem(LS_TS(LS_BLOCK), String(Date.now()));
    } catch {
    }
  };
  const c = readBlockCache();
  if (c.ok && c.data.length) {
    return expandBlocklistSet(c.data);
  }
  try {
    const r = await fetch(BLOCKLIST_URL);
    if (r.ok) {
      const j = await r.json();
      const bl = j?.blocklist;
      if (Array.isArray(bl) && bl.length) {
        write2(bl);
        return expandBlocklistSet(bl);
      }
    }
  } catch {
  }
  return /* @__PURE__ */ new Set();
}
function expandBlocklistSet(entries) {
  const s = /* @__PURE__ */ new Set();
  for (const e of entries) {
    s.add(e);
    try {
      s.add(normalizeCoinType(e));
    } catch {
    }
  }
  return s;
}
function blocklistCovers(s, coinType) {
  if (s.has(coinType)) return true;
  return s.has(normalizeCoinType(coinType));
}

// src/services/tokenClassifier.ts
var NORM_PROTOCOL = new Set(
  [...PROTOCOL_TOKEN_VERIFIED].map((c) => normalizeCoinType(c))
);
var TRUSTED_SPOT_SOURCES = /* @__PURE__ */ new Set([
  "okx",
  "dexscreener",
  "aftermath",
  "geckoterminal",
  "dexpaprika",
  "coingecko"
]);
var MAX_SANE_WALLET_TOKEN_USD = 1e7;
function isSaneWalletValue(t) {
  const v = t.valueUSD;
  if (v == null || !Number.isFinite(v) || v <= 0) return true;
  return v <= MAX_SANE_WALLET_TOKEN_USD;
}
function hasTrustedSpotPrice(t) {
  if (!isSaneWalletValue(t)) return false;
  if (t.priceSource == null) return false;
  if (!TRUSTED_SPOT_SOURCES.has(t.priceSource)) return false;
  const p = t.priceUSD;
  return p != null && Number.isFinite(p) && p > 0;
}
var SPAM_PATTERNS = [
  /https?:\/\//i,
  /www\./i,
  /\.(?:com|io|xyz|net|org)\b/i,
  /\bclaim\b/i,
  /\bairdrop\b/i,
  /\bvisit\b/i,
  /free\s+\d/i,
  /t\.me\//i,
  /telegram\.me/i,
  /discord\.gg/i
];
function metadataFromBalance(t) {
  return {
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    iconUrl: t.iconUrl,
    description: t.description ?? ""
  };
}
function classifyTokenBalance(t, verifiedList, blocklist) {
  const coinType = t.coinType;
  const meta = metadataFromBalance(t);
  if (JUNK_COIN_TYPE_DENYLIST.has(coinType)) {
    return { coinType, status: "spam", metadata: meta, reason: "denylist" };
  }
  if (JUNK_COIN_TYPE_DENYLIST.has(normalizeCoinType(coinType))) {
    return { coinType, status: "spam", metadata: meta, reason: "denylist" };
  }
  if (blocklistCovers(blocklist, coinType)) {
    return { coinType, status: "spam", metadata: meta, reason: "suiet_blocklist" };
  }
  if (isVerified(coinType, verifiedList)) {
    return {
      coinType,
      status: "verified",
      suietData: verifiedList.get(normalizeCoinType(coinType)),
      metadata: meta
    };
  }
  if (NORM_PROTOCOL.has(normalizeCoinType(coinType)) || t.scallopDeposit || t.momentumLST) {
    return {
      coinType,
      status: "verified",
      metadata: meta,
      reason: t.scallopDeposit ? "scallop" : t.momentumLST ? "momentum_lst" : "protocol_whitelist"
    };
  }
  const textToCheck = `${meta.name} ${meta.description} ${meta.symbol}`;
  const spamMatch = SPAM_PATTERNS.find((p) => p.test(textToCheck));
  if (spamMatch) {
    return {
      coinType,
      status: "spam",
      metadata: meta,
      reason: `spam_pattern: ${spamMatch.source}`
    };
  }
  if (hasTrustedSpotPrice(t)) {
    return {
      coinType,
      status: "unverified",
      metadata: meta,
      reason: `trusted_oracle:${t.priceSource}`
    };
  }
  const spamSignals = [];
  if (!meta.iconUrl) spamSignals.push("no_icon");
  if (meta.symbol.length > 12) spamSignals.push("long_symbol");
  if (meta.name.length > 60) spamSignals.push("long_name");
  if (meta.description.length < 5 && !meta.iconUrl) spamSignals.push("empty_desc_no_icon");
  if (/^\d+$/.test(meta.symbol)) spamSignals.push("numeric_symbol");
  if (meta.symbol.length > 0 && meta.symbol !== meta.symbol.toUpperCase()) spamSignals.push("lowercase_symbol");
  if (spamSignals.length >= 2) {
    return {
      coinType,
      status: "spam",
      metadata: meta,
      reason: `signals: ${spamSignals.join(", ")}`
    };
  }
  return { coinType, status: "unverified", metadata: meta };
}
function sortClassifiedTokenBalances(tokens) {
  const mainVerified = [];
  const otherUnverifiedPriced = [];
  const hidden = [];
  const byValue = (a, b) => (b.valueUSD ?? 0) - (a.valueUSD ?? 0) || b.humanBalance - a.humanBalance;
  for (const t of tokens) {
    const c = t.classification;
    if (c.status === "spam") {
      hidden.push(t);
      continue;
    }
    const hasPrice = t.priceUSD != null && Number.isFinite(t.priceUSD) && isSaneWalletValue(t);
    if (!hasPrice) {
      if (c.status === "verified") {
        mainVerified.push(t);
      } else {
        hidden.push(t);
      }
      continue;
    }
    const v = t.valueUSD ?? 0;
    if (c.status === "verified") {
      mainVerified.push(t);
    } else {
      if (v < MIN_UNVERIFIED_VALUE_USD) hidden.push(t);
      else otherUnverifiedPriced.push(t);
    }
  }
  mainVerified.sort(byValue);
  otherUnverifiedPriced.sort(byValue);
  hidden.sort(byValue);
  return {
    mainVerified,
    otherUnverifiedPriced,
    hidden
  };
}
async function classifyAllBalances(tokenBalances) {
  if (tokenBalances.length === 0) {
    return { mainVerified: [], otherUnverifiedPriced: [], hidden: [] };
  }
  const [verifiedList, blocklist] = await Promise.all([
    getVerifiedCoinList(),
    getSuietBlocklist()
  ]);
  const nonZero = tokenBalances.filter((b) => b.humanBalance > 0);
  const withClass = nonZero.map((t) => ({
    ...t,
    classification: classifyTokenBalance(t, verifiedList, blocklist)
  }));
  return sortClassifiedTokenBalances(withClass);
}
function sumVisibleWalletUSD(bucket) {
  const add = (arr) => arr.reduce((s, t) => s + (t.valueUSD ?? 0), 0);
  return add(bucket.mainVerified) + add(bucket.otherUnverifiedPriced);
}

// src/utils/bluefinUnclaimedUi.ts
function isBluefinUnclaimedUnavailable(p) {
  return p.protocol === "bluefin" && p.bluefinUnclaimed?.source === "unavailable";
}

// src/utils/positionDerivedMetrics.ts
function unclaimedIncomeMetric(p) {
  if (p.protocol === "bluefin" && isBluefinUnclaimedUnavailable(p)) {
    return { usd: null, complete: false };
  }
  const uF = Number.isFinite(p.unclaimedFeeUSD) ? Math.max(0, p.unclaimedFeeUSD) : null;
  const uR = Number.isFinite(p.unclaimedRewardUSD) ? Math.max(0, p.unclaimedRewardUSD) : null;
  if (uF == null && uR == null) return { usd: null, complete: false };
  if (uF == null || uR == null) {
    return { usd: (uF ?? 0) + (uR ?? 0), complete: false };
  }
  return { usd: uF + uR, complete: true };
}
function liquidityUsdOrNull(p) {
  return Number.isFinite(p.currentValueUSD) ? p.currentValueUSD : null;
}
function positionValueUsdOrNull(p) {
  const liq = liquidityUsdOrNull(p);
  if (liq == null) return null;
  const u = unclaimedIncomeMetric(p);
  if (!u.complete || u.usd == null) return null;
  return liq + u.usd;
}

// src/utils/currentMultiplyVault.ts
function isCurrentMultiplyVaultPosition(p) {
  if (p?.currentMultiply?.kind === "current_multiply") return true;
  return p?.cetusVault?.provider === "Current" && p.cetusVault?.feeLabel === "Multiply";
}
function parseRawIntegerAmount(v) {
  if (v == null) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || !Number.isInteger(v) || !Number.isSafeInteger(v)) return null;
    return BigInt(v);
  }
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}
function humanFromRawBigint(raw, decimals) {
  const scale = 10 ** decimals;
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const whole = v / BigInt(Math.trunc(scale));
  const frac = v % BigInt(Math.trunc(scale));
  const n2 = Number(whole) + Number(frac) / scale;
  return neg ? -n2 : n2;
}
function multiplyEquityUsd(collateralUsd, debtUsd) {
  if (collateralUsd == null || debtUsd == null) return null;
  if (!Number.isFinite(collateralUsd) || !Number.isFinite(debtUsd)) return null;
  return collateralUsd - debtUsd;
}
function multiplyMultiplier(collateralUsd, equityUsd) {
  if (collateralUsd == null || equityUsd == null) return null;
  if (!(equityUsd > 0) || !(collateralUsd > 0)) return null;
  if (!Number.isFinite(collateralUsd) || !Number.isFinite(equityUsd)) return null;
  return collateralUsd / equityUsd;
}
function multiplyCurrentLtv(debtUsd, collateralUsd) {
  if (debtUsd == null || collateralUsd == null) return null;
  if (!(collateralUsd > 0) || !Number.isFinite(debtUsd) || !Number.isFinite(collateralUsd)) return null;
  return debtUsd / collateralUsd;
}
function multiplyNetAprBreakdown(input) {
  const {
    collateralUsd,
    debtUsd,
    equityUsd,
    baseSupplyApr,
    baseBorrowApr,
    depositIncentiveApr,
    borrowIncentiveApr,
    ratesSource
  } = input;
  const supplyAnnualUsd = collateralUsd != null && baseSupplyApr != null && Number.isFinite(collateralUsd) && Number.isFinite(baseSupplyApr) ? collateralUsd * baseSupplyApr : null;
  const borrowCostAnnualUsd = debtUsd != null && baseBorrowApr != null && Number.isFinite(debtUsd) && Number.isFinite(baseBorrowApr) ? debtUsd * baseBorrowApr : null;
  const reasons = [];
  if (baseSupplyApr == null || baseBorrowApr == null || ratesSource !== "multiply_list") {
    reasons.push("base rates unavailable");
  }
  if (supplyAnnualUsd == null || borrowCostAnnualUsd == null) reasons.push("base annual unavailable");
  if (depositIncentiveApr == null) reasons.push("deposit incentive unavailable");
  if (borrowIncentiveApr == null) reasons.push("borrow incentive unavailable");
  if (equityUsd == null || !(equityUsd > 0)) reasons.push("equity unavailable");
  const depositIncentiveAnnualUsd = depositIncentiveApr != null && collateralUsd != null && Number.isFinite(collateralUsd) && Number.isFinite(depositIncentiveApr) ? collateralUsd * depositIncentiveApr : null;
  const borrowIncentiveAnnualUsd = borrowIncentiveApr != null && debtUsd != null && Number.isFinite(debtUsd) && Number.isFinite(borrowIncentiveApr) ? debtUsd * borrowIncentiveApr : null;
  const baseAnnualUsd = supplyAnnualUsd != null && borrowCostAnnualUsd != null ? supplyAnnualUsd - borrowCostAnnualUsd : null;
  const aprOnEquity = (annual) => annual != null && equityUsd != null && equityUsd > 0 && Number.isFinite(annual) ? annual / equityUsd * 100 : null;
  const baseNetAprPct = aprOnEquity(baseAnnualUsd);
  const knownIncentiveAnnualUsd = depositIncentiveAnnualUsd == null && borrowIncentiveAnnualUsd == null ? null : (depositIncentiveAnnualUsd ?? 0) + (borrowIncentiveAnnualUsd ?? 0);
  const incentivesComplete = depositIncentiveApr != null && borrowIncentiveApr != null;
  let coverage = "unavailable";
  if (baseAnnualUsd != null && incentivesComplete && equityUsd != null && equityUsd > 0) coverage = "complete";
  else if (baseAnnualUsd != null || depositIncentiveAnnualUsd != null || borrowIncentiveAnnualUsd != null) {
    coverage = "partial";
  }
  const netAnnualUsd = coverage === "complete" && baseAnnualUsd != null ? baseAnnualUsd + (depositIncentiveAnnualUsd ?? 0) + (borrowIncentiveAnnualUsd ?? 0) : null;
  const netAprPct = aprOnEquity(netAnnualUsd);
  let partialAnnualUsd = null;
  if (coverage === "partial" && baseAnnualUsd != null) {
    partialAnnualUsd = baseAnnualUsd;
    if (depositIncentiveAnnualUsd != null) partialAnnualUsd += depositIncentiveAnnualUsd;
    if (borrowIncentiveAnnualUsd != null) partialAnnualUsd += borrowIncentiveAnnualUsd;
  }
  const partialAprPct = coverage === "partial" ? aprOnEquity(partialAnnualUsd) : null;
  return {
    baseSupplyApr,
    baseBorrowApr,
    depositIncentiveApr,
    borrowIncentiveApr,
    supplyAnnualUsd,
    borrowCostAnnualUsd,
    baseAnnualUsd,
    baseNetAprPct,
    depositIncentiveAnnualUsd,
    borrowIncentiveAnnualUsd,
    knownIncentiveAnnualUsd,
    netAnnualUsd,
    netAprPct,
    partialAnnualUsd,
    partialAprPct,
    coverage,
    reasons: coverage === "complete" ? [] : reasons,
    incentivesIncluded: coverage === "complete",
    ratesSource
  };
}
function multiplyRiskFromSpot(input) {
  const currentLtv = multiplyCurrentLtv(input.debtUsd, input.collateralUsd);
  const liqRaw = input.liquidationLtv;
  const liq = liqRaw != null && Number.isFinite(liqRaw) && liqRaw > 0 && liqRaw <= 1 ? liqRaw : null;
  const maxLtv = input.maxLtv != null && Number.isFinite(input.maxLtv) && input.maxLtv > 0 && input.maxLtv <= 1 ? input.maxLtv : null;
  const bufferPctPoints = currentLtv != null && liq != null ? (liq - currentLtv) * 100 : null;
  let liquidationPriceCollateralUsd = null;
  let liquidationRatioDebtPerCollateral = null;
  let source = "unavailable";
  if (liq != null && liq > 0 && input.collateralAmount != null && input.collateralAmount > 0 && input.debtUsd != null && Number.isFinite(input.debtUsd) && input.debtAmount != null && Number.isFinite(input.debtAmount)) {
    liquidationPriceCollateralUsd = input.debtUsd / (input.collateralAmount * liq);
    liquidationRatioDebtPerCollateral = input.debtAmount / (input.collateralAmount * liq);
    source = "estimated_from_liq_ltv";
  }
  return {
    currentLtv,
    liquidationLtv: liq,
    maxLtv,
    bufferPctPoints,
    liquidationPriceCollateralUsd,
    liquidationRatioDebtPerCollateral,
    orientation: "collateral_usd_at_liq",
    source,
    valuationBasis: "spot_usd",
    protocolRisk: null
  };
}
function mergeMultiplyCompleteness(flags) {
  const set = new Set(flags.filter(Boolean));
  if (set.size === 0) return "complete";
  if (set.has("partial_missing_prices")) return "partial_missing_prices";
  if (set.has("partial_missing_decimals")) return "partial_missing_decimals";
  if (set.has("partial_api_fallback")) return "partial_api_fallback";
  if (set.has("partial_missing_rates")) return "partial_missing_rates";
  if (set.has("partial_missing_rewards")) return "partial_missing_rewards";
  if (set.has("partial")) return "partial";
  return "complete";
}
function currentMultiplyAppUrl(opts) {
  const market = (opts.fromMarket || "MainMarket").replace(/\s+/g, "");
  const strip = (t) => t.replace(/^0x/i, "");
  return `https://app.current.finance/multiply/${encodeURIComponent(market)}/${strip(opts.collateralCoinType)}/${strip(opts.debtCoinType)}`;
}
function multiplyPortfolioContribution(p) {
  const m = p.currentMultiply;
  if (!m) {
    return { usd: null, partial: true };
  }
  const equity = m.equityUsd;
  if (equity == null || !Number.isFinite(equity)) return { usd: null, partial: true };
  const rewards = m.claimableRewardsUsd;
  if (rewards != null && Number.isFinite(rewards)) return { usd: equity + rewards, partial: false };
  if (m.rewardsStatus === "empty") return { usd: equity, partial: false };
  return { usd: equity, partial: true };
}

// src/utils/finiteUsd.ts
function finiteUsd(n2) {
  if (n2 == null || !Number.isFinite(n2)) return 0;
  return n2;
}

// src/services/portfolioSnapshotIdb.ts
function makeSnapshotId(walletAddr, hourBucket) {
  return `${walletAddr}|${hourBucket}`;
}
var BUCKET_MS = 15 * 60 * 1e3;
function currentHourBucket(nowMs = Date.now()) {
  return Math.floor(nowMs / BUCKET_MS) * BUCKET_MS;
}

// src/services/serverSuiClient.ts
function createServerSuiClient() {
  return getPortfolioReadSuiClient();
}

// src/services/momentumService.ts
import { MmtSDK, TickMath as TickMath2, Utils as Utils2 } from "@mmt-finance/clmm-sdk";

// src/services/momentumPositionsRpcFallback.ts
import { TickMath, Utils } from "@mmt-finance/clmm-sdk";
import { convertI32ToSigned } from "@mmt-finance/clmm-sdk/dist/utils/math/tickMath";
import BN from "bn.js";
import { normalizeStructTag, normalizeSuiAddress as normalizeSuiAddress4 } from "@mysten/sui/utils";

// src/services/momentumOwnedParse.ts
import { normalizeSuiAddress as normalizeSuiAddress3 } from "@mysten/sui/utils";
function readSuiHexIdFromMoveValue(v) {
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("0x")) return t;
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v;
  if (typeof o.id === "string" && o.id.startsWith("0x")) return o.id.trim();
  const f = o.fields;
  if (f && typeof f === "object") {
    const id = f.id;
    if (typeof id === "string" && id.startsWith("0x")) return id.trim();
  }
  return null;
}
function ownedObjectDataMoveType(data) {
  const d = data;
  if (!d) return "";
  if (typeof d.type === "string" && d.type.length > 0) return d.type.trim();
  const c = d.content;
  if (c && typeof c === "object" && c.dataType === "moveObject") {
    const t = c.type;
    if (typeof t === "string" && t.length > 0) return t.trim();
  }
  return "";
}
function readMomentumPoolIdFromMoveFields(fields) {
  for (const key of ["pool_id", "poolId"]) {
    const got = readSuiHexIdFromMoveValue(fields[key]);
    if (got) return got;
  }
  return null;
}
function readMomentumPositionNftObjectId(opts) {
  const trimmed = opts.rpcObjectId?.trim();
  if (trimmed) {
    try {
      return normalizeSuiAddress3(trimmed);
    } catch {
      return trimmed;
    }
  }
  const inner = readSuiHexIdFromMoveValue(opts.fields.id);
  if (!inner) return null;
  try {
    return normalizeSuiAddress3(inner);
  } catch {
    return inner;
  }
}
function ensureUidFieldForSdk(idField, fallbackObjectId) {
  const inner = readSuiHexIdFromMoveValue(idField);
  const raw = inner?.trim() || fallbackObjectId.trim();
  if (!raw.startsWith("0x")) {
    try {
      return { id: normalizeSuiAddress3(fallbackObjectId.trim()) };
    } catch {
      return { id: fallbackObjectId.trim() };
    }
  }
  try {
    return { id: normalizeSuiAddress3(raw) };
  } catch {
    return { id: raw };
  }
}
function fieldsForMomentumSdkFetchRewards(fields, rpcObjectId) {
  const poolStr = readMomentumPoolIdFromMoveFields(fields);
  const idShape = ensureUidFieldForSdk(fields.id, rpcObjectId);
  return {
    ...fields,
    id: idShape,
    ...poolStr ? { pool_id: poolStr } : {}
  };
}

// src/services/momentumPositionsRpcFallback.ts
var POSITION_STRUCTS = [
  `${PROTOCOL_PACKAGES.MOMENTUM_CLMM}::position::Position`,
  `${MOMENTUM_PUBLISHED_AT}::position::Position`
];
var POSITION_MOVE_TYPE_SUFFIX = "::position::Position";
var PKG_OWNED_MAX_PAGES = 40;
function defaultMomentumOwnedRpc() {
  return suiClient;
}
function uniqueMomentumPackagesForOwnedFallback() {
  const pkgs = [PROTOCOL_PACKAGES.MOMENTUM_CLMM, MOMENTUM_PUBLISHED_AT];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const p of pkgs) {
    const t = typeof p === "string" ? p.trim() : "";
    if (!t.length || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
function ownedRowIsMomentumPosition(row) {
  const typ = ownedObjectDataMoveType(row.data);
  return Boolean(typ.endsWith(POSITION_MOVE_TYPE_SUFFIX));
}
async function fetchMomentumOwnedPositionBodiesForRewards(walletAddress, rpc = defaultMomentumOwnedRpc()) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const structType of POSITION_STRUCTS) {
    let cursor;
    for (; ; ) {
      const page = await rpc.getOwnedObjects({
        owner: walletAddress,
        filter: { StructType: structType },
        options: { showContent: true, showType: true, showOwner: true },
        cursor
      });
      for (const row of page.data) {
        const oid = row.data?.objectId;
        const content = row.data?.content;
        if (!oid || content?.dataType !== "moveObject" || !content.fields) continue;
        let k;
        try {
          k = normalizeSuiAddress4(oid);
        } catch {
          k = oid;
        }
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ objectId: k, fields: content.fields });
      }
      if (!page.hasNextPage) break;
      cursor = page.nextCursor ?? null;
      if (cursor == null) break;
    }
  }
  if (!out.length) {
    await appendBodiesFromMomentumPackagePages(walletAddress, out, seen, rpc);
  }
  return out;
}
function momentumPoolLookupKey(poolIdRaw) {
  try {
    return normalizeSuiAddress4(poolIdRaw.trim());
  } catch {
    return poolIdRaw.trim();
  }
}
async function hydrateMomentumPoolsByApiId(sdk2, basePools, poolIdHints) {
  const out = /* @__PURE__ */ new Map();
  for (const p of basePools) {
    out.set(momentumPoolLookupKey(String(p.poolId)), p);
  }
  const uniq = [...new Set(poolIdHints.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(
    uniq.map(async (raw) => {
      const nk = momentumPoolLookupKey(raw);
      if (out.has(nk)) return;
      let added;
      try {
        added = await sdk2.Pool.getPool(raw, void 0, false);
      } catch {
        try {
          added = await sdk2.Pool.getPool(nk, void 0, false);
        } catch {
        }
      }
      if (added) {
        out.set(momentumPoolLookupKey(String(added.poolId)), added);
      }
    })
  );
  return out;
}
async function appendBodiesFromMomentumPackagePages(walletAddress, out, seen, rpc) {
  const pkgs = uniqueMomentumPackagesForOwnedFallback();
  const objectOpts = {
    showContent: true,
    showType: true,
    showOwner: true
  };
  for (const pkg of pkgs) {
    let cursor;
    try {
      for (let page = 0; page < PKG_OWNED_MAX_PAGES; page++) {
        const res = await rpc.getOwnedObjects({
          owner: walletAddress,
          filter: { Package: pkg },
          options: objectOpts,
          cursor
        });
        for (const row of res.data) {
          if (!ownedRowIsMomentumPosition(row)) continue;
          const oid = row.data?.objectId;
          const content = row.data?.content;
          if (!oid || !content || content.dataType !== "moveObject" || !content.fields) continue;
          let k;
          try {
            k = normalizeSuiAddress4(oid);
          } catch {
            k = oid;
          }
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ objectId: k, fields: content.fields });
        }
        if (!res.hasNextPage) break;
        cursor = res.nextCursor ?? null;
        if (cursor == null) break;
      }
    } catch {
    }
  }
}
function rewardEntryForPosition(map, rawId) {
  try {
    const n2 = normalizeSuiAddress4(rawId);
    return map[rawId] ?? map[n2];
  } catch {
    return map[rawId];
  }
}
function positionRangeStatusLabel(pool, lowerTickSqrtPrice, upperTickSqrtPrice) {
  const cur = Number(pool.currentSqrtPrice);
  const low = Number(lowerTickSqrtPrice.toString());
  const high = Number(upperTickSqrtPrice.toString());
  if (cur < low) return "Above Range";
  if (cur <= high && cur >= low) return "In Range";
  return "Below Range";
}
async function momentumUserRowsFromOwnedRpc(walletAddress, sdk2, poolsData, tokensData) {
  const bodies = await fetchMomentumOwnedPositionBodiesForRewards(walletAddress, sdk2.rpcClient);
  if (!bodies.length) return [];
  const poolHintsFromBodies = [];
  for (const b of bodies) {
    const hint = readMomentumPoolIdFromMoveFields(b.fields);
    if (hint) poolHintsFromBodies.push(hint);
  }
  const poolsByNormLookup = await hydrateMomentumPoolsByApiId(sdk2, poolsData, poolHintsFromBodies);
  const poolsForRewards = [...poolsByNormLookup.values()];
  let positionRewardsInfo = {};
  try {
    const forSdk = bodies.map((b) => ({
      fields: fieldsForMomentumSdkFetchRewards(b.fields, b.objectId)
    }));
    positionRewardsInfo = await sdk2.Position.fetchRewards(
      forSdk,
      poolsForRewards,
      walletAddress,
      sdk2.rpcClient
    );
  } catch {
    positionRewardsInfo = {};
  }
  const tokenPriceMap = new Map(tokensData.map((token) => [token.coinType, Number(token.price)]));
  const out = [];
  for (const body of bodies) {
    const positionData = body.fields;
    const objectId = readMomentumPositionNftObjectId({ rpcObjectId: body.objectId, fields: positionData });
    const poolIdRaw = readMomentumPoolIdFromMoveFields(positionData);
    if (!objectId || !poolIdRaw) continue;
    let poolIdNorm;
    try {
      poolIdNorm = normalizeSuiAddress4(poolIdRaw);
    } catch {
      poolIdNorm = poolIdRaw;
    }
    const pool = poolsByNormLookup.get(poolIdNorm);
    if (!pool) continue;
    const liquidity = new BN(String(positionData.liquidity ?? 0), 10);
    const tickUp = positionData.tick_upper_index;
    const tickLo = positionData.tick_lower_index;
    const upperBits = Number(tickUp?.fields?.bits ?? 0);
    const lowerBits = Number(tickLo?.fields?.bits ?? 0);
    const upperTick = convertI32ToSigned(upperBits);
    const lowerTick = convertI32ToSigned(lowerBits);
    const upperTickSqrtPrice = TickMath.tickIndexToSqrtPriceX64(upperTick);
    const lowerTickSqrtPrice = TickMath.tickIndexToSqrtPriceX64(lowerTick);
    const { coinA, coinB } = Utils.getCoinAmountFromLiquidity(
      liquidity,
      new BN(pool.currentSqrtPrice.toString()),
      lowerTickSqrtPrice,
      upperTickSqrtPrice,
      false
    );
    const calculateUsdValue = (amount, coinLeg) => {
      const dec = pool[coinLeg].decimals ?? 0;
      const ct = pool[coinLeg].coinType;
      const px = tokenPriceMap.get(ct) ?? 0;
      return amount / 10 ** dec * px;
    };
    const totalUsdValue = calculateUsdValue(Number(coinA), "tokenX") + calculateUsdValue(Number(coinB), "tokenY");
    const rewardsData = rewardEntryForPosition(
      positionRewardsInfo,
      objectId
    );
    const feeUsdValue = rewardsData ? calculateUsdValue(rewardsData.feeCollected.amountX, "tokenX") + calculateUsdValue(rewardsData.feeCollected.amountY, "tokenY") : 0;
    let rewardsUsdValue = 0;
    if (rewardsData?.rewards?.length) {
      for (const reward of rewardsData.rewards) {
        let coinType = reward.coinType.includes("0x2::sui::SUI") ? "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI" : reward.coinType;
        try {
          coinType = normalizeStructTag(coinType);
        } catch {
        }
        const token = tokensData.find((t) => {
          try {
            return normalizeStructTag(t.coinType) === coinType;
          } catch {
            return t.coinType === coinType;
          }
        });
        const dec = token?.decimals ?? 0;
        rewardsUsdValue += reward.amount / 10 ** dec * (tokenPriceMap.get(token?.coinType ?? coinType) ?? 0);
      }
    }
    out.push({
      objectId,
      poolId: pool.poolId,
      upperTick,
      lowerTick,
      liquidity,
      amount: totalUsdValue,
      status: positionRangeStatusLabel(pool, lowerTickSqrtPrice, upperTickSqrtPrice),
      claimableRewards: rewardsUsdValue + feeUsdValue,
      rewarders: rewardsData ? rewardsData.rewards : [],
      feeAmountXUsd: rewardsData ? calculateUsdValue(rewardsData.feeCollected.amountX, "tokenX") : 0,
      feeAmountYUsd: rewardsData ? calculateUsdValue(rewardsData.feeCollected.amountY, "tokenY") : 0,
      feeAmountX: rewardsData ? rewardsData.feeCollected.amountX : 0,
      feeAmountY: rewardsData ? rewardsData.feeCollected.amountY : 0
    });
  }
  return out;
}

// src/services/momentumPoolFee.ts
function momentumPoolFeeFraction(lpFeesPercent) {
  const s = lpFeesPercent.trim();
  const n2 = parseFloat(s);
  if (!Number.isFinite(n2) || n2 <= 0) return 0;
  if (n2 > 1) return n2 / 1e6;
  if (n2 === 1) return 0.01;
  if (n2 <= 1e-3) return n2;
  const sNorm = s.includes(".") ? s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : s;
  const fracPart = sNorm.includes(".") ? sNorm.split(".")[1] ?? "" : "";
  const fracLen = fracPart.length;
  const looksLikeHundredthsPercent = sNorm.includes(".") && /^\d*\.\d{1,2}$/.test(sNorm) && n2 < 1;
  const threeFracDigitsAsPercentPts = sNorm.includes(".") && fracLen === 3 && n2 >= 0.01 && n2 < 1;
  if (looksLikeHundredthsPercent || threeFracDigitsAsPercentPts) return n2 / 100;
  return n2;
}

// src/services/momentumService.ts
import { normalizeStructTag as normalizeStructTag2, normalizeSuiAddress as normalizeSuiAddress5 } from "@mysten/sui/utils";
import Decimal3 from "decimal.js";
import BN2 from "bn.js";
function mmtSdkMainnet() {
  try {
    return MmtSDK.NEW({
      network: "mainnet",
      suiClientUrl: getRpcUrl(),
      client: suiClient
    });
  } catch (e) {
    console.warn("MmtSDK.NEW failed \u2014 Momentum open positions unavailable", e);
    return null;
  }
}
var MAX_SANE_POSITION_USD = 5e7;
var _poolsCache = null;
var _tokensCache = null;
var POOLS_CACHE_TTL_MS = 15 * 6e4;
async function getCachedAllPools(sdk2) {
  if (_poolsCache && Date.now() - _poolsCache.at < POOLS_CACHE_TTL_MS) return _poolsCache.data;
  const data = await sdk2.Pool.getAllPools();
  _poolsCache = { data, at: Date.now() };
  return data;
}
async function getCachedAllTokens(sdk2) {
  if (_tokensCache && Date.now() - _tokensCache.at < POOLS_CACHE_TTL_MS) return _tokensCache.data;
  const data = await sdk2.Pool.getAllTokens();
  _tokensCache = { data, at: Date.now() };
  return data;
}
var MAX_SANE_HUMAN_TOKENS = 1e18;
function i32ToSigned(n2) {
  if (n2 > 2147483647) return n2 - 4294967296;
  return n2;
}
function symbolFromCoinType(coinType) {
  const parts = coinType.split("::");
  return parts[2] ?? (parts[1] ?? "\u2014");
}
function safeHumanFromBnRaw(rawBn, decimals) {
  try {
    const raw = rawBn.toString(10);
    if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
    const d = new Decimal3(raw).div(new Decimal3(10).pow(decimals));
    const n2 = d.toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function safeHumanFromNumberRaw(rawNum, decimals) {
  if (!Number.isFinite(rawNum) || rawNum <= 0) return 0;
  try {
    return safeHumanFromBnRaw(new BN2(Math.floor(rawNum).toString(10), 10), decimals);
  } catch {
    return 0;
  }
}
function normRewardCoinType(ct) {
  const t = ct.trim();
  if (!t) return t;
  if (t.includes("0x2::sui::SUI") || t.includes("0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"))
    return normalizeStructTag2(
      "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"
    );
  try {
    return normalizeStructTag2(t);
  } catch {
    return t;
  }
}
function poolTickCurrent(pool) {
  const idx = typeof pool.currentTickIndex === "string" ? parseInt(pool.currentTickIndex, 10) : 0;
  return i32ToSigned(Number.isFinite(idx) ? idx : 0);
}
function momentumStatusToRange(statusLabel) {
  const s = statusLabel.trim().toLowerCase();
  return s === "in range" ? "in_range" : "out_of_range";
}
function clampUsd(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v <= MAX_SANE_POSITION_USD ? v : 0;
}
function normTypeSafe(raw) {
  try {
    return normalizeStructTag2(raw.trim());
  } catch {
    return null;
  }
}
function findMomentumPoolByApiId(pools, poolIdLookup) {
  const raw = poolIdLookup.trim();
  let keyNorm;
  try {
    keyNorm = normalizeSuiAddress5(raw);
  } catch {
    keyNorm = raw;
  }
  return pools.find((p) => {
    try {
      return normalizeSuiAddress5(String(p.poolId).trim()) === keyNorm;
    } catch {
      return String(p.poolId).trim() === raw;
    }
  });
}
function normalizedMomentumPositionKey(objectId) {
  try {
    return normalizeSuiAddress5(objectId.trim());
  } catch {
    return objectId.trim();
  }
}
async function getMomentumPositions(walletAddress, options) {
  const sdk2 = mmtSdkMainnet();
  if (!sdk2) {
    return [];
  }
  let poolsData;
  let tokensData;
  try {
    ;
    [poolsData, tokensData] = await Promise.all([
      getCachedAllPools(sdk2),
      getCachedAllTokens(sdk2)
    ]);
  } catch (e) {
    console.warn("Momentum Pool.getAllPools/getAllTokens failed", e);
    return [];
  }
  let fromSdk = [];
  try {
    fromSdk = await sdk2.Position.getAllUserPositions(
      walletAddress,
      poolsData,
      tokensData
    );
  } catch (e) {
    console.warn("Momentum getAllUserPositions failed", e);
    fromSdk = [];
  }
  let fromRpc = [];
  try {
    fromRpc = await momentumUserRowsFromOwnedRpc(walletAddress, sdk2, poolsData, tokensData);
  } catch (e2) {
    console.warn("Momentum RPC fallback (owned objects) failed", e2);
  }
  const mergedById = /* @__PURE__ */ new Map();
  for (const r of fromSdk) {
    if (r?.objectId) mergedById.set(normalizedMomentumPositionKey(String(r.objectId)), r);
  }
  for (const r of fromRpc) {
    if (!r?.objectId) continue;
    const k = normalizedMomentumPositionKey(String(r.objectId));
    if (!mergedById.has(k)) mergedById.set(k, r);
  }
  const rawRows = [...mergedById.values()];
  if (!rawRows.length) return [];
  const poolIdsHint = [...new Set(rawRows.map((r) => String(r.poolId).trim()))];
  let poolsHydrated = poolsData;
  try {
    const byNorm = await hydrateMomentumPoolsByApiId(sdk2, poolsData, poolIdsHint);
    poolsHydrated = [...byNorm.values()];
  } catch {
    poolsHydrated = poolsData;
  }
  const spotOpts = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  const openedAt = Math.floor(Date.now() / 1e3);
  const allSpotTypes = /* @__PURE__ */ new Set();
  for (const row of rawRows) {
    const pool = findMomentumPoolByApiId(poolsHydrated, row.poolId);
    if (!pool) continue;
    const xt = normTypeSafe(pool.tokenX?.coinType ?? pool.tokenXType ?? "");
    const yt = normTypeSafe(pool.tokenY?.coinType ?? pool.tokenYType ?? "");
    if (!xt || !yt) continue;
    allSpotTypes.add(xt);
    allSpotTypes.add(yt);
    for (const r of row.rewarders ?? []) {
      if (typeof r.coinType === "string" && r.coinType.trim()) {
        const n2 = normRewardCoinType(r.coinType.trim());
        const nn = normTypeSafe(n2);
        if (nn) allSpotTypes.add(nn);
      }
    }
  }
  let spotsMap;
  try {
    spotsMap = await resolveSpots(
      [...allSpotTypes],
      (ct) => {
        try {
          const u = normalizeStructTag2(ct);
          const hit = tokensData.find((tok) => {
            try {
              return normalizeStructTag2(tok.coinType) === u;
            } catch {
              return false;
            }
          });
          return hit?.ticker ?? symbolFromCoinType(u);
        } catch {
          return symbolFromCoinType(ct);
        }
      },
      spotOpts
    );
  } catch {
    spotsMap = /* @__PURE__ */ new Map();
  }
  const out = [];
  for (const row of rawRows) {
    const posId = typeof row.objectId === "string" ? row.objectId.trim() : "";
    const poolId = typeof row.poolId === "string" ? row.poolId.trim() : "";
    if (!posId || !poolId) continue;
    const pool = findMomentumPoolByApiId(poolsHydrated, poolId);
    if (!pool) continue;
    const tX = pool.tokenX?.coinType?.trim() ?? pool.tokenXType?.trim() ?? "";
    const tY = pool.tokenY?.coinType?.trim() ?? pool.tokenYType?.trim() ?? "";
    if (!tX || !tY) continue;
    const tANorm = normTypeSafe(tX);
    const tBNorm = normTypeSafe(tY);
    if (!tANorm || !tBNorm) continue;
    const decA = typeof pool.tokenX?.decimals === "number" ? pool.tokenX.decimals : 0;
    const decB = typeof pool.tokenY?.decimals === "number" ? pool.tokenY.decimals : 0;
    const symA = pool.tokenX?.ticker?.trim() || symbolFromCoinType(tANorm);
    const symB = pool.tokenY?.ticker?.trim() || symbolFromCoinType(tBNorm);
    const iconA = typeof pool.tokenX?.iconUrl === "string" && pool.tokenX.iconUrl.startsWith("https://") ? pool.tokenX.iconUrl : null;
    const iconB = typeof pool.tokenY?.iconUrl === "string" && pool.tokenY.iconUrl.startsWith("https://") ? pool.tokenY.iconUrl : null;
    const lowerTick = Number.isFinite(row.lowerTick) ? row.lowerTick : 0;
    const upperTick = Number.isFinite(row.upperTick) ? row.upperTick : 0;
    const liqBn = row.liquidity instanceof BN2 ? row.liquidity : new BN2(String(row.liquidity ?? 0), 10);
    const sqrtStr = pool.currentSqrtPrice != null && `${pool.currentSqrtPrice}`.length > 0 ? `${pool.currentSqrtPrice}`.trim() : "0";
    const curSqrtBn = sqrtStr.match(/^\d+$/) ? new BN2(sqrtStr, 10) : new BN2(0);
    let humA = 0;
    let humB = 0;
    if (!liqBn.isZero() && !curSqrtBn.isZero()) {
      try {
        const lowerSqrt = TickMath2.tickIndexToSqrtPriceX64(lowerTick);
        const upperSqrt = TickMath2.tickIndexToSqrtPriceX64(upperTick);
        const { coinA, coinB } = Utils2.getCoinAmountFromLiquidity(
          liqBn,
          curSqrtBn,
          lowerSqrt,
          upperSqrt,
          false
        );
        humA = safeHumanFromBnRaw(coinA, decA);
        humB = safeHumanFromBnRaw(coinB, decB);
      } catch {
      }
    }
    const pxaRaw = spotsMap.get(tANorm)?.price;
    const pxbRaw = spotsMap.get(tBNorm)?.price;
    const pxaPool = Number(pool.tokenX?.price);
    const pxbPool = Number(pool.tokenY?.price);
    const pxaF = pxaRaw != null && Number.isFinite(pxaRaw) && pxaRaw > 0 && pxaRaw <= 1e8 ? pxaRaw : Number.isFinite(pxaPool) && pxaPool > 0 && pxaPool <= 1e8 ? pxaPool : null;
    const pxbF = pxbRaw != null && Number.isFinite(pxbRaw) && pxbRaw > 0 && pxbRaw <= 1e8 ? pxbRaw : Number.isFinite(pxbPool) && pxbPool > 0 && pxbPool <= 1e8 ? pxbPool : null;
    const partA = pxaF != null ? humA * pxaF : 0;
    const partB = pxbF != null ? humB * pxbF : 0;
    let valueUsd = clampUsd(partA + partB);
    if (valueUsd <= 0 && Number.isFinite(row.amount) && row.amount > 0) {
      valueUsd = clampUsd(row.amount);
    }
    const feeFraction = momentumPoolFeeFraction(pool.lpFeesPercent ?? "0");
    const statusLabel = typeof row.status === "string" ? row.status.trim() : "";
    const inRangeResolved = momentumStatusToRange(statusLabel || "out of range") === "in_range";
    const feeLabelPct = `${(feeFraction * 100).toFixed(3)}%`;
    const pair = `${symA}/${symB} \xB7 ${feeLabelPct}${inRangeResolved ? "" : " \xB7 OUT"}`;
    const feeHumA = safeHumanFromNumberRaw(Math.floor(row.feeAmountX), decA);
    const feeHumB = safeHumanFromNumberRaw(Math.floor(row.feeAmountY), decB);
    let unclaimedFeeUsd = 0;
    if (pxaF != null) unclaimedFeeUsd += feeHumA * pxaF;
    else unclaimedFeeUsd += clampUsd(row.feeAmountXUsd);
    if (pxbF != null) unclaimedFeeUsd += feeHumB * pxbF;
    else unclaimedFeeUsd += clampUsd(row.feeAmountYUsd);
    unclaimedFeeUsd = clampUsd(unclaimedFeeUsd);
    let rewardHumUsdSpot = 0;
    for (const rew of row.rewarders ?? []) {
      const ct = rew?.coinType;
      const amtNum = rew?.amount;
      if (typeof ct !== "string" || ct.trim() === "" || typeof amtNum !== "number" || !Number.isFinite(amtNum))
        continue;
      const nt = normRewardCoinType(ct);
      const ntNorm = normTypeSafe(nt) ?? nt;
      const td = tokensData.find((tok) => {
        try {
          return normalizeStructTag2(tok.coinType) === ntNorm;
        } catch {
          return false;
        }
      });
      const rd = td?.decimals ?? 0;
      const hum = safeHumanFromNumberRaw(Math.floor(amtNum), rd);
      const pxRw = spotsMap.get(ntNorm)?.price;
      const tdPrice = Number(td?.price);
      const pxRf = pxRw != null && Number.isFinite(pxRw) && pxRw > 0 && pxRw <= 1e8 ? pxRw : Number.isFinite(tdPrice) && tdPrice > 0 && tdPrice <= 1e8 ? tdPrice : null;
      if (pxRf != null) rewardHumUsdSpot += clampUsd(hum * pxRf);
    }
    const sdkFeeUsdPart = clampUsd(row.feeAmountXUsd + row.feeAmountYUsd);
    const sdkClaimUsd = Number.isFinite(row.claimableRewards) ? row.claimableRewards : 0;
    let unclaimedRewardUsd = rewardHumUsdSpot;
    if (unclaimedRewardUsd <= 0 && sdkClaimUsd > 0 && sdkFeeUsdPart >= 0) {
      unclaimedRewardUsd = clampUsd(Math.max(0, sdkClaimUsd - sdkFeeUsdPart));
    }
    unclaimedRewardUsd = clampUsd(unclaimedRewardUsd);
    const opened = {
      id: posId,
      protocol: "momentum",
      poolId,
      pair,
      tokenA: symA,
      tokenB: symB,
      tokenAAddress: tANorm,
      tokenBAddress: tBNorm,
      tokenAIconUrl: iconA,
      tokenBIconUrl: iconB,
      tokenADecimals: decA,
      tokenBDecimals: decB,
      fee: feeFraction,
      tickLower: lowerTick,
      tickUpper: upperTick,
      currentTick: poolTickCurrent(pool),
      currentSqrtPrice: curSqrtBn.isZero() ? sqrtStr : curSqrtBn.toString(10),
      liquidity: liqBn.toString(10),
      status: momentumStatusToRange(statusLabel || (inRangeResolved ? "in range" : "out of range")),
      tokenAAmount: humA,
      tokenBAmount: humB,
      currentPriceA_USD: pxaF ?? 0,
      currentPriceB_USD: pxbF ?? 0,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: feeHumA,
      unclaimedFeeB: feeHumB,
      unclaimedFeeUSD: unclaimedFeeUsd,
      unclaimedRewardUSD: unclaimedRewardUsd,
      openedAt,
      daysOpen: 0,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: 0
    };
    out.push(opened);
  }
  return out;
}

// src/services/bluefinService.ts
import { TickMath as TickMath3, Utils as Utils3 } from "@mmt-finance/clmm-sdk";

// src/services/bluefinAccruedInspect.ts
import { bcs as bcs3 } from "@mysten/sui/bcs";
import { Transaction as Transaction2 } from "@mysten/sui/transactions";
import { normalizeStructTag as normalizeStructTag3, normalizeSuiAddress as normalizeSuiAddress6, SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
var PKG = PROTOCOL_PACKAGES.BLUEFIN_CLMM;
var BLUEFIN_POOL = `${PKG}::pool`;
var DEVINSPECT_SENDER = "0x0000000000000000000000000000000000000000000000000000000000000000";
var DEVINSPECT_TIMEOUT_MS = 2e4;
function u64BytesToString(bytes) {
  if (!bytes?.length) return "0";
  try {
    const n2 = bcs3.u64().parse(Uint8Array.from(bytes));
    if (typeof n2 === "bigint") return n2.toString();
    if (typeof n2 === "number" && Number.isFinite(n2) && n2 >= 0) return String(Math.trunc(n2));
    if (typeof n2 === "string" && /^\d+$/.test(n2)) return n2;
    return "0";
  } catch {
    return "0";
  }
}
function normType(ct) {
  if (!ct) return "";
  try {
    return normalizeStructTag3(ct);
  } catch {
    return ct;
  }
}
function normalizeRewardArgTypes(rewardCoinTypes) {
  const validRewards = [];
  for (const x of rewardCoinTypes) {
    const t = normType(x);
    if (t) validRewards.push(t);
    if (validRewards.length >= 32) break;
  }
  return validRewards;
}
async function devInspectBluefinOnce(client, core, validRewards, sender) {
  const tx = new Transaction2();
  const poolRef = tx.object(core.poolId);
  const posRef = tx.object(core.positionId);
  const clock = tx.object(SUI_CLOCK_OBJECT_ID);
  const tA = core.coinTypeA;
  const tB = core.coinTypeB;
  for (const tR of validRewards) {
    tx.moveCall({
      target: `${BLUEFIN_POOL}::get_accrued_rewards`,
      typeArguments: [tA, tB, tR],
      arguments: [clock, poolRef, posRef]
    });
  }
  tx.moveCall({
    target: `${BLUEFIN_POOL}::get_accrued_fee`,
    typeArguments: [tA, tB],
    arguments: [clock, poolRef, posRef]
  });
  let res;
  try {
    const timeoutPromise = new Promise(
      (_, reject) => setTimeout(
        () => reject(new Error(`devInspect timeout after ${DEVINSPECT_TIMEOUT_MS}ms`)),
        DEVINSPECT_TIMEOUT_MS
      )
    );
    res = await Promise.race([
      client.devInspectTransactionBlock({ transactionBlock: tx, sender }),
      timeoutPromise
    ]);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err };
  }
  if (res.error) return { ok: false, error: res.error };
  const results = res.results;
  const rewardCmdCount = validRewards.length;
  const expected = rewardCmdCount + 1;
  if (!results || results.length !== expected) {
    return {
      ok: false,
      error: `devInspect: expected ${expected} command result(s) (rewards+fee), got ${results?.length ?? 0}`
    };
  }
  const feeIdx = rewardCmdCount;
  const feeRet = results[feeIdx]?.returnValues;
  if (!feeRet || feeRet.length < 2) {
    return { ok: false, error: "pool::get_accrued_fee: expected 2 u64 return values" };
  }
  const rawFeeA = u64BytesToString(feeRet[0]?.[0]);
  const rawFeeB = u64BytesToString(feeRet[1]?.[0]);
  const rewardRaws = [];
  for (let i = 0; i < rewardCmdCount; i += 1) {
    const r = results[i]?.returnValues;
    rewardRaws.push(u64BytesToString(r?.[0]?.[0]));
  }
  return { ok: true, rawFeeA, rawFeeB, rewardRaws };
}
async function fetchBluefinAccruedRaws(client, input) {
  const tA = normType(input.coinTypeA);
  const tB = normType(input.coinTypeB);
  if (!tA || !tB) {
    return { ok: false, error: "Bluefin accrued: missing coin_type_a or coin_type_b" };
  }
  const fullRewards = normalizeRewardArgTypes(input.rewardCoinTypes);
  const senderOpt = input.inspectSender?.trim();
  let walletSender = DEVINSPECT_SENDER;
  if (senderOpt) {
    try {
      walletSender = normalizeSuiAddress6(senderOpt);
    } catch {
      walletSender = senderOpt.startsWith("0x") ? senderOpt : DEVINSPECT_SENDER;
    }
  }
  const core = {
    positionId: input.positionId,
    poolId: input.poolId,
    coinTypeA: tA,
    coinTypeB: tB
  };
  let lastErr = "Bluefin accrued: all devInspect attempts failed";
  const walletNotZero = walletSender !== DEVINSPECT_SENDER;
  const tryRuns = [
    { rewards: fullRewards, sender: walletSender }
  ];
  if (fullRewards.length > 0) {
    tryRuns.push({ rewards: [], sender: walletSender });
  }
  if (walletNotZero) {
    tryRuns.push({ rewards: fullRewards, sender: DEVINSPECT_SENDER });
    if (fullRewards.length > 0) {
      tryRuns.push({ rewards: [], sender: DEVINSPECT_SENDER });
    }
  }
  for (const { rewards, sender } of tryRuns) {
    const r = await devInspectBluefinOnce(client, core, rewards, sender);
    if (!r.ok) {
      lastErr = r.error;
      continue;
    }
    if (fullRewards.length > 0 && rewards.length === 0) {
      return { ok: true, rawFeeA: r.rawFeeA, rawFeeB: r.rawFeeB, rewardRaws: [] };
    }
    return r;
  }
  return { ok: false, error: lastErr };
}

// src/services/bluefinMoveRead.ts
function unwrapMoveStruct(val) {
  if (!val || typeof val !== "object") return null;
  const obj = val;
  if (obj.fields != null && typeof obj.fields === "object") {
    return obj.fields;
  }
  return obj;
}
function i32BitsToSigned(bits) {
  if (!Number.isFinite(bits)) return 0;
  const n2 = Math.trunc(bits);
  return n2 > 2147483647 ? n2 - 4294967296 : n2;
}
function readMoveI32(val) {
  if (val == null) return 0;
  if (typeof val === "number" && Number.isFinite(val)) {
    const n2 = Math.trunc(val);
    if (n2 >= -2147483648 && n2 <= 2147483647) return n2;
    return i32BitsToSigned(n2);
  }
  if (typeof val === "string") {
    const s = val.trim();
    if (!/^-?\d+$/.test(s)) return 0;
    const n2 = Number(s);
    if (s.startsWith("-")) return n2;
    return i32BitsToSigned(n2);
  }
  if (typeof val === "object") {
    const fields = unwrapMoveStruct(val);
    if (!fields) return 0;
    const bits = fields.bits;
    if (typeof bits === "number") return i32BitsToSigned(Math.trunc(bits));
    if (typeof bits === "bigint") return i32BitsToSigned(Number(bits));
    if (typeof bits === "string" && /^-?\d+$/.test(bits.trim())) {
      const s = bits.trim();
      if (s.startsWith("-")) return Number(s);
      return i32BitsToSigned(Number(s));
    }
  }
  return 0;
}
function readMoveUIntString(field) {
  if (field == null) return "0";
  if (typeof field === "string" && /^\d+$/.test(field)) return field;
  if (typeof field === "number" && Number.isFinite(field) && field >= 0) return String(Math.trunc(field));
  if (typeof field === "bigint") return field.toString();
  if (typeof field === "object" && field !== null && "fields" in field) {
    const fld = field.fields;
    if (fld && typeof fld === "object") {
      if (Object.prototype.hasOwnProperty.call(fld, "value")) {
        const v = fld["value"];
        if (typeof v === "string" && /^\d+$/.test(v)) return v;
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(Math.trunc(v));
        if (typeof v === "bigint") return v.toString();
      }
      const bits = fld["bits"];
      if (bits !== void 0) return /^\d+$/.test(String(bits)) ? String(bits) : "0";
    }
  }
  if (typeof field === "object" && field !== null) {
    const flat = unwrapMoveStruct(field);
    if (flat && flat.bits !== void 0) {
      const bits = flat.bits;
      return /^\d+$/.test(String(bits)) ? String(bits) : "0";
    }
  }
  if (typeof field === "string") {
    return /^\d+$/.test(field) ? field : "0";
  }
  return "0";
}

// src/services/bluefinUnclaimedDebug.ts
function logBluefinUnclaimedDebug(s) {
  if (import.meta.env.VITE_DEBUG_BLUEFIN !== "1") return;
  console.log("[bluefin unclaimed]", {
    position_id: s.position_id,
    pool_id: s.pool_id,
    source: s.source,
    sdk: s.source === "bluefin_sdk",
    sdkMethod: s.sdkReferenceMethod,
    api_ok: s.source === "bluefin_api",
    unclaimed_fees: s.unclaimed_fees,
    unclaimed_rewards: s.unclaimed_rewards,
    unclaimed_fees_usd: s.unclaimed_fees_usd,
    unclaimed_rewards_usd: s.unclaimed_rewards_usd,
    unclaimed_total_usd: s.unclaimed_total_usd,
    fetched_at: s.fetched_at
  });
}

// src/services/bluefinAccruedSdk.ts
import Decimal4 from "decimal.js";

// src/services/lpFeatureFlags.ts
function envTruthy(v) {
  if (v === void 0 || v === "") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}
function isBluefinLazyUnclaimedEnabled() {
  try {
    const raw = import.meta.env.VITE_BLUEFIN_LAZY_UNCLAIMED;
    if (raw === void 0 || raw === "") return true;
    return envTruthy(raw);
  } catch {
    return true;
  }
}

// src/utils/lpLifecycle.ts
function liquidityRawState(liquidity) {
  if (liquidity == null || liquidity === "") return "unknown";
  if (!/^\d+$/.test(liquidity)) return "unknown";
  try {
    return BigInt(liquidity) === 0n ? "zero" : "positive";
  } catch {
    return "unknown";
  }
}
function resolveLifecycleStatus(liquidity) {
  const s = liquidityRawState(liquidity);
  if (s === "zero") return "empty";
  if (s === "positive") return "active";
  return "unknown";
}
function resolveRangeStatus(priceInRange, lifecycleStatus) {
  if (lifecycleStatus === "empty") return "out_of_range";
  return priceInRange ? "in_range" : "out_of_range";
}

// src/services/bluefinService.ts
import { normalizeSuiAddress as normalizeSuiAddress7, normalizeStructTag as normalizeStructTag4 } from "@mysten/sui/utils";
import Decimal5 from "decimal.js";
import BN3 from "bn.js";
var _hardcodedSymbol = new Map(
  HARDCODED_VERIFIED.map((c) => [c.type.toLowerCase(), c.symbol])
);
var PKG2 = PROTOCOL_PACKAGES.BLUEFIN_CLMM;
var POS_STRUCT = `${PKG2}::position::Position`;
var BLUEFIN_UNCLAIMED_VALIDATION_POS = "0x3197153a08f2429bbb9f3343efc5a495539c7b1065343fd0fe5e011df02e423c";
function httpsIconUrlFromCoinMetadata(m) {
  const u = m?.iconUrl?.trim();
  return typeof u === "string" && u.startsWith("https://") ? u : null;
}
function asMoveFields(data) {
  const d = data;
  if (!d?.content || d.content.dataType !== "moveObject") return null;
  const f = d.content.fields;
  return f && typeof f === "object" ? f : null;
}
function readString(f, k) {
  if (!f) return "";
  const v = f[k];
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "fields" in v) {
    const id = v.fields?.id;
    if (typeof id === "string") return id;
  }
  return "";
}
function readSuiUtf8String(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "fields" in v) {
    const bytes = v.fields?.bytes;
    if (Array.isArray(bytes) && bytes.length) {
      try {
        return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
      } catch {
        return "";
      }
    }
  }
  return "";
}
function readPositionCoinType(fields, key) {
  try {
    const v = fields[key];
    if (typeof v === "string" && v.trim()) {
      return normCoinType(v.trim());
    }
    const s = readSuiUtf8String(v).trim();
    if (!s) return "";
    return normCoinType(s);
  } catch {
    return "";
  }
}
function readStructFields(el) {
  if (el == null) return null;
  if (typeof el === "object" && "fields" in el && el.fields) {
    const ff = el.fields;
    return ff && typeof ff === "object" ? ff : null;
  }
  if (typeof el === "object") return el;
  return null;
}
function poolRewardSpecList(poolF) {
  if (!poolF) return [];
  const v = poolF["reward_infos"];
  if (!Array.isArray(v) || v.length === 0) return [];
  return v.map((el) => {
    const r = readStructFields(el);
    if (!r) return { coinType: "", dec: 0 };
    const rawType = r["reward_coin_type"];
    const ct = readSuiUtf8String(rawType).trim();
    const n2 = ct ? normCoinType(ct) : "";
    const d = r["reward_coin_decimals"];
    const dec = typeof d === "number" ? d : typeof d === "string" ? parseInt(d, 10) : 0;
    return { coinType: n2, dec: Number.isFinite(dec) ? dec : 0 };
  });
}
var MAX_SANE_POSITION_USD2 = 5e7;
var MAX_SANE_HUMAN_TOKENS2 = 1e18;
function safeHumanFromRaw(raw, decimals) {
  if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
  try {
    const d = new Decimal5(raw).div(new Decimal5(10).pow(decimals));
    const n2 = d.toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS2) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function normCoinType(raw) {
  if (!raw) return raw;
  return normalizeStructTag4(raw);
}
function symbolFromType2(coinType) {
  const parts = coinType.split("::");
  return parts[2] ?? (parts[1] ?? "\u2014");
}
function priceSourceLabel(spots, coinType) {
  const r = spots.get(coinType);
  if (!r || r.price == null) return "unavailable";
  return r.priceSource;
}
function parseFeeMillionthsToPctLabel(fee) {
  if (!Number.isFinite(fee) || fee <= 0) return "\u2014";
  return `${(fee / 1e6 * 100).toFixed(2)}%`;
}
async function getBluefinSpotPositions(walletAddress, options) {
  const fetchUnclaimed = options?.includeUnclaimed === true || options?.includeUnclaimed !== false && !isBluefinLazyUnclaimedEnabled();
  const owner = walletAddress;
  const posIds = [];
  let cursor;
  for (; ; ) {
    const page = await suiClient.getOwnedObjects({
      owner,
      filter: { StructType: POS_STRUCT },
      options: { showContent: true, showType: true },
      cursor: cursor ?? null
    });
    for (const it of page.data) {
      const d = it.data;
      if (!d?.objectId) continue;
      const f = asMoveFields(d);
      if (f) posIds.push({ id: d.objectId, fields: f });
    }
    if (!page.hasNextPage) break;
    cursor = page.nextCursor ?? null;
  }
  if (posIds.length === 0) return [];
  const poolIdSet = /* @__PURE__ */ new Set();
  for (const p of posIds) {
    const pid = readString(p.fields, "pool_id");
    if (pid) {
      try {
        poolIdSet.add(normalizeSuiAddress7(pid));
      } catch {
        poolIdSet.add(pid);
      }
    }
  }
  const poolMap = /* @__PURE__ */ new Map();
  const poolIds = [...poolIdSet];
  const chunk = 50;
  for (let i = 0; i < poolIds.length; i += chunk) {
    const part = poolIds.slice(i, i + chunk);
    const res = await suiClient.multiGetObjects({
      ids: part,
      options: { showContent: true, showType: true }
    });
    for (const r of res) {
      if (r.data?.objectId) {
        const f = asMoveFields(r.data);
        if (f) poolMap.set(normalizeSuiAddress7(r.data.objectId), f);
      }
    }
  }
  const meta = /* @__PURE__ */ new Map();
  const allCoinTypes = /* @__PURE__ */ new Set();
  for (const p of posIds) {
    const f = p.fields;
    for (const k of ["coin_type_a", "coin_type_b"]) {
      const t = readPositionCoinType(f, k);
      if (t) allCoinTypes.add(t);
    }
  }
  for (const poolF of poolMap.values()) {
    for (const { coinType } of poolRewardSpecList(poolF)) {
      if (coinType) allCoinTypes.add(coinType);
    }
  }
  for (const c of allCoinTypes) {
    try {
      const m = await suiClient.getCoinMetadata({ coinType: c });
      meta.set(c, {
        symbol: _hardcodedSymbol.get(c.toLowerCase()) ?? m?.symbol ?? symbolFromType2(c),
        decimals: m?.decimals ?? 0,
        iconUrl: httpsIconUrlFromCoinMetadata(m)
      });
    } catch {
      meta.set(c, {
        symbol: _hardcodedSymbol.get(c.toLowerCase()) ?? symbolFromType2(c),
        decimals: 0,
        iconUrl: null
      });
    }
  }
  const typesList = [...allCoinTypes];
  const rs = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  const spots = await resolveSpots(typesList, (ct) => meta.get(ct)?.symbol ?? symbolFromType2(ct), rs);
  const getUsd = (ct, rawInt) => {
    const dec = meta.get(ct)?.decimals ?? 0;
    const human = safeHumanFromRaw(rawInt, dec);
    const px = spots.get(ct)?.price;
    if (px == null || !Number.isFinite(px) || px > 1e8) return 0;
    const v = human * px;
    return v > 0 && v <= MAX_SANE_POSITION_USD2 ? v : 0;
  };
  const out = [];
  for (const p of posIds) {
    const f = p.fields;
    const poolIdRaw = readString(f, "pool_id");
    let poolKey = poolIdRaw;
    try {
      if (poolIdRaw) poolKey = normalizeSuiAddress7(poolIdRaw);
    } catch {
    }
    const tA = readPositionCoinType(f, "coin_type_a");
    const tB = readPositionCoinType(f, "coin_type_b");
    const symA = meta.get(tA)?.symbol ?? "A";
    const symB = meta.get(tB)?.symbol ?? "B";
    const liqStr = readMoveUIntString(f.liquidity);
    const lowerT = readMoveI32(f.lower_tick);
    const upperT = readMoveI32(f.upper_tick);
    const feeBps = typeof f.fee_rate === "string" ? parseInt(f.fee_rate, 10) : Number(f.fee_rate ?? 0);
    const poolF = poolKey ? poolMap.get(poolKey) ?? null : null;
    const sqrtField = (poolF && poolF["current_sqrt_price"]) ?? null;
    const curSqrtStr = readMoveUIntString(sqrtField);
    const currentTickI32 = readMoveI32(poolF?.current_tick_index);
    const lowerSqrt = TickMath3.tickIndexToSqrtPriceX64(lowerT);
    const upperSqrt = TickMath3.tickIndexToSqrtPriceX64(upperT);
    let rawA = "0";
    let rawB = "0";
    const hasPool = poolF != null && curSqrtStr !== "0" && /^\d+$/.test(curSqrtStr) && /^\d+$/.test(liqStr);
    const liqBn = new BN3(liqStr, 10);
    const curSqrt = new BN3(curSqrtStr, 10);
    if (hasPool && !liqBn.isZero() && !curSqrt.isZero()) {
      try {
        const { coinA, coinB } = Utils3.getCoinAmountFromLiquidity(
          liqBn,
          curSqrt,
          lowerSqrt,
          upperSqrt,
          false
        );
        rawA = coinA.toString(10);
        rawB = coinB.toString(10);
      } catch {
      }
    }
    const decA = meta.get(tA)?.decimals ?? 0;
    const decB = meta.get(tB)?.decimals ?? 0;
    const humA = safeHumanFromRaw(rawA, decA);
    const humB = safeHumanFromRaw(rawB, decB);
    const pxa = spots.get(tA)?.price;
    const pxb = spots.get(tB)?.price;
    const pxaF = pxa != null && Number.isFinite(pxa) && pxa > 0 && pxa <= 1e8 ? pxa : null;
    const pxbF = pxb != null && Number.isFinite(pxb) && pxb > 0 && pxb <= 1e8 ? pxb : null;
    const vA = pxaF != null ? humA * pxaF : 0;
    const vB = pxbF != null ? humB * pxbF : 0;
    let valueUsd = vA + vB;
    if (!Number.isFinite(valueUsd) || valueUsd < 0 || valueUsd > MAX_SANE_POSITION_USD2) {
      valueUsd = 0;
    }
    const inRange = currentTickI32 >= lowerT && currentTickI32 < upperT;
    const rewSpec = poolRewardSpecList(poolF);
    const rewardCoinTypes = rewSpec.map((r) => r.coinType).filter((c) => c.length > 0);
    let unclaimedSource = "bluefin_sdk";
    let rawFeeA = "0";
    let rawFeeB = "0";
    let rewRaws = [];
    const poolOk = Boolean(poolKey && poolF) && tA && tB;
    if (fetchUnclaimed && poolOk) {
      const accrued = await fetchBluefinAccruedRaws(suiClient, {
        positionId: p.id,
        poolId: poolKey,
        coinTypeA: tA,
        coinTypeB: tB,
        rewardCoinTypes,
        inspectSender: walletAddress
      });
      if (accrued.ok) {
        rawFeeA = accrued.rawFeeA;
        rawFeeB = accrued.rawFeeB;
        rewRaws = accrued.rewardRaws;
      } else {
        unclaimedSource = "unavailable";
        console.warn("Bluefin accrued fees/rewards unavailable: devInspect / pool view failed \u2014", accrued.error);
        if (import.meta.env.VITE_DEBUG_BLUEFIN === "1") {
          console.warn("[bluefin] detail", p.id, accrued.error);
        }
      }
    } else if (!fetchUnclaimed) {
      unclaimedSource = "unavailable";
    } else {
      unclaimedSource = "unavailable";
      console.warn("Bluefin accrued fees/rewards unavailable: missing pool or coin types for position", p.id);
    }
    const feeHumA = safeHumanFromRaw(rawFeeA, decA);
    const feeHumB = safeHumanFromRaw(rawFeeB, decB);
    let unclaimedFeeUsd = 0;
    let feeUsdA = 0;
    let feeUsdB = 0;
    if (pxaF != null) {
      feeUsdA = feeHumA * pxaF;
      unclaimedFeeUsd += feeUsdA;
    } else if (feeHumA > 0) {
      feeUsdA = getUsd(tA, rawFeeA);
      unclaimedFeeUsd += feeUsdA;
    }
    if (pxbF != null) {
      feeUsdB = feeHumB * pxbF;
      unclaimedFeeUsd += feeUsdB;
    } else if (feeHumB > 0) {
      feeUsdB = getUsd(tB, rawFeeB);
      unclaimedFeeUsd += feeUsdB;
    }
    if (!Number.isFinite(unclaimedFeeUsd) || unclaimedFeeUsd < 0) unclaimedFeeUsd = 0;
    if (unclaimedFeeUsd > MAX_SANE_POSITION_USD2) unclaimedFeeUsd = 0;
    if (!Number.isFinite(feeUsdA)) feeUsdA = 0;
    if (!Number.isFinite(feeUsdB)) feeUsdB = 0;
    const unclaimed_fees = [];
    if (feeHumA > 0 || feeUsdA > 0) {
      unclaimed_fees.push({
        token: symA,
        coinType: tA,
        amount: feeHumA,
        amount_usd: feeUsdA,
        price_source: priceSourceLabel(spots, tA)
      });
    }
    if (feeHumB > 0 || feeUsdB > 0) {
      unclaimed_fees.push({
        token: symB,
        coinType: tB,
        amount: feeHumB,
        amount_usd: feeUsdB,
        price_source: priceSourceLabel(spots, tB)
      });
    }
    let unclaimedRewardUsd = 0;
    const unclaimed_rewards = [];
    const specWithTypes = rewSpec.filter((r) => r.coinType);
    const nRew = Math.min(rewRaws.length, specWithTypes.length);
    for (let i = 0; i < nRew; i++) {
      const { coinType, dec: poolDec } = specWithTypes[i];
      if (!coinType) continue;
      const rawO = rewRaws[i] ?? "0";
      const dec = meta.get(coinType)?.decimals ?? poolDec;
      const hum = safeHumanFromRaw(rawO, dec);
      if (hum <= 0) continue;
      const pR = spots.get(coinType)?.price;
      const pRf = pR != null && Number.isFinite(pR) && pR > 0 && pR <= 1e8 ? pR : null;
      let leg = 0;
      if (pRf != null) leg = hum * pRf;
      else leg = getUsd(coinType, rawO);
      if (leg > 0 && leg <= MAX_SANE_POSITION_USD2) {
        unclaimedRewardUsd += leg;
        unclaimed_rewards.push({
          token: meta.get(coinType)?.symbol ?? symbolFromType2(coinType),
          coinType,
          amount: hum,
          amount_usd: leg,
          price_source: priceSourceLabel(spots, coinType)
        });
      }
    }
    if (!Number.isFinite(unclaimedRewardUsd) || unclaimedRewardUsd < 0) unclaimedRewardUsd = 0;
    const openedAt = Date.now() / 1e3;
    const feeLabel = parseFeeMillionthsToPctLabel(feeBps);
    const lifecycleStatus = resolveLifecycleStatus(liqStr);
    const rangeLabel = inRange && lifecycleStatus !== "empty" ? "" : " \xB7 OUT";
    const poolIdOut = poolIdRaw || poolKey;
    const bluefinUnclaimed = {
      position_id: p.id,
      pool_id: poolIdOut,
      dex: "Bluefin",
      unclaimed_fees: unclaimedSource === "unavailable" ? [] : unclaimed_fees,
      unclaimed_rewards: unclaimedSource === "unavailable" ? [] : unclaimed_rewards,
      unclaimed_fees_usd: unclaimedSource === "unavailable" ? Number.NaN : unclaimedFeeUsd,
      unclaimed_rewards_usd: unclaimedSource === "unavailable" ? Number.NaN : unclaimedRewardUsd,
      unclaimed_total_usd: unclaimedSource === "unavailable" ? Number.NaN : unclaimedFeeUsd + unclaimedRewardUsd,
      fetched_at: Date.now() / 1e3,
      source: unclaimedSource,
      ...unclaimedSource === "unavailable" && rewardCoinTypes.length > 0 ? { poolRewardCoinTypes: rewardCoinTypes } : {},
      ...unclaimedSource === "bluefin_sdk" ? { sdkReferenceMethod: "OnChainCalls.getAccruedFeeAndRewards" } : {}
    };
    logBluefinUnclaimedDebug(bluefinUnclaimed);
    if (import.meta.env.VITE_DEBUG_BLUEFIN === "1" && p.id === BLUEFIN_UNCLAIMED_VALIDATION_POS) {
      console.log("[bluefin validate] pool view raw", {
        position: p.id,
        pool: poolIdOut,
        rawFeeA: unclaimedSource === "bluefin_sdk" ? rawFeeA : "n/a",
        rawFeeB: unclaimedSource === "bluefin_sdk" ? rawFeeB : "n/a",
        rewardRaws: unclaimedSource === "bluefin_sdk" ? rewRaws : [],
        compareUiHint: { deepFee: "~51.25", suiFee: "~1.54", deepRew: "~25.44", usd: "~3.71" }
      });
    }
    const row = {
      id: p.id,
      protocol: "bluefin",
      poolId: poolIdOut,
      pair: `${symA}+${symB} \xB7 ${feeLabel === "\u2014" ? "\u2014" : feeLabel}${rangeLabel}`,
      tokenA: symA,
      tokenB: symB,
      tokenAAddress: tA,
      tokenBAddress: tB,
      tokenAIconUrl: meta.get(tA)?.iconUrl ?? null,
      tokenBIconUrl: meta.get(tB)?.iconUrl ?? null,
      tokenADecimals: decA,
      tokenBDecimals: decB,
      fee: feeBps / 1e6,
      tickLower: lowerT,
      tickUpper: upperT,
      currentTick: currentTickI32,
      currentSqrtPrice: curSqrt.isZero() ? curSqrtStr : curSqrt.toString(10),
      liquidity: liqStr,
      lifecycleStatus,
      status: resolveRangeStatus(inRange, lifecycleStatus),
      tokenAAmount: humA,
      tokenBAmount: humB,
      currentPriceA_USD: pxaF ?? 0,
      currentPriceB_USD: pxbF ?? 0,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: unclaimedSource === "unavailable" ? 0 : feeHumA,
      unclaimedFeeB: unclaimedSource === "unavailable" ? 0 : feeHumB,
      unclaimedFeeUSD: unclaimedSource === "unavailable" ? Number.NaN : unclaimedFeeUsd,
      unclaimedRewardUSD: unclaimedSource === "unavailable" ? Number.NaN : unclaimedRewardUsd,
      openedAt,
      daysOpen: 0,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: 0,
      bluefinUnclaimed
    };
    out.push(row);
  }
  return out;
}

// src/services/cetusService.ts
import { TickMath as TickMath4, Utils as Utils4 } from "@mmt-finance/clmm-sdk";
import { normalizeStructTag as normalizeStructTag6, normalizeSuiAddress as normalizeSuiAddress9 } from "@mysten/sui/utils";

// src/services/cetusAccruedInspect.ts
import { Transaction as Transaction3 } from "@mysten/sui/transactions";
import { normalizeStructTag as normalizeStructTag5, normalizeSuiAddress as normalizeSuiAddress8, SUI_CLOCK_OBJECT_ID as SUI_CLOCK_OBJECT_ID2 } from "@mysten/sui/utils";
var CETUS_INTEGRATE_AT = "0xae9c208cf58fd5ba36737c9ee5dcfa7f152d0fb5a5a99eebb7c881ebc2fe59e0";
var CETUS_GLOBAL_CONFIG = "0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f";
var FETCHER_MODULE = "fetcher_script";
var DEVINSPECT_SENDER2 = "0x0000000000000000000000000000000000000000000000000000000000000000";
var DEVINSPECT_TIMEOUT_MS2 = 2e4;
function normType2(ct) {
  if (!ct) return "";
  try {
    return normalizeStructTag5(ct);
  } catch {
    return ct;
  }
}
function readU64(v) {
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(Math.trunc(v));
  return "0";
}
async function devInspectCetusOnce(client, input, sender) {
  const tx = new Transaction3();
  const cfg = tx.object(CETUS_GLOBAL_CONFIG);
  const pool = tx.object(input.poolId);
  const posRef = tx.pure.address(input.positionId);
  const clock = tx.object(SUI_CLOCK_OBJECT_ID2);
  const tA = input.coinTypeA;
  const tB = input.coinTypeB;
  tx.moveCall({
    target: `${CETUS_INTEGRATE_AT}::${FETCHER_MODULE}::fetch_position_fees`,
    typeArguments: [tA, tB],
    arguments: [cfg, pool, posRef]
  });
  tx.moveCall({
    target: `${CETUS_INTEGRATE_AT}::${FETCHER_MODULE}::fetch_position_rewards`,
    typeArguments: [tA, tB],
    arguments: [cfg, pool, posRef, clock]
  });
  let res;
  try {
    const timeout = new Promise(
      (_, rej) => setTimeout(
        () => rej(new Error(`devInspect timeout after ${DEVINSPECT_TIMEOUT_MS2}ms`)),
        DEVINSPECT_TIMEOUT_MS2
      )
    );
    res = await Promise.race([
      client.devInspectTransactionBlock({ transactionBlock: tx, sender }),
      timeout
    ]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (res.error) return { ok: false, error: String(res.error) };
  const events = Array.isArray(res.events) ? res.events : [];
  let feeOwedA = "0";
  let feeOwedB = "0";
  let rewardOweds = [];
  let feeEventFound = false;
  for (const ev of events) {
    const evObj = ev;
    const type = typeof evObj.type === "string" ? evObj.type : "";
    const pj = evObj.parsedJson && typeof evObj.parsedJson === "object" ? evObj.parsedJson : null;
    if (!pj) continue;
    if (type.includes("FetchPositionFeesEvent")) {
      feeOwedA = readU64(pj.fee_owned_a);
      feeOwedB = readU64(pj.fee_owned_b);
      feeEventFound = true;
    } else if (type.includes("FetchPositionRewardsEvent")) {
      const data = Array.isArray(pj.data) ? pj.data : [];
      rewardOweds = data.map(readU64);
    }
  }
  if (!feeEventFound) {
    return {
      ok: false,
      error: `FetchPositionFeesEvent not found in devInspect events (total events: ${events.length})`
    };
  }
  return { ok: true, feeOwedA, feeOwedB, rewardOweds };
}
async function fetchCetusAccruedFees(client, input) {
  const tA = normType2(input.coinTypeA);
  const tB = normType2(input.coinTypeB);
  if (!tA || !tB) {
    return { ok: false, error: "Missing coin type args" };
  }
  let walletSender = DEVINSPECT_SENDER2;
  if (input.sender) {
    try {
      walletSender = normalizeSuiAddress8(input.sender);
    } catch {
      walletSender = DEVINSPECT_SENDER2;
    }
  }
  const core = {
    positionId: input.positionId,
    poolId: input.poolId,
    coinTypeA: tA,
    coinTypeB: tB
  };
  const attempts = [walletSender];
  if (walletSender !== DEVINSPECT_SENDER2) attempts.push(DEVINSPECT_SENDER2);
  let lastErr = "all devInspect attempts failed";
  for (const sender of attempts) {
    const r = await devInspectCetusOnce(client, core, sender);
    if (r.ok) return r;
    lastErr = r.error;
  }
  return { ok: false, error: lastErr };
}

// src/services/cetusService.ts
import Decimal6 from "decimal.js";
import BN4 from "bn.js";
var CETUS_POSITION_TYPE = `${PROTOCOL_PACKAGES.CETUS_CLMM}::position::Position`;
var MAX_SANE_POSITION_USD3 = 5e7;
var MAX_SANE_HUMAN_TOKENS3 = 1e18;
var STABLECOIN_SYMS_CETUS = /* @__PURE__ */ new Set([
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "TUSD",
  "FDUSD",
  "PYUSD",
  "USDD",
  "FRAX",
  "LUSD",
  "SUSD",
  "GUSD"
]);
function symbolFromCoinType2(ct) {
  const parts = ct.split("::");
  return parts[2] ?? parts[1] ?? "\u2014";
}
function normTypeSafe2(raw) {
  try {
    return normalizeStructTag6(raw.trim());
  } catch {
    return null;
  }
}
function normId(id) {
  try {
    return normalizeSuiAddress9(id.trim());
  } catch {
    return id.trim();
  }
}
function unwrapStruct(val) {
  if (!val || typeof val !== "object") return null;
  const obj = val;
  if (obj.fields != null && typeof obj.fields === "object") {
    return obj.fields;
  }
  return obj;
}
function parseTypeName(val) {
  if (typeof val === "string") {
    const s2 = val.trim();
    if (!s2) return null;
    return normTypeSafe2(s2.startsWith("0x") ? s2 : `0x${s2}`);
  }
  const fields = unwrapStruct(val);
  if (!fields) return null;
  const name = fields.name;
  if (typeof name !== "string") return null;
  const s = name.trim();
  if (!s) return null;
  return normTypeSafe2(s.startsWith("0x") ? s : `0x${s}`);
}
function parseUID(val) {
  if (typeof val === "string") return val.trim();
  const f = unwrapStruct(val);
  if (!f) return "";
  const inner = f.id;
  if (typeof inner === "string") return inner.trim();
  const innerFields = unwrapStruct(inner);
  if (!innerFields) return "";
  if (typeof innerFields.bytes === "string") return innerFields.bytes.trim();
  if (typeof innerFields.id === "string") return innerFields.id.trim();
  return "";
}
function readI32(val) {
  let bits;
  if (val != null && typeof val === "object") {
    const fields = unwrapStruct(val) ?? val;
    bits = Number(fields.bits ?? 0);
  } else {
    bits = Number(val ?? 0);
  }
  if (!Number.isFinite(bits)) return 0;
  return bits > 2147483647 ? bits - 4294967296 : bits;
}
function clampUsd2(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v <= MAX_SANE_POSITION_USD3 ? v : 0;
}
function safeHumanFromBnRaw2(rawBn, decimals) {
  try {
    const raw = rawBn.toString(10);
    if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
    const d = new Decimal6(raw).div(new Decimal6(10).pow(decimals));
    const n2 = d.toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS3) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function safeHumanFromStringRaw(raw, decimals) {
  const s = raw?.trim();
  if (!s || !/^\d+$/.test(s)) return 0;
  try {
    return safeHumanFromBnRaw2(new BN4(s, 10), decimals);
  } catch {
    return 0;
  }
}
function spotPriceSafe(raw) {
  if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8) return null;
  return raw;
}
function positionFieldsOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const f = raw;
  if (f.liquidity != null && f.pool != null) return f;
  const nft = f.nft;
  if (nft) {
    const inner = nft.fields ?? nft;
    if (inner.liquidity != null && inner.pool != null) return inner;
  }
  return null;
}
async function fetchPositionNFTs(wallet) {
  const results = [];
  let cursor = void 0;
  let hasMore = true;
  while (hasMore) {
    const page = await suiClient.getOwnedObjects({
      owner: wallet,
      filter: { StructType: CETUS_POSITION_TYPE },
      options: { showContent: true, showType: true },
      cursor,
      limit: 50
    });
    for (const item of page.data) {
      const obj = item.data;
      if (!obj?.objectId || obj.content?.dataType !== "moveObject") continue;
      const rawFields = obj.content.fields;
      const f = positionFieldsOf(rawFields);
      if (!f) {
        console.warn("[cetus] position NFT has unknown field layout, objectId:", obj.objectId, "| raw keys:", rawFields && typeof rawFields === "object" ? Object.keys(rawFields) : String(rawFields));
        continue;
      }
      const liquidity = String(f.liquidity ?? "0");
      if (liquidity === "0") continue;
      const coinTypeA = parseTypeName(f.coin_type_a);
      const coinTypeB = parseTypeName(f.coin_type_b);
      if (!coinTypeA || !coinTypeB) {
        console.warn("[cetus] position has null coin types, id:", obj.objectId, "| coin_type_a:", f.coin_type_a, "coin_type_b:", f.coin_type_b);
        continue;
      }
      const poolId = typeof f.pool === "string" ? normId(f.pool) : "";
      if (!poolId) {
        console.warn("[cetus] position has no pool id, id:", obj.objectId, "| pool field:", f.pool);
        continue;
      }
      results.push({
        objectId: normId(obj.objectId),
        poolId,
        coinTypeA,
        coinTypeB,
        liquidity,
        lowerTick: readI32(f.tick_lower_index),
        upperTick: readI32(f.tick_upper_index)
      });
    }
    cursor = page.nextCursor;
    hasMore = page.hasNextPage && !!cursor;
  }
  return results;
}
function poolFieldsOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const f = raw;
  if (f.current_sqrt_price != null) return f;
  if (f.fields != null && typeof f.fields === "object") {
    const inner = f.fields;
    if (inner.current_sqrt_price != null) return inner;
  }
  return null;
}
async function fetchPools2(poolIds) {
  const map = /* @__PURE__ */ new Map();
  if (!poolIds.length) return map;
  const objs = await suiClient.multiGetObjects({
    ids: poolIds,
    options: { showContent: true }
  });
  for (const item of objs) {
    const obj = item?.data;
    if (!obj?.objectId || obj.content?.dataType !== "moveObject") continue;
    const key = normId(obj.objectId);
    const rawFields = obj.content.fields;
    const f = poolFieldsOf(rawFields);
    if (!f) {
      console.warn("[cetus] fetchPools: no current_sqrt_price in pool", key, "raw keys:", rawFields && typeof rawFields === "object" ? Object.keys(rawFields) : String(rawFields));
      continue;
    }
    const pmFields = unwrapStruct(f.position_manager);
    const positionsRaw = pmFields?.positions;
    const posFields = unwrapStruct(positionsRaw);
    const posHandle = parseUID(posFields?.id ?? pmFields?.positions_handle);
    if (!posHandle) {
      console.warn("[cetus] posHandle empty for pool", key, "| pmFields:", JSON.stringify(pmFields), "| posFields:", JSON.stringify(posFields));
      continue;
    }
    const rmFields = unwrapStruct(f.rewarder_manager);
    const rewardersList = Array.isArray(rmFields?.rewarders) ? rmFields.rewarders : [];
    const rewarderCoinTypes = [];
    for (const rew of rewardersList) {
      const rewFields = unwrapStruct(rew);
      const ct = parseTypeName(rewFields?.reward_coin ?? rew?.reward_coin);
      rewarderCoinTypes.push(ct ?? "");
    }
    const feeRateRaw = Number(f.fee_rate ?? 0);
    map.set(key, {
      sqrtPriceStr: String(f.current_sqrt_price),
      currentTick: readI32(f.current_tick_index),
      feeRate: Number.isFinite(feeRateRaw) ? feeRateRaw / 1e6 : 0,
      positionsHandle: normId(posHandle),
      rewarderCoinTypes
    });
  }
  return map;
}
async function getCetusPositions(walletAddress, options) {
  let positions;
  try {
    positions = await fetchPositionNFTs(walletAddress);
  } catch (e) {
    console.warn("[cetus] fetchPositionNFTs failed", e);
    return [];
  }
  if (!positions.length) return [];
  const uniquePoolIds = [...new Set(positions.map((p) => p.poolId))];
  let poolMap;
  try {
    poolMap = await fetchPools2(uniquePoolIds);
  } catch (e) {
    console.warn("[cetus] fetchPools failed", e);
    return [];
  }
  const allCoinTypes = /* @__PURE__ */ new Set();
  for (const pos of positions) {
    allCoinTypes.add(pos.coinTypeA);
    allCoinTypes.add(pos.coinTypeB);
  }
  for (const pool of poolMap.values()) {
    for (const ct of pool.rewarderCoinTypes) {
      if (ct) allCoinTypes.add(ct);
    }
  }
  const metaMap = await (async () => {
    const mm = /* @__PURE__ */ new Map();
    await mapPool([...allCoinTypes], RPC_CONCURRENCY, async (ct) => {
      try {
        const m = await suiClient.getCoinMetadata({ coinType: ct });
        mm.set(ct, {
          symbol: m?.symbol ?? symbolFromCoinType2(ct),
          decimals: m?.decimals ?? 0,
          iconUrl: typeof m?.iconUrl === "string" && m.iconUrl.startsWith("https://") ? m.iconUrl : null
        });
      } catch {
        mm.set(ct, { symbol: symbolFromCoinType2(ct), decimals: 0, iconUrl: null });
      }
    });
    return mm;
  })();
  const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType2(ct), decimals: 0, iconUrl: null };
  const spotOpts = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  let spotsMap;
  try {
    spotsMap = await resolveSpots(
      [...allCoinTypes],
      (ct) => getMeta(ct).symbol,
      spotOpts
    );
  } catch {
    spotsMap = /* @__PURE__ */ new Map();
  }
  const openedAt = Math.floor(Date.now() / 1e3);
  const out = [];
  for (const pos of positions) {
    const pool = poolMap.get(pos.poolId);
    if (!pool) continue;
    const metaA = getMeta(pos.coinTypeA);
    const metaB = getMeta(pos.coinTypeB);
    const { decimals: decA, symbol: symA, iconUrl: iconA } = metaA;
    const { decimals: decB, symbol: symB, iconUrl: iconB } = metaB;
    const liqBn = /^\d+$/.test(pos.liquidity) ? new BN4(pos.liquidity, 10) : new BN4(0);
    const curSqrtBn = /^\d+$/.test(pool.sqrtPriceStr) && pool.sqrtPriceStr !== "0" ? new BN4(pool.sqrtPriceStr, 10) : new BN4(0);
    let humA = 0;
    let humB = 0;
    if (!liqBn.isZero() && !curSqrtBn.isZero()) {
      try {
        const lowerSqrt = TickMath4.tickIndexToSqrtPriceX64(pos.lowerTick);
        const upperSqrt = TickMath4.tickIndexToSqrtPriceX64(pos.upperTick);
        const { coinA, coinB } = Utils4.getCoinAmountFromLiquidity(
          liqBn,
          curSqrtBn,
          lowerSqrt,
          upperSqrt,
          false
        );
        humA = safeHumanFromBnRaw2(coinA, decA);
        humB = safeHumanFromBnRaw2(coinB, decB);
      } catch {
      }
    }
    const pxaF = spotPriceSafe(spotsMap.get(pos.coinTypeA)?.price);
    const pxbF = spotPriceSafe(spotsMap.get(pos.coinTypeB)?.price);
    const valueUsd = clampUsd2(
      (pxaF != null ? humA * pxaF : 0) + (pxbF != null ? humB * pxbF : 0)
    );
    const priceInRange = pool.currentTick >= pos.lowerTick && pool.currentTick <= pos.upperTick;
    const lifecycleStatus = resolveLifecycleStatus(pos.liquidity);
    const feeLabelPct = `${(pool.feeRate * 100).toFixed(3)}%`;
    const pair = `${symA}/${symB} \xB7 ${feeLabelPct}${priceInRange && lifecycleStatus !== "empty" ? "" : " \xB7 OUT"}`;
    out.push({
      id: pos.objectId,
      protocol: "cetus",
      poolId: pos.poolId,
      pair,
      tokenA: symA,
      tokenB: symB,
      tokenAAddress: pos.coinTypeA,
      tokenBAddress: pos.coinTypeB,
      tokenAIconUrl: iconA,
      tokenBIconUrl: iconB,
      tokenADecimals: decA,
      tokenBDecimals: decB,
      fee: pool.feeRate,
      tickLower: pos.lowerTick,
      tickUpper: pos.upperTick,
      currentTick: pool.currentTick,
      currentSqrtPrice: pool.sqrtPriceStr,
      liquidity: pos.liquidity,
      lifecycleStatus,
      status: resolveRangeStatus(priceInRange, lifecycleStatus),
      tokenAAmount: humA,
      tokenBAmount: humB,
      currentPriceA_USD: pxaF ?? 0,
      currentPriceB_USD: pxbF ?? 0,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      // Fees + rewards populated by step 7 (devInspect) below
      unclaimedFeeA: 0,
      unclaimedFeeB: 0,
      unclaimedFeeUSD: 0,
      unclaimedRewardUSD: 0,
      openedAt,
      daysOpen: 0,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: 0
    });
  }
  await mapPool(out, RPC_CONCURRENCY, async (p) => {
    const pool = poolMap.get(p.poolId ?? "");
    const result = await fetchCetusAccruedFees(suiClient, {
      positionId: p.id,
      poolId: p.poolId ?? "",
      coinTypeA: p.tokenAAddress,
      coinTypeB: p.tokenBAddress,
      sender: walletAddress
    });
    if (!result.ok) {
      console.warn("[cetus-accrued] failed for pos", p.id.slice(0, 10), "|", result.error);
      return;
    }
    const { feeOwedA, feeOwedB, rewardOweds } = result;
    const decA = p.tokenADecimals;
    const decB = p.tokenBDecimals;
    const pxaF = spotPriceSafe(spotsMap.get(p.tokenAAddress)?.price);
    const pxbF = spotPriceSafe(spotsMap.get(p.tokenBAddress)?.price);
    const feeHumA = safeHumanFromStringRaw(feeOwedA, decA);
    const feeHumB = safeHumanFromStringRaw(feeOwedB, decB);
    let feeUsd = 0;
    if (pxaF != null) feeUsd += feeHumA * pxaF;
    if (pxbF != null) feeUsd += feeHumB * pxbF;
    feeUsd = clampUsd2(feeUsd);
    let rewUsd = 0;
    if (pool) {
      for (let i = 0; i < rewardOweds.length; i++) {
        const rawAmt = rewardOweds[i];
        if (!rawAmt || rawAmt === "0") continue;
        const rewCt = pool.rewarderCoinTypes[i];
        if (!rewCt) continue;
        const rewMeta = metaMap.get(rewCt) ?? { symbol: symbolFromCoinType2(rewCt), decimals: 9, iconUrl: null };
        const hum = safeHumanFromStringRaw(rawAmt, rewMeta.decimals);
        const pxRf = spotPriceSafe(spotsMap.get(rewCt)?.price);
        if (pxRf != null) rewUsd += clampUsd2(hum * pxRf);
      }
      rewUsd = clampUsd2(rewUsd);
    }
    p.unclaimedFeeA = feeHumA;
    p.unclaimedFeeB = feeHumB;
    p.unclaimedFeeUSD = feeUsd;
    p.unclaimedRewardUSD = rewUsd;
  });
  for (const p of out) {
    const aIsStable = STABLECOIN_SYMS_CETUS.has(p.tokenA.toUpperCase());
    const bIsStable = STABLECOIN_SYMS_CETUS.has(p.tokenB.toUpperCase());
    p.cetusOriginalDecimalsA = p.tokenADecimals;
    p.cetusOriginalDecimalsB = p.tokenBDecimals;
    if (!aIsStable || bIsStable) continue;
    const sqBig = BigInt(p.currentSqrtPrice || "0");
    const invertedSq = sqBig > 0n ? (2n ** 128n / sqBig).toString() : "0";
    const a = {
      tokenA: p.tokenA,
      tokenB: p.tokenB,
      tokenAAddress: p.tokenAAddress,
      tokenBAddress: p.tokenBAddress,
      tokenAIconUrl: p.tokenAIconUrl,
      tokenBIconUrl: p.tokenBIconUrl,
      tokenADecimals: p.tokenADecimals,
      tokenBDecimals: p.tokenBDecimals,
      tokenAAmount: p.tokenAAmount,
      tokenBAmount: p.tokenBAmount,
      currentPriceA_USD: p.currentPriceA_USD,
      currentPriceB_USD: p.currentPriceB_USD,
      unclaimedFeeA: p.unclaimedFeeA,
      unclaimedFeeB: p.unclaimedFeeB,
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      currentTick: p.currentTick
    };
    p.tokenA = a.tokenB;
    p.tokenB = a.tokenA;
    p.tokenAAddress = a.tokenBAddress;
    p.tokenBAddress = a.tokenAAddress;
    p.tokenAIconUrl = a.tokenBIconUrl;
    p.tokenBIconUrl = a.tokenAIconUrl;
    p.tokenADecimals = a.tokenBDecimals;
    p.tokenBDecimals = a.tokenADecimals;
    p.tokenAAmount = a.tokenBAmount;
    p.tokenBAmount = a.tokenAAmount;
    p.currentPriceA_USD = a.currentPriceB_USD;
    p.currentPriceB_USD = a.currentPriceA_USD;
    p.unclaimedFeeA = a.unclaimedFeeB;
    p.unclaimedFeeB = a.unclaimedFeeA;
    p.tickLower = -a.tickUpper;
    p.tickUpper = -a.tickLower;
    p.currentTick = -a.currentTick;
    p.currentSqrtPrice = invertedSq;
    p.cetusSwapped = true;
    const feeLabelPct = `${(p.fee * 100).toFixed(3)}%`;
    p.pair = `${p.tokenA}/${p.tokenB} \xB7 ${feeLabelPct}${p.status === "in_range" ? "" : " \xB7 OUT"}`;
  }
  return out;
}

// src/services/cetusDlmmService.ts
import { BinUtils, FEE_PRECISION } from "@cetusprotocol/dlmm-sdk";

// src/services/cetusDlmmSdk.ts
import { CetusDlmmSDK } from "@cetusprotocol/dlmm-sdk";
var cached = null;
function getCetusDlmmSdk() {
  if (cached) return cached;
  cached = CetusDlmmSDK.createSDK({ env: "mainnet" });
  return cached;
}

// src/services/coinBalanceAmount.ts
import Decimal7 from "decimal.js";
var MAX_COIN_DECIMALS = 18;
function amountsFromCoinMetadata(totalBalance, decimals) {
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > MAX_COIN_DECIMALS) {
    return { decimals: 0, humanBalance: 0, decimalsKnown: false };
  }
  let humanBalance;
  try {
    humanBalance = new Decimal7(totalBalance).div(new Decimal7(10).pow(decimals)).toNumber();
  } catch {
    return { decimals, humanBalance: 0, decimalsKnown: false };
  }
  if (!Number.isFinite(humanBalance)) {
    return { decimals, humanBalance: 0, decimalsKnown: false };
  }
  return { decimals, humanBalance, decimalsKnown: true };
}

// src/utils/rpcBackoff.ts
async function withRpcBackoff(fn, opts = {}) {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 700;
  const maxTotalWaitMs = opts.maxTotalWaitMs ?? 18e3;
  const retryOn = /429|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|503|502|FetchError|fetch failed|rate limit|Too Many|too frequent|Unexpected status code/i;
  let last;
  let waited = 0;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!retryOn.test(msg) || i === retries) break;
      let wait = baseMs * 2 ** i + Math.floor(Math.random() * 350);
      if (waited + wait > maxTotalWaitMs) wait = Math.max(0, maxTotalWaitMs - waited);
      if (wait <= 0) break;
      waited += wait;
      if (opts.label) {
        console.warn(
          `[rpc-backoff] ${opts.label} attempt ${i + 1}/${retries + 1} wait ${wait}ms: ${msg.slice(0, 140)}`
        );
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// src/services/coinMetadata.ts
var METADATA_FALLBACK_RPCS = DASHBOARD_RPC_FALLBACK_URLS.filter(
  (url) => !url.includes("blastapi.io")
);
var resolvedMetaCache = /* @__PURE__ */ new Map();
var hardcodedByType = new Map(
  HARDCODED_VERIFIED.map((coin) => [normalizeCoinTypeForMatch(coin.type), coin])
);
function hardcodedCoinMeta(coinType) {
  const coin = hardcodedByType.get(normalizeCoinTypeForMatch(coinType));
  if (!coin) return null;
  const amounts = amountsFromCoinMetadata("0", coin.decimals);
  if (!amounts.decimalsKnown) return null;
  return {
    decimals: amounts.decimals,
    name: coin.name,
    symbol: coin.symbol,
    description: "",
    iconUrl: coin.iconUrl || null
  };
}
function usableMeta(meta) {
  if (!meta) return null;
  const amounts = amountsFromCoinMetadata("0", meta.decimals);
  if (!amounts.decimalsKnown) return null;
  return {
    decimals: amounts.decimals,
    name: meta.name ?? "",
    symbol: meta.symbol ?? "",
    description: meta.description ?? "",
    iconUrl: meta.iconUrl || null
  };
}
function parseMetadataResponse(body) {
  if (!body || typeof body !== "object") return null;
  const result = body.result;
  if (!result || typeof result !== "object") return null;
  return usableMeta(result);
}
async function fetchCoinMetadataFallback(coinType) {
  for (const url of METADATA_FALLBACK_RPCS) {
    try {
      const response = await fetch(extFetchUrl(url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "suix_getCoinMetadata",
          params: [coinType]
        }),
        signal: AbortSignal.timeout(8e3)
      });
      if (!response.ok) continue;
      const parsed = parseMetadataResponse(await response.json());
      if (parsed) return parsed;
    } catch {
    }
  }
  return null;
}
async function resolveCoinMetadata(client, coinType, options) {
  const cached2 = resolvedMetaCache.get(coinType);
  if (cached2 !== void 0) return cached2;
  const fromClient = usableMeta(
    await withRpcBackoff(
      () => client.getCoinMetadata({ coinType }),
      { label: "wallet-coin-meta", retries: 3, baseMs: 450, maxTotalWaitMs: 1e4 }
    ).catch(() => null)
  );
  if (fromClient) {
    resolvedMetaCache.set(coinType, fromClient);
    return fromClient;
  }
  const known = hardcodedCoinMeta(coinType);
  if (known) {
    resolvedMetaCache.set(coinType, known);
    return known;
  }
  if (options?.allowNetworkFallback === false) {
    resolvedMetaCache.set(coinType, null);
    return null;
  }
  const fromFallback = await fetchCoinMetadataFallback(coinType);
  resolvedMetaCache.set(coinType, fromFallback);
  return fromFallback;
}

// src/services/cetusDlmmService.ts
import Decimal8 from "decimal.js";
var MAX_SANE_POSITION_USD4 = 5e7;
var MAX_SANE_HUMAN_TOKENS4 = 1e18;
var STABLECOIN_SYMS = /* @__PURE__ */ new Set([
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "TUSD",
  "FDUSD",
  "PYUSD",
  "USDD",
  "FRAX",
  "LUSD",
  "SUSD",
  "GUSD"
]);
function symbolFromCoinType3(ct) {
  const parts = ct.split("::");
  return parts[2] ?? parts[1] ?? "\u2014";
}
function clampUsd3(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v <= MAX_SANE_POSITION_USD4 ? v : 0;
}
function safeHumanFromStringRaw2(raw, decimals) {
  const s = raw?.trim();
  if (!s || !/^\d+$/.test(s) || !Number.isFinite(decimals) || decimals < 0) return 0;
  try {
    const n2 = new Decimal8(s).div(new Decimal8(10).pow(decimals)).toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS4) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function spotPriceSafe2(raw) {
  if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8) return null;
  return raw;
}
function binPriceBPerA(binId, binStep, decimalsA, decimalsB) {
  try {
    const n2 = Number(BinUtils.getPriceFromBinId(binId, binStep, decimalsA, decimalsB));
    return Number.isFinite(n2) && n2 > 0 ? n2 : 0;
  } catch {
    return 0;
  }
}
function feeFractionFromRaw(raw) {
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const n2 = Number(raw) / FEE_PRECISION;
  return Number.isFinite(n2) && n2 >= 0 ? n2 : 0;
}
async function getCetusDlmmPositions(walletAddress, options) {
  const sdk2 = getCetusDlmmSdk();
  sdk2.setSenderAddress(walletAddress);
  let rows;
  try {
    rows = await sdk2.Position.getOwnerPositionList(walletAddress);
  } catch (e) {
    console.warn("[cetus-dlmm] getOwnerPositionList failed", e);
    return [];
  }
  if (!rows.length) return [];
  const poolCache = /* @__PURE__ */ new Map();
  const feeCache = /* @__PURE__ */ new Map();
  const allCoinTypes = /* @__PURE__ */ new Set();
  for (const pos of rows) {
    allCoinTypes.add(pos.coin_type_a);
    allCoinTypes.add(pos.coin_type_b);
  }
  const metaMap = /* @__PURE__ */ new Map();
  await mapPool([...allCoinTypes], RPC_CONCURRENCY, async (ct) => {
    const m = await resolveCoinMetadata(suiClient, ct);
    if (!m) return;
    metaMap.set(ct, {
      symbol: m.symbol || symbolFromCoinType3(ct),
      decimals: m.decimals,
      iconUrl: m.iconUrl
    });
  });
  const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType3(ct), decimals: -1, iconUrl: null };
  const spotOpts = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  let spotsMap;
  try {
    spotsMap = await resolveSpots([...allCoinTypes], (ct) => getMeta(ct).symbol, spotOpts);
  } catch {
    spotsMap = /* @__PURE__ */ new Map();
  }
  const openedAt = Math.floor(Date.now() / 1e3);
  const out = [];
  const feeFetchOpts = [];
  for (const pos of rows) {
    try {
      let pool = poolCache.get(pos.pool_id);
      if (!pool) {
        pool = await sdk2.Pool.getPool(pos.pool_id);
        poolCache.set(pos.pool_id, pool);
      }
      const metaA = getMeta(pos.coin_type_a);
      const metaB = getMeta(pos.coin_type_b);
      const decA = metaA.decimals;
      const decB = metaB.decimals;
      if (decA < 0 || decB < 0) continue;
      const amounts = await sdk2.Position.getPositionAmounts(pos, pool);
      const humA = safeHumanFromStringRaw2(amounts.amount_a, decA);
      const humB = safeHumanFromStringRaw2(amounts.amount_b, decB);
      const pxaF = spotPriceSafe2(spotsMap.get(pos.coin_type_a)?.price);
      const pxbF = spotPriceSafe2(spotsMap.get(pos.coin_type_b)?.price);
      const valueUsd = clampUsd3((pxaF != null ? humA * pxaF : 0) + (pxbF != null ? humB * pxbF : 0));
      let feeFrac = feeCache.get(pos.pool_id);
      if (feeFrac == null) {
        try {
          const fr = await sdk2.Pool.getTotalFeeRate({
            pool_id: pool.id,
            coin_type_a: pos.coin_type_a,
            coin_type_b: pos.coin_type_b
          });
          feeFrac = feeFractionFromRaw(fr.total_fee_rate);
        } catch {
          feeFrac = feeFractionFromRaw(pool.base_fee_rate);
        }
        feeCache.set(pos.pool_id, feeFrac);
      }
      const priceLo = binPriceBPerA(pos.lower_bin_id, pool.bin_step, decA, decB);
      const priceHi = binPriceBPerA(pos.upper_bin_id, pool.bin_step, decA, decB);
      const priceCur = binPriceBPerA(pool.active_id, pool.bin_step, decA, decB);
      if (!(priceLo > 0) || !(priceHi > 0) || !(priceCur > 0)) continue;
      const inRange = pool.active_id >= pos.lower_bin_id && pool.active_id <= pos.upper_bin_id;
      const feeLabelPct = `${(feeFrac * 100).toFixed(3)}%`;
      const pair = `${metaA.symbol}/${metaB.symbol} \xB7 DLMM \xB7 ${feeLabelPct}${inRange ? "" : " \xB7 OUT"}`;
      const rewardCoins = (pool.reward_manager?.rewards ?? []).map((r) => r.reward_coin).filter((c) => typeof c === "string" && c.length > 0);
      feeFetchOpts.push({
        pool_id: pool.id,
        position_id: pos.id,
        reward_coins: rewardCoins,
        coin_type_a: pos.coin_type_a,
        coin_type_b: pos.coin_type_b
      });
      out.push({
        id: pos.id,
        protocol: "cetus",
        poolId: pos.pool_id,
        pair,
        tokenA: metaA.symbol,
        tokenB: metaB.symbol,
        tokenAAddress: pos.coin_type_a,
        tokenBAddress: pos.coin_type_b,
        tokenAIconUrl: metaA.iconUrl,
        tokenBIconUrl: metaB.iconUrl,
        tokenADecimals: decA,
        tokenBDecimals: decB,
        fee: feeFrac,
        // Bins are not CLMM ticks — range bar uses priceRangeOverride.
        tickLower: pos.lower_bin_id,
        tickUpper: pos.upper_bin_id,
        currentTick: pool.active_id,
        currentSqrtPrice: "0",
        liquidity: pos.liquidity_shares?.[0] ?? "0",
        status: inRange ? "in_range" : "out_of_range",
        tokenAAmount: humA,
        tokenBAmount: humB,
        currentPriceA_USD: pxaF ?? 0,
        currentPriceB_USD: pxbF ?? 0,
        currentValueUSD: valueUsd,
        depositedUSD: 0,
        pnlUSD: 0,
        pnlPct: 0,
        unclaimedFeeA: 0,
        unclaimedFeeB: 0,
        unclaimedFeeUSD: 0,
        unclaimedRewardUSD: 0,
        openedAt,
        daysOpen: 0,
        lifetimeEarningsUSD: 0,
        vsHodlDeltaUSD: 0,
        aprEstimatePct: 0,
        priceCurrentOverride: priceCur,
        priceRangeOverride: {
          min: Math.min(priceLo, priceHi),
          max: Math.max(priceLo, priceHi),
          current: priceCur
        },
        cetusDlmm: {
          lowerBinId: pos.lower_bin_id,
          upperBinId: pos.upper_bin_id,
          activeBinId: pool.active_id,
          binStep: pool.bin_step
        }
      });
    } catch (e) {
      console.warn("[cetus-dlmm] position map failed", pos.id?.slice?.(0, 10), e);
    }
  }
  if (feeFetchOpts.length > 0) {
    try {
      const { feeData, rewardData } = await sdk2.Position.fetchPositionFeeAndReward(feeFetchOpts);
      for (const p of out) {
        const fee = feeData[p.id];
        const rew = rewardData[p.id];
        const feeHumA = safeHumanFromStringRaw2(fee?.fee_owned_a, p.tokenADecimals);
        const feeHumB = safeHumanFromStringRaw2(fee?.fee_owned_b, p.tokenBDecimals);
        const pxaF = spotPriceSafe2(spotsMap.get(p.tokenAAddress)?.price);
        const pxbF = spotPriceSafe2(spotsMap.get(p.tokenBAddress)?.price);
        let feeUsd = 0;
        if (pxaF != null) feeUsd += feeHumA * pxaF;
        if (pxbF != null) feeUsd += feeHumB * pxbF;
        p.unclaimedFeeA = feeHumA;
        p.unclaimedFeeB = feeHumB;
        p.unclaimedFeeUSD = clampUsd3(feeUsd);
        const rows2 = [];
        let rewUsd = 0;
        for (const r of rew?.rewards ?? []) {
          const ct = r.coin_type;
          const meta = getMeta(ct);
          const hum = safeHumanFromStringRaw2(r.reward_owned, meta.decimals);
          const spot = spotsMap.get(ct);
          const px = spotPriceSafe2(spot?.price);
          const amountUsd = px != null ? clampUsd3(hum * px) : 0;
          rewUsd += amountUsd;
          rows2.push({
            token: meta.symbol || symbolFromCoinType3(ct),
            coinType: ct,
            amount: hum,
            amount_usd: amountUsd,
            price_source: px != null ? String(spot?.priceSource ?? "spot") : "unavailable"
          });
        }
        p.unclaimedRewardUSD = clampUsd3(rewUsd);
        p.unclaimedRewardRows = rows2;
      }
    } catch (e) {
      console.warn("[cetus-dlmm] fetchPositionFeeAndReward failed", e);
    }
  }
  for (const p of out) {
    const aIsStable = STABLECOIN_SYMS.has(p.tokenA.toUpperCase());
    const bIsStable = STABLECOIN_SYMS.has(p.tokenB.toUpperCase());
    p.cetusOriginalDecimalsA = p.tokenADecimals;
    p.cetusOriginalDecimalsB = p.tokenBDecimals;
    if (!aIsStable || bIsStable) continue;
    const a = {
      tokenA: p.tokenA,
      tokenB: p.tokenB,
      tokenAAddress: p.tokenAAddress,
      tokenBAddress: p.tokenBAddress,
      tokenAIconUrl: p.tokenAIconUrl,
      tokenBIconUrl: p.tokenBIconUrl,
      tokenADecimals: p.tokenADecimals,
      tokenBDecimals: p.tokenBDecimals,
      tokenAAmount: p.tokenAAmount,
      tokenBAmount: p.tokenBAmount,
      currentPriceA_USD: p.currentPriceA_USD,
      currentPriceB_USD: p.currentPriceB_USD,
      unclaimedFeeA: p.unclaimedFeeA,
      unclaimedFeeB: p.unclaimedFeeB,
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      currentTick: p.currentTick
    };
    p.tokenA = a.tokenB;
    p.tokenB = a.tokenA;
    p.tokenAAddress = a.tokenBAddress;
    p.tokenBAddress = a.tokenAAddress;
    p.tokenAIconUrl = a.tokenBIconUrl;
    p.tokenBIconUrl = a.tokenAIconUrl;
    p.tokenADecimals = a.tokenBDecimals;
    p.tokenBDecimals = a.tokenADecimals;
    p.tokenAAmount = a.tokenBAmount;
    p.tokenBAmount = a.tokenAAmount;
    p.currentPriceA_USD = a.currentPriceB_USD;
    p.currentPriceB_USD = a.currentPriceA_USD;
    p.unclaimedFeeA = a.unclaimedFeeB;
    p.unclaimedFeeB = a.unclaimedFeeA;
    p.tickLower = -a.tickUpper;
    p.tickUpper = -a.tickLower;
    p.currentTick = -a.currentTick;
    p.cetusSwapped = true;
    const ov = p.priceRangeOverride;
    if (ov && ov.min > 0 && ov.max > 0 && ov.current > 0) {
      const invMin = 1 / ov.max;
      const invMax = 1 / ov.min;
      const invCur = 1 / ov.current;
      p.priceRangeOverride = { min: invMin, max: invMax, current: invCur };
      p.priceCurrentOverride = invCur;
    }
    const feeLabelPct = `${(p.fee * 100).toFixed(3)}%`;
    p.pair = `${p.tokenA}/${p.tokenB} \xB7 DLMM \xB7 ${feeLabelPct}${p.status === "in_range" ? "" : " \xB7 OUT"}`;
  }
  return out;
}

// src/services/cetusVaultsService.ts
import BN5 from "bn.js";
import Decimal10 from "decimal.js";
import { TickMath as TickMath5, Utils as Utils5 } from "@mmt-finance/clmm-sdk";
import { normalizeStructTag as normalizeStructTag9, normalizeSuiAddress as normalizeSuiAddress11 } from "@mysten/sui/utils";

// src/services/objectVersionCache.ts
function asRpcObjectClient(client) {
  return client;
}
var CHUNK2 = 50;
function normId2(id) {
  const t = id.trim().toLowerCase();
  return t.startsWith("0x") ? t : `0x${t}`;
}
var ObjectVersionCache = class {
  map = /* @__PURE__ */ new Map();
  get(id) {
    return this.map.get(normId2(id));
  }
  hasContent(id) {
    const hit = this.get(id);
    return hit != null && hit.content != null;
  }
  put(data) {
    if (!data.objectId || data.content == null) return;
    this.map.set(normId2(data.objectId), {
      objectId: data.objectId,
      version: String(data.version),
      digest: data.digest,
      type: data.type,
      content: data.content
    });
  }
  putResponses(res) {
    for (const r of res) {
      if (r.data?.content != null) this.put(r.data);
    }
  }
  toResponse(id) {
    const hit = this.get(id);
    if (!hit) return null;
    return { data: hit };
  }
  clear() {
    this.map.clear();
  }
  size() {
    return this.map.size;
  }
};
var shared3 = null;
function getObjectVersionCache() {
  if (!shared3) shared3 = new ObjectVersionCache();
  return shared3;
}
async function multiGetChunked(client, ids, options) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK2) {
    const part = ids.slice(i, i + CHUNK2);
    const res = await client.multiGetObjects({ ids: part, options });
    out.push(...res);
  }
  return out;
}
async function multiGetObjectsHydrated(client, ids, opts) {
  if (!ids.length) return [];
  const cache3 = getObjectVersionCache();
  const showType = opts?.showType !== false;
  const showContent = opts?.showContent !== false;
  const incremental = opts?.incremental === true;
  if (!incremental) {
    const res = await multiGetChunked(client, ids, { showContent, showType });
    cache3.putResponses(res);
    return res;
  }
  const needFull = [];
  const versionCheck = [];
  for (const id of ids) {
    if (cache3.hasContent(id)) versionCheck.push(id);
    else needFull.push(id);
  }
  if (versionCheck.length) {
    const versionRes = await multiGetChunked(client, versionCheck, { showContent: false, showType: false });
    for (const r of versionRes) {
      const id = r.data?.objectId;
      if (!id) continue;
      const ver = r.data?.version != null ? String(r.data.version) : "";
      const cached2 = cache3.get(id);
      if (!cached2 || cached2.version !== ver) needFull.push(id);
    }
  }
  const uniqueFull = [...new Set(needFull.map(normId2))];
  const fullRes = uniqueFull.length ? await multiGetChunked(client, uniqueFull, { showContent: true, showType }) : [];
  cache3.putResponses(fullRes);
  const byId = /* @__PURE__ */ new Map();
  for (const r of fullRes) {
    if (r.data?.objectId) byId.set(normId2(r.data.objectId), r);
  }
  return ids.map((id) => {
    const key = normId2(id);
    const fresh = byId.get(key);
    if (fresh) return fresh;
    return cache3.toResponse(key) ?? { data: null };
  });
}

// src/utils/cetusVault.ts
import Decimal9 from "decimal.js";
var CETUS_VAULTS_POOL_HANDLE = "0x9036bcc5aa7fd2cceec1659a6a1082871f45bc400c743f50063363457d1738bd";
function shareLiquidityByLpAmount(lpTokenRaw, vaultLiquidity, totalSupply) {
  if (totalSupply === "0" || totalSupply === "") return "0";
  try {
    const out = new Decimal9(lpTokenRaw || "0").mul(vaultLiquidity || "0").div(totalSupply).toFixed(0, Decimal9.ROUND_DOWN);
    return out === "" ? "0" : out;
  } catch {
    return "0";
  }
}
function typeArguments(structType) {
  const lt = structType.indexOf("<");
  const gt = structType.lastIndexOf(">");
  if (lt < 0 || gt <= lt) return [];
  const inner = structType.slice(lt + 1, gt);
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "<") {
      depth++;
      cur += ch;
    } else if (ch === ">") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      const t = cur.trim();
      if (t) out.push(t);
      cur = "";
    } else {
      cur += ch;
    }
  }
  const last = cur.trim();
  if (last) out.push(last);
  return out;
}
function firstTypeArgument(structType) {
  return typeArguments(structType)[0] ?? null;
}
function vaultLpSharePct(lpTokenRaw, totalSupply) {
  if (!totalSupply || totalSupply === "0") return null;
  try {
    const pct2 = new Decimal9(lpTokenRaw || "0").div(totalSupply).mul(100).toNumber();
    return Number.isFinite(pct2) && pct2 >= 0 ? pct2 : null;
  } catch {
    return null;
  }
}
function vaultFarmRewardAprPct(opts) {
  const { vaultTvlUsd, vaultTotalSupply, farmLpStakedRaw, emissions } = opts;
  if (!(vaultTvlUsd > 0) || !vaultTotalSupply || vaultTotalSupply === "0") return null;
  if (!farmLpStakedRaw || farmLpStakedRaw === "0") return null;
  try {
    const farmTvl = new Decimal9(vaultTvlUsd).mul(farmLpStakedRaw).div(vaultTotalSupply);
    if (farmTvl.lte(0)) return null;
    const secYear = new Decimal9(365).mul(86400);
    let usdPerYear = new Decimal9(0);
    for (const e of emissions) {
      if (!(e.priceUsd > 0) || !e.ratePerSec || e.ratePerSec === "0") continue;
      const humanPerSec = new Decimal9(e.ratePerSec).div(new Decimal9(10).pow(e.decimals));
      usdPerYear = usdPerYear.plus(humanPerSec.mul(secYear).mul(e.priceUsd));
    }
    if (usdPerYear.lte(0)) return null;
    const apr = usdPerYear.div(farmTvl).mul(100).toNumber();
    return Number.isFinite(apr) && apr >= 0 ? apr : null;
  } catch {
    return null;
  }
}
function dynamicFieldChildId(item) {
  const name = item.name;
  const nameType = name && typeof name === "object" && "type" in name ? String(name.type ?? "") : "";
  const fromName = (() => {
    if (typeof name === "string" && name.startsWith("0x")) return name;
    if (!name || typeof name !== "object") return null;
    const n2 = name;
    if (typeof n2.value === "string" && n2.value.startsWith("0x")) return n2.value;
    if (n2.value && typeof n2.value === "object") {
      const v = n2.value;
      if (typeof v.id === "string" && v.id.startsWith("0x")) return v.id;
    }
    return null;
  })();
  if (/::object::ID$/i.test(nameType) && fromName) return fromName;
  if (typeof item.objectId === "string" && item.objectId.startsWith("0x")) return item.objectId;
  return fromName;
}

// src/services/vaultLpStakeService.ts
import { normalizeStructTag as normalizeStructTag7 } from "@mysten/sui/utils";

// src/utils/haedalVault.ts
var HAEDAL_VAULTS_V2_POOLS_HANDLE = "0xc88e97a3a3bb71dfcf8cc90e6383d7e3e1dee0170fa07c9365d233568659fc8f";
var VAULT_LP_INCENTIVE_PACKAGE = "0xd5b301aae5f5bbd01d7cc067efd1ea27f566aaa2f62e504aac60dd0062ebfd97";
var VAULT_LP_INCENTIVE_DEPOSIT_INFO = `${VAULT_LP_INCENTIVE_PACKAGE}::core::DepositInfo`;
var VAULT_LP_INCENTIVE_ACC = 2n ** 64n;

// src/services/vaultLpStakeService.ts
var STAKE_CACHE_TTL_MS = 45e3;
var stakeCache = null;
function currentRewardRate(cfg, nowSec) {
  const changeAt = readU642(cfg.rate_change_at);
  return nowSec < changeAt ? readU642(cfg.reward_rate_before) : readU642(cfg.reward_rate_after);
}
function unwrap(val) {
  if (!val || typeof val !== "object") return null;
  const o = val;
  if (o.fields && typeof o.fields === "object") return o.fields;
  return o;
}
function normType3(raw) {
  try {
    const s = raw.trim();
    const with0x3 = s.startsWith("0x") ? s : `0x${s}`;
    return normalizeStructTag7(with0x3);
  } catch {
    return null;
  }
}
function addRaw(a, b) {
  try {
    return (BigInt(a || "0") + BigInt(b || "0")).toString();
  } catch {
    return a || "0";
  }
}
function readU642(v) {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return BigInt(Math.floor(v));
  return 0n;
}
function readTypeName(v) {
  if (typeof v === "string") return normType3(v);
  const f = unwrap(v);
  if (typeof f?.name === "string") return normType3(f.name);
  return null;
}
function symbolFromCoinType4(ct) {
  const parts = ct.split("::");
  return parts[2] ?? parts[1] ?? "REWARD";
}
function vecMapEntries(raw) {
  const f = unwrap(raw);
  const contents = f?.contents;
  if (!Array.isArray(contents)) return [];
  const out = [];
  for (const item of contents) {
    const row = unwrap(item);
    if (!row) continue;
    out.push({ key: row.key, value: row.value });
  }
  return out;
}
function emittedBetween(fromSec, toSec, rateChangeAt, rateBefore, rateAfter) {
  if (toSec <= fromSec) return 0n;
  const rateAt = (t) => t < rateChangeAt ? rateBefore : rateAfter;
  if (fromSec >= rateChangeAt || toSec <= rateChangeAt) {
    return rateAt(fromSec) * (toSec - fromSec);
  }
  return rateBefore * (rateChangeAt - fromSec) + rateAfter * (toSec - rateChangeAt);
}
function updatedPerShare(cfg, totalShare, nowSec) {
  const ps = readU642(cfg.per_share);
  if (totalShare <= 0n) return ps;
  const last = readU642(cfg.last_update_time);
  const changeAt = readU642(cfg.rate_change_at);
  const rateBefore = readU642(cfg.reward_rate_before);
  const rateAfter = readU642(cfg.reward_rate_after);
  const emitted = emittedBetween(last, nowSec, changeAt, rateBefore, rateAfter);
  if (emitted <= 0n) return ps;
  return ps + emitted * VAULT_LP_INCENTIVE_ACC / totalShare;
}
async function getStakedVaultLpByType(owner) {
  const ownerKey = owner.toLowerCase();
  if (stakeCache && stakeCache.owner === ownerKey && Date.now() - stakeCache.at < STAKE_CACHE_TTL_MS) {
    return new Map(stakeCache.map);
  }
  const out = /* @__PURE__ */ new Map();
  const depositIds = [];
  let cursor;
  do {
    const page = await withRpcBackoff(
      () => suiClient.getOwnedObjects({
        owner,
        cursor: cursor ?? void 0,
        limit: 50,
        filter: { StructType: VAULT_LP_INCENTIVE_DEPOSIT_INFO },
        options: { showType: true, showContent: true }
      }),
      { label: "vault-stake-owned", retries: 3, baseMs: 700 }
    );
    for (const item of page.data ?? []) {
      const type = item.data?.type ?? "";
      const lpType = firstTypeArgument(type);
      const fields = unwrap(
        item.data?.content?.fields
      );
      const depositRaw = fields?.deposit;
      const depositId = typeof depositRaw === "string" ? depositRaw : typeof depositRaw === "object" && depositRaw && typeof depositRaw.id === "string" ? depositRaw.id : null;
      const normLp = lpType ? normType3(lpType) : null;
      if (!normLp || !depositId || !/^0x[0-9a-fA-F]+$/.test(depositId)) continue;
      depositIds.push({ lpType: normLp, depositId });
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  if (!depositIds.length) {
    stakeCache = { at: Date.now(), owner: ownerKey, map: out };
    return out;
  }
  const uniqueIds = [...new Set(depositIds.map((d) => d.depositId))];
  const objs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), uniqueIds);
  const amountByDeposit = /* @__PURE__ */ new Map();
  for (const item of objs) {
    const id = item?.data?.objectId;
    const content = item?.data?.content;
    if (!id || content?.dataType !== "moveObject") continue;
    const f = unwrap(content.fields);
    const amount = typeof f?.amount === "string" ? f.amount : null;
    if (!amount || !/^\d+$/.test(amount)) continue;
    amountByDeposit.set(id, amount);
  }
  for (const meta of depositIds) {
    const amount = amountByDeposit.get(meta.depositId);
    if (!amount) continue;
    out.set(meta.lpType, addRaw(out.get(meta.lpType) ?? "0", amount));
  }
  stakeCache = { at: Date.now(), owner: ownerKey, map: out };
  return new Map(out);
}
function mergeLpBalances(freeByType, stakedByType) {
  const out = new Map(freeByType);
  for (const [ct, raw] of stakedByType) {
    out.set(ct, addRaw(out.get(ct) ?? "0", raw));
  }
  return out;
}
async function getVaultStakeIncentiveSnapshot(owner) {
  const byLpPending = /* @__PURE__ */ new Map();
  const byLpFarm = /* @__PURE__ */ new Map();
  const infos = [];
  let cursor;
  do {
    const page = await withRpcBackoff(
      () => suiClient.getOwnedObjects({
        owner,
        cursor: cursor ?? void 0,
        limit: 50,
        filter: { StructType: VAULT_LP_INCENTIVE_DEPOSIT_INFO },
        options: { showType: true, showContent: true }
      }),
      { label: "vault-stake-rewards-owned", retries: 3, baseMs: 700 }
    );
    for (const item of page.data ?? []) {
      const type = item.data?.type ?? "";
      const lpType = firstTypeArgument(type);
      const fields = unwrap(
        item.data?.content?.fields
      );
      const depositRaw = fields?.deposit;
      const depositId = typeof depositRaw === "string" ? depositRaw : typeof depositRaw === "object" && depositRaw && typeof depositRaw.id === "string" ? depositRaw.id : null;
      const poolRaw = fields?.pool;
      const poolId = typeof poolRaw === "string" ? poolRaw : typeof poolRaw === "object" && poolRaw && typeof poolRaw.id === "string" ? poolRaw.id : null;
      const normLp = lpType ? normType3(lpType) : null;
      if (!normLp || !depositId || !poolId) continue;
      infos.push({ lpType: normLp, depositId, poolId });
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  if (!infos.length) return { byLpPending, byLpFarm };
  const objIds = [...new Set(infos.flatMap((i) => [i.depositId, i.poolId]))];
  const objs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), objIds, {
    incremental: false,
    showType: true
  });
  const byId = /* @__PURE__ */ new Map();
  for (const item of objs) {
    const id = item?.data?.objectId;
    const content = item?.data?.content;
    if (!id || content?.dataType !== "moveObject") continue;
    const f = unwrap(content.fields);
    if (f) byId.set(id, f);
  }
  const nowSec = BigInt(Math.floor(Date.now() / 1e3));
  const metaCache = /* @__PURE__ */ new Map();
  async function rewardMeta(coinType) {
    const hit = metaCache.get(coinType);
    if (hit) return hit;
    try {
      const m = await suiClient.getCoinMetadata({ coinType });
      const row = {
        symbol: m?.symbol ?? symbolFromCoinType4(coinType),
        decimals: typeof m?.decimals === "number" ? m.decimals : 9
      };
      metaCache.set(coinType, row);
      return row;
    } catch {
      const row = { symbol: symbolFromCoinType4(coinType), decimals: 9 };
      metaCache.set(coinType, row);
      return row;
    }
  }
  for (const info of infos) {
    const deposit = byId.get(info.depositId);
    const pool = byId.get(info.poolId);
    if (!deposit || !pool) continue;
    const share = readU642(deposit.share);
    const depositLpAmount = readU642(deposit.amount);
    const totalShare = readU642(pool.total_share);
    const sharePerLp = depositLpAmount > 0n && share >= depositLpAmount ? share / depositLpAmount : 1000n;
    const lpStakedRaw = sharePerLp > 0n ? totalShare / sharePerLp : 0n;
    const debts = /* @__PURE__ */ new Map();
    for (const e of vecMapEntries(deposit.debts)) {
      const ct = readTypeName(e.key);
      if (!ct) continue;
      debts.set(ct, readU642(e.value));
    }
    const pendingRows = [];
    const emissions = [];
    for (const e of vecMapEntries(pool.reward_configs)) {
      const rewardType = readTypeName(e.key);
      const cfg = unwrap(e.value);
      if (!rewardType || !cfg) continue;
      const meta = await rewardMeta(rewardType);
      const rate = currentRewardRate(
        {
          rate_change_at: cfg.rate_change_at,
          reward_rate_before: cfg.reward_rate_before,
          reward_rate_after: cfg.reward_rate_after
        },
        nowSec
      );
      if (rate > 0n) {
        emissions.push({
          rewardCoinType: rewardType,
          symbol: meta.symbol,
          decimals: meta.decimals,
          ratePerSec: rate.toString()
        });
      }
      if (share <= 0n) continue;
      const ps = updatedPerShare(
        {
          per_share: cfg.per_share,
          last_update_time: cfg.last_update_time,
          rate_change_at: cfg.rate_change_at,
          reward_rate_before: cfg.reward_rate_before,
          reward_rate_after: cfg.reward_rate_after
        },
        totalShare,
        nowSec
      );
      if (ps <= 0n) continue;
      const accrued = share * ps / VAULT_LP_INCENTIVE_ACC;
      const debt = debts.get(rewardType) ?? 0n;
      const pending = accrued > debt ? accrued - debt : 0n;
      if (pending <= 0n) continue;
      const amount = Number(pending) / 10 ** meta.decimals;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      pendingRows.push({
        lpCoinType: info.lpType,
        rewardCoinType: rewardType,
        symbol: meta.symbol,
        amountRaw: pending.toString(),
        amount
      });
    }
    if (!byLpFarm.has(info.lpType)) {
      byLpFarm.set(info.lpType, {
        lpCoinType: info.lpType,
        totalShare: totalShare.toString(),
        lpStakedRaw: lpStakedRaw.toString(),
        sharePerLp: sharePerLp.toString(),
        emissions
      });
    }
    if (!pendingRows.length) continue;
    const prev = byLpPending.get(info.lpType) ?? [];
    byLpPending.set(info.lpType, [...prev, ...pendingRows]);
  }
  return { byLpPending, byLpFarm };
}

// src/services/cetusPoolStats.ts
import { normalizeStructTag as normalizeStructTag8, normalizeSuiAddress as normalizeSuiAddress10 } from "@mysten/sui/utils";
var STATS_URL = "https://api-sui.cetus.zone/v2/sui/stats_pools?limit=200";
var CACHE_TTL_MS2 = 5 * 6e4;
var HAEDAL_VAULT_PERFORMANCE_FEE = 0.16;
var STABLE_SYMBOLS2 = /* @__PURE__ */ new Set([
  "USDC",
  "USDT",
  "USDCsui",
  "USDCeth",
  "suiUSDT",
  "USDY",
  "AUSD",
  "FDUSD",
  "TUSD",
  "USDD"
]);
var cache = null;
var inflight = null;
function normPoolId(id) {
  try {
    return normalizeSuiAddress10(id);
  } catch {
    return null;
  }
}
function normCoinType2(ct) {
  try {
    return normalizeStructTag8(ct);
  } catch {
    return null;
  }
}
function parseFractionToPct(raw) {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw <= 5 ? raw * 100 : raw;
  }
  if (typeof raw === "string") {
    const s = raw.trim().replace(/%$/, "");
    const n2 = Number(s);
    if (!Number.isFinite(n2) || n2 < 0) return null;
    return n2 <= 5 ? n2 * 100 : n2;
  }
  return null;
}
function parseCoin(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const type = typeof o.address === "string" ? normCoinType2(o.address) : null;
  const symbol = typeof o.symbol === "string" ? o.symbol : "";
  const balance = typeof o.balance === "number" ? o.balance : Number(o.balance);
  if (!type || !symbol || !(balance > 0) || !Number.isFinite(balance)) return null;
  return { type, symbol, balance };
}
async function loadStats() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS2) {
    return { byPool: cache.byPool, rows: cache.rows };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const url = typeof window !== "undefined" ? extFetchUrl(STATS_URL) : STATS_URL;
    const res = await fetch(url, {
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error(`cetus stats_pools HTTP ${res.status}`);
    const body = await res.json();
    const list = body?.data?.lp_list;
    const byPool = /* @__PURE__ */ new Map();
    const rows = [];
    if (!Array.isArray(list)) {
      cache = { at: Date.now(), byPool, rows };
      return { byPool, rows };
    }
    for (const row of list) {
      if (row.is_closed === true) continue;
      const addr = typeof row.address === "string" ? normPoolId(row.address) : null;
      if (!addr) continue;
      const aprObj = row.apr;
      const feeRaw = aprObj && typeof aprObj === "object" ? aprObj.fee_apr_24h : void 0;
      const feeApr24hPct = parseFractionToPct(feeRaw);
      const tvlRaw = row.pure_tvl_in_usd;
      const pureTvlUsd = typeof tvlRaw === "number" ? tvlRaw : typeof tvlRaw === "string" ? Number(tvlRaw) : 0;
      const tvl = Number.isFinite(pureTvlUsd) && pureTvlUsd > 0 ? pureTvlUsd : 0;
      if (feeApr24hPct != null) {
        byPool.set(addr, {
          poolId: addr,
          feeApr24hPct,
          pureTvlUsd: tvl
        });
      }
      const volRaw = row.vol_in_usd_24h;
      const volUsd24h = typeof volRaw === "number" ? volRaw : typeof volRaw === "string" ? Number(volRaw) : 0;
      const vol = Number.isFinite(volUsd24h) && volUsd24h > 0 ? volUsd24h : 0;
      const coinA = parseCoin(row.coin_a);
      const coinB = parseCoin(row.coin_b);
      const price = typeof row.price === "number" ? row.price : Number(row.price);
      if (!coinA || !coinB || !(price > 0) || !Number.isFinite(price)) continue;
      rows.push({
        poolId: addr,
        feeApr24hPct: feeApr24hPct ?? 0,
        pureTvlUsd: tvl,
        volUsd24h: vol,
        price,
        coinA,
        coinB
      });
    }
    cache = { at: Date.now(), byPool, rows };
    return { byPool, rows };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
async function loadFeeAprByPool() {
  const { byPool } = await loadStats();
  return byPool;
}
async function getCetusPoolFeeAprPct(poolId) {
  const id = normPoolId(poolId);
  if (!id) return null;
  try {
    const map = await loadFeeAprByPool();
    return map.get(id)?.feeApr24hPct ?? null;
  } catch (e) {
    console.warn("[cetus-pool-stats]", e);
    return null;
  }
}
async function getCetusVaultFeeAprPct(poolIds, opts) {
  const options = Array.isArray(opts) ? { weightsUsd: opts } : opts ?? {};
  const ids = [...new Set(poolIds.map(normPoolId).filter((x) => !!x))];
  if (!ids.length) return null;
  try {
    const map = await loadFeeAprByPool();
    let wSum = 0;
    let acc = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const row = map.get(id);
      if (!row) continue;
      const wRaw = options.weightsUsd?.[i];
      const w = typeof wRaw === "number" && Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 1;
      wSum += w;
      acc += row.feeApr24hPct * w;
    }
    if (!(wSum > 0)) return null;
    let apr = acc / wSum;
    const fee = typeof options.performanceFeeFrac === "number" && Number.isFinite(options.performanceFeeFrac) && options.performanceFeeFrac >= 0 && options.performanceFeeFrac < 1 ? options.performanceFeeFrac : 0;
    if (fee > 0) apr = apr * (1 - fee);
    if (options.asVaultApy) {
    }
    return Number.isFinite(apr) && apr >= 0 ? apr : null;
  } catch (e) {
    console.warn("[cetus-pool-stats] vault", e);
    return null;
  }
}
function isStableSymbol2(sym) {
  return STABLE_SYMBOLS2.has(sym) || STABLE_SYMBOLS2.has(sym.toUpperCase());
}
async function getCetusStatsUsdByCoinType(coinTypes) {
  const wanted = /* @__PURE__ */ new Map();
  for (const ct of coinTypes) {
    const n2 = normCoinType2(ct);
    if (n2) wanted.set(n2, ct);
  }
  const out = /* @__PURE__ */ new Map();
  if (!wanted.size) return out;
  try {
    const { rows } = await loadStats();
    const priced = /* @__PURE__ */ new Map();
    const setPx = (type, usd, score) => {
      if (!(usd > 0) || !Number.isFinite(usd) || !(score > 0)) return;
      const prev = priced.get(type);
      if (!prev || score >= prev.score) priced.set(type, { usd, score });
    };
    for (const r of rows) {
      if (isStableSymbol2(r.coinA.symbol)) setPx(r.coinA.type, 1, 1e15);
      if (isStableSymbol2(r.coinB.symbol)) setPx(r.coinB.type, 1, 1e15);
    }
    const sorted = [...rows].sort(
      (a, b) => b.volUsd24h - a.volUsd24h || b.pureTvlUsd - a.pureTvlUsd
    );
    for (const r of sorted) {
      const score = Math.max(r.volUsd24h, r.pureTvlUsd * 0.05);
      if (score < 5e3) continue;
      const aSym = r.coinA.symbol;
      const bSym = r.coinB.symbol;
      const aStable = isStableSymbol2(aSym);
      const bStable = isStableSymbol2(bSym);
      const aSui = aSym.toUpperCase() === "SUI";
      const bSui = bSym.toUpperCase() === "SUI";
      if (aStable && bSui) {
        setPx(r.coinB.type, 1 / r.price, score);
      } else if (bStable && aSui) {
        setPx(r.coinA.type, r.price, score);
      }
    }
    for (let pass = 0; pass < 6; pass++) {
      let progressed = false;
      for (const r of sorted) {
        const score = Math.max(r.volUsd24h, r.pureTvlUsd * 0.05);
        if (score < 1e3) continue;
        const ha = priced.has(r.coinA.type);
        const hb = priced.has(r.coinB.type);
        if (ha === hb) continue;
        if (ha && !hb) {
          const pxA = priced.get(r.coinA.type).usd;
          const pxB = r.coinA.balance / r.coinB.balance * pxA;
          setPx(r.coinB.type, pxB, score);
          progressed = true;
        } else if (hb && !ha) {
          const pxB = priced.get(r.coinB.type).usd;
          const pxA = r.coinB.balance / r.coinA.balance * pxB;
          setPx(r.coinA.type, pxA, score);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    for (const [norm2, orig] of wanted) {
      const hit = priced.get(norm2);
      if (hit) out.set(orig, hit.usd);
    }
    return out;
  } catch (e) {
    console.warn("[cetus-pool-stats] usd", e);
    return out;
  }
}
async function overlayCetusStatsSpots(spots, coinTypes) {
  const usd = await getCetusStatsUsdByCoinType(coinTypes);
  for (const [ct, price] of usd) {
    const prev = spots.get(ct);
    const sym = ct.includes("::") ? ct.slice(ct.lastIndexOf("::") + 2) : "";
    const prefer = isStableSymbol2(sym) || sym.toUpperCase() === "SUI" || prev?.price == null;
    if (!prefer) continue;
    spots.set(ct, {
      price,
      change24h: prev?.change24h ?? null,
      change5m: prev?.change5m ?? null,
      change1h: prev?.change1h ?? null,
      priceSource: "cetus"
    });
  }
}

// src/services/cetusVaultsService.ts
var MAX_SANE_POSITION_USD5 = 5e7;
var MAX_SANE_HUMAN_TOKENS5 = 1e18;
var VAULT_LIST_TTL_MS = 60 * 6e4;
var vaultListCache = null;
function unwrap2(val) {
  if (!val || typeof val !== "object") return null;
  const o = val;
  if (o.fields && typeof o.fields === "object") return o.fields;
  return o;
}
function parseUid(val) {
  if (typeof val === "string" && val.startsWith("0x")) return val;
  const f = unwrap2(val);
  if (typeof f?.id === "string") return f.id;
  return null;
}
function readI322(val) {
  let bits;
  if (val != null && typeof val === "object") {
    const fields = unwrap2(val) ?? val;
    bits = Number(fields.bits ?? 0);
  } else {
    bits = Number(val ?? 0);
  }
  if (!Number.isFinite(bits)) return 0;
  return bits > 2147483647 ? bits - 4294967296 : bits;
}
function normType4(raw) {
  try {
    const s = raw.trim();
    const with0x3 = s.startsWith("0x") ? s : `0x${s}`;
    return normalizeStructTag9(with0x3);
  } catch {
    return null;
  }
}
function parseTypeName2(val) {
  if (typeof val === "string") return normType4(val);
  const f = unwrap2(val);
  if (typeof f?.name === "string") return normType4(f.name);
  return null;
}
function symbolFromCoinType5(ct) {
  const parts = ct.split("::");
  return parts[2] ?? parts[1] ?? "\u2014";
}
function clampUsd4(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v <= MAX_SANE_POSITION_USD5 ? v : 0;
}
function humanFromRaw2(raw, decimals) {
  try {
    if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
    const n2 = new Decimal10(raw).div(new Decimal10(10).pow(decimals)).toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS5) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function parseFarmsNft(raw) {
  const f = unwrap2(raw);
  if (!f) return null;
  if (f.value != null && f.clmm_postion == null && f.clmm_position == null) {
    return parseFarmsNft(f.value);
  }
  const clmm = unwrap2(f.clmm_postion) ?? unwrap2(f.clmm_position);
  if (!clmm) return null;
  const coinA = parseTypeName2(clmm.coin_type_a);
  const coinB = parseTypeName2(clmm.coin_type_b);
  if (!coinA || !coinB) return null;
  return {
    tickLower: readI322(clmm.tick_lower_index),
    tickUpper: readI322(clmm.tick_upper_index),
    coinTypeA: coinA,
    coinTypeB: coinB
  };
}
function parseVaultObject(objectId, typeStr, fields) {
  const f = unwrap2(fields);
  if (!f) return null;
  const id = parseUid(f.id) ?? objectId;
  const poolId = typeof f.pool === "string" ? f.pool : null;
  const liquidity = f.liquidity != null ? String(f.liquidity) : "0";
  const treasury = unwrap2(f.lp_token_treasury);
  const supplyWrap = unwrap2(treasury?.total_supply);
  const totalSupply = supplyWrap?.value != null ? String(supplyWrap.value) : "0";
  const lpFromType = typeStr ? firstTypeArgument(typeStr) : null;
  const lpTokenType = lpFromType ? normType4(lpFromType) : null;
  if (!poolId || !lpTokenType) return null;
  const positions = Array.isArray(f.positions) ? f.positions : [];
  const fromVec = positions.length > 0 ? parseFarmsNft(positions[0]) : null;
  try {
    return {
      id: normalizeSuiAddress11(id),
      poolId: normalizeSuiAddress11(poolId),
      lpTokenType,
      liquidity,
      totalSupply,
      tickLower: fromVec?.tickLower,
      tickUpper: fromVec?.tickUpper,
      coinTypeA: fromVec?.coinTypeA,
      coinTypeB: fromVec?.coinTypeB
    };
  } catch {
    return null;
  }
}
function vaultHasClmm(v) {
  return v.coinTypeA != null && v.coinTypeB != null && v.tickLower != null && v.tickUpper != null;
}
function isWrappedPositionDf(item) {
  const ot = item.objectType ?? "";
  const name = item.name;
  const nt = name && typeof name === "object" && "type" in name && typeof name.type === "string" ? name.type : "";
  return /::pool::WrappedPositionNFT/.test(ot) || /::vaults::PositionKey/.test(nt);
}
function coinsFromVaultStatusType(objectType) {
  if (!/::vaults::VaultStatus</.test(objectType)) return null;
  const args = typeArguments(objectType);
  if (args.length < 2) return null;
  const coinTypeA = normType4(args[0]);
  const coinTypeB = normType4(args[1]);
  if (!coinTypeA || !coinTypeB) return null;
  return { coinTypeA, coinTypeB };
}
async function hydrateVaultClmm(vault) {
  if (vaultHasClmm(vault)) return;
  let cursor;
  const nftIds = [];
  let statusCoins = null;
  do {
    const page = await suiClient.getDynamicFields({
      parentId: vault.id,
      cursor: cursor ?? void 0,
      limit: 50
    });
    for (const item of page.data ?? []) {
      const ot = typeof item.objectType === "string" ? item.objectType : "";
      if (!statusCoins) statusCoins = coinsFromVaultStatusType(ot);
      if (isWrappedPositionDf(item) && typeof item.objectId === "string") {
        nftIds.push(item.objectId);
      }
    }
    cursor = page.hasNextPage ? page.nextCursor ?? null : null;
  } while (cursor);
  if (statusCoins) {
    vault.coinTypeA ??= statusCoins.coinTypeA;
    vault.coinTypeB ??= statusCoins.coinTypeB;
  }
  if (nftIds.length) {
    const objs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), nftIds, {
      incremental: false,
      showType: true
    });
    for (const item of objs) {
      const content = item?.data?.content;
      if (content?.dataType !== "moveObject") continue;
      const parsed = parseFarmsNft(content.fields);
      if (!parsed) continue;
      vault.tickLower = parsed.tickLower;
      vault.tickUpper = parsed.tickUpper;
      vault.coinTypeA = parsed.coinTypeA;
      vault.coinTypeB = parsed.coinTypeB;
      return;
    }
  }
}
async function listVaults(forceRefresh) {
  if (!forceRefresh && vaultListCache && Date.now() - vaultListCache.at < VAULT_LIST_TTL_MS) {
    return vaultListCache.vaults;
  }
  const ids = [];
  let cursor;
  try {
    do {
      const page = await withRpcBackoff(
        () => suiClient.getDynamicFields({
          parentId: CETUS_VAULTS_POOL_HANDLE,
          cursor: cursor ?? void 0,
          limit: 50
        }),
        { label: "cetus-vault-df", retries: 4, baseMs: 800 }
      );
      for (const item of page.data ?? []) {
        const id = dynamicFieldChildId(item);
        if (id) ids.push(id);
      }
      cursor = page.hasNextPage ? page.nextCursor ?? null : null;
    } while (cursor);
    const unique = [...new Set(ids)];
    const vaults = [];
    for (let i = 0; i < unique.length; i += 50) {
      const chunk = unique.slice(i, i + 50);
      const objs = await withRpcBackoff(
        () => multiGetObjectsHydrated(asRpcObjectClient(suiClient), chunk, {
          incremental: false,
          showType: true
        }),
        { label: "cetus-vaults-multi", retries: 3, baseMs: 700 }
      );
      for (const item of objs) {
        const obj = item?.data;
        const content = obj?.content;
        if (!obj?.objectId || content?.dataType !== "moveObject") continue;
        const parsed = parseVaultObject(obj.objectId, content.type ?? obj.type, content.fields);
        if (parsed) vaults.push(parsed);
      }
    }
    if (vaults.length) {
      vaultListCache = { at: Date.now(), vaults };
      return vaults;
    }
    if (vaultListCache?.vaults.length) return vaultListCache.vaults;
    return [];
  } catch (e) {
    console.warn("[cetus-vaults] listVaults", e);
    if (vaultListCache?.vaults.length) return vaultListCache.vaults;
    throw e;
  }
}
async function getCetusVaultPositions(walletAddress, options) {
  const vaults = await listVaults(false);
  if (!vaults.length) return [];
  const balances = await withRpcBackoff(
    () => suiClient.getAllBalances({ owner: walletAddress }),
    { label: "cetus-vault-balances", retries: 3, baseMs: 600 }
  );
  const freeByType = /* @__PURE__ */ new Map();
  for (const b of balances) {
    const ct = normType4(b.coinType) ?? b.coinType;
    freeByType.set(ct, b.totalBalance);
  }
  let stakedByType = /* @__PURE__ */ new Map();
  let farmByLp = /* @__PURE__ */ new Map();
  try {
    stakedByType = await withRpcBackoff(() => getStakedVaultLpByType(walletAddress), {
      label: "cetus-vault-staked",
      retries: 3,
      baseMs: 700
    });
  } catch (e) {
    console.warn("[cetus-vaults] staked lp", e);
  }
  try {
    const snap = await withRpcBackoff(() => getVaultStakeIncentiveSnapshot(walletAddress), {
      label: "cetus-vault-stake-farm",
      retries: 3,
      baseMs: 700
    });
    farmByLp = snap.byLpFarm;
  } catch (e) {
    console.warn("[cetus-vaults] stake farm", e);
  }
  const balByType = mergeLpBalances(freeByType, stakedByType);
  const held = vaults.filter((v) => {
    const raw = balByType.get(v.lpTokenType) ?? "0";
    try {
      return BigInt(raw) > 0n;
    } catch {
      return false;
    }
  });
  if (!held.length) return [];
  await mapPool(held, RPC_CONCURRENCY, async (v) => {
    try {
      await hydrateVaultClmm(v);
    } catch (e) {
      console.warn("[cetus-vaults] hydrate", v.id, e);
    }
  });
  const ready = held.filter(vaultHasClmm);
  if (!ready.length) return [];
  const poolMap = await fetchPools2(
    [...new Set(ready.map((v) => v.poolId))],
    options?.incremental === true
  );
  const coinTypes = /* @__PURE__ */ new Set();
  for (const v of ready) {
    coinTypes.add(v.coinTypeA);
    coinTypes.add(v.coinTypeB);
    coinTypes.add(v.lpTokenType);
    const farm = farmByLp.get(v.lpTokenType);
    if (farm) for (const e of farm.emissions) coinTypes.add(e.rewardCoinType);
  }
  const metaMap = /* @__PURE__ */ new Map();
  await mapPool([...coinTypes], RPC_CONCURRENCY, async (ct) => {
    try {
      const m = await suiClient.getCoinMetadata({ coinType: ct });
      metaMap.set(ct, {
        symbol: m?.symbol ?? symbolFromCoinType5(ct),
        decimals: m?.decimals ?? 0,
        iconUrl: typeof m?.iconUrl === "string" && m.iconUrl.startsWith("https://") ? m.iconUrl : null
      });
    } catch {
      metaMap.set(ct, { symbol: symbolFromCoinType5(ct), decimals: 0, iconUrl: null });
    }
  });
  const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType5(ct), decimals: 0, iconUrl: null };
  const spotOpts = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  let spots;
  try {
    spots = await resolveSpots([...coinTypes], (ct) => getMeta(ct).symbol, spotOpts);
  } catch {
    spots = /* @__PURE__ */ new Map();
  }
  try {
    await overlayCetusStatsSpots(spots, [...coinTypes]);
  } catch (e) {
    console.warn("[cetus-vaults] cetus spots", e);
  }
  const openedAt = Math.floor(Date.now() / 1e3);
  const out = [];
  for (const v of ready) {
    const pool = poolMap.get(v.poolId);
    if (!pool) continue;
    const stakedRaw = stakedByType.get(v.lpTokenType) ?? "0";
    const lpRaw = balByType.get(v.lpTokenType) ?? "0";
    const shareLiq = shareLiquidityByLpAmount(lpRaw, v.liquidity, v.totalSupply);
    const metaA = getMeta(v.coinTypeA);
    const metaB = getMeta(v.coinTypeB);
    const lpMeta = getMeta(v.lpTokenType);
    let humA = 0;
    let humB = 0;
    const liqBn = /^\d+$/.test(shareLiq) ? new BN5(shareLiq, 10) : new BN5(0);
    const curSqrtBn = /^\d+$/.test(pool.sqrtPriceStr) && pool.sqrtPriceStr !== "0" ? new BN5(pool.sqrtPriceStr, 10) : new BN5(0);
    if (!liqBn.isZero() && !curSqrtBn.isZero()) {
      try {
        const { coinA, coinB } = Utils5.getCoinAmountFromLiquidity(
          liqBn,
          curSqrtBn,
          TickMath5.tickIndexToSqrtPriceX64(v.tickLower),
          TickMath5.tickIndexToSqrtPriceX64(v.tickUpper),
          true
        );
        humA = humanFromRaw2(coinA.toString(10), metaA.decimals);
        humB = humanFromRaw2(coinB.toString(10), metaB.decimals);
      } catch {
      }
    }
    const pxa = spots.get(v.coinTypeA)?.price;
    const pxb = spots.get(v.coinTypeB)?.price;
    const pxaF = typeof pxa === "number" && Number.isFinite(pxa) ? pxa : 0;
    const pxbF = typeof pxb === "number" && Number.isFinite(pxb) ? pxb : 0;
    const valueUsd = clampUsd4(humA * pxaF + humB * pxbF);
    const inRange = pool.currentTick >= v.tickLower && pool.currentTick <= v.tickUpper;
    const feeLabelPct = `${(pool.feeRate * 100).toFixed(3)}%`;
    const sharePct = vaultLpSharePct(lpRaw, v.totalSupply) ?? void 0;
    let vaultTvlUsd;
    if (sharePct != null && sharePct > 0 && valueUsd > 0) {
      vaultTvlUsd = clampUsd4(valueUsd / (sharePct / 100));
    }
    const farm = farmByLp.get(v.lpTokenType);
    const rewardApr = farm && vaultTvlUsd != null && vaultTvlUsd > 0 ? vaultFarmRewardAprPct({
      vaultTvlUsd,
      vaultTotalSupply: v.totalSupply,
      farmLpStakedRaw: farm.lpStakedRaw,
      emissions: farm.emissions.map((e) => {
        const px = spots.get(e.rewardCoinType)?.price;
        const pxF = typeof px === "number" && Number.isFinite(px) ? px : 0;
        return { ratePerSec: e.ratePerSec, decimals: e.decimals, priceUsd: pxF };
      })
    }) : null;
    let vaultFeeApr;
    try {
      vaultFeeApr = await getCetusPoolFeeAprPct(v.poolId);
      if (vaultFeeApr != null && !Number.isFinite(vaultFeeApr)) vaultFeeApr = null;
    } catch {
      vaultFeeApr = null;
    }
    out.push({
      id: v.id,
      protocol: "cetus",
      poolId: v.poolId,
      pair: `${metaA.symbol}/${metaB.symbol} \xB7 vault`,
      tokenA: metaA.symbol,
      tokenB: metaB.symbol,
      tokenAAddress: v.coinTypeA,
      tokenBAddress: v.coinTypeB,
      tokenAIconUrl: metaA.iconUrl,
      tokenBIconUrl: metaB.iconUrl,
      tokenADecimals: metaA.decimals,
      tokenBDecimals: metaB.decimals,
      fee: pool.feeRate,
      tickLower: v.tickLower,
      tickUpper: v.tickUpper,
      currentTick: pool.currentTick,
      currentSqrtPrice: pool.sqrtPriceStr,
      liquidity: shareLiq,
      status: inRange ? "in_range" : "out_of_range",
      tokenAAmount: humA,
      tokenBAmount: humB,
      currentPriceA_USD: pxaF,
      currentPriceB_USD: pxbF,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: 0,
      unclaimedFeeB: 0,
      unclaimedFeeUSD: 0,
      unclaimedRewardUSD: 0,
      openedAt,
      daysOpen: 0,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: vaultFeeApr != null && Number.isFinite(vaultFeeApr) ? vaultFeeApr : 0,
      cetusVault: {
        vaultId: v.id,
        lpTokenType: v.lpTokenType,
        lpTokenRaw: lpRaw,
        lpTokenAmount: humanFromRaw2(lpRaw, lpMeta.decimals || 9),
        stakedLpTokenRaw: stakedRaw !== "0" ? stakedRaw : void 0,
        feeLabel: feeLabelPct,
        vaultTvlUsd,
        sharePct,
        vaultAprPct: vaultFeeApr != null && Number.isFinite(vaultFeeApr) ? vaultFeeApr : void 0,
        rewardAprPct: rewardApr != null && Number.isFinite(rewardApr) ? rewardApr : void 0
      }
    });
  }
  return out;
}

// src/services/haedalVaultsService.ts
import BN6 from "bn.js";
import Decimal11 from "decimal.js";
import { TickMath as TickMath6, Utils as Utils6 } from "@mmt-finance/clmm-sdk";
import { normalizeStructTag as normalizeStructTag10, normalizeSuiAddress as normalizeSuiAddress12 } from "@mysten/sui/utils";

// src/services/haedalOraclePrices.ts
var PRICE_URL = "https://haedal.xyz/api/v1/price/now";
var CACHE_TTL_MS3 = 6e4;
var cache2 = null;
var inflight2 = /* @__PURE__ */ new Map();
function symKey(symbol) {
  return symbol.trim().toUpperCase();
}
async function fetchHaedalUsd(symbol) {
  const key = symKey(symbol);
  if (!key) return null;
  if (cache2 && Date.now() - cache2.at < CACHE_TTL_MS3) {
    const hit = cache2.bySym.get(key);
    if (hit != null) return hit;
  }
  let p = inflight2.get(key);
  if (!p) {
    p = (async () => {
      try {
        const abs = `${PRICE_URL}?symbol=${encodeURIComponent(key)}`;
        const url = typeof window !== "undefined" ? extFetchUrl(abs) : abs;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12e3);
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: ctrl.signal
        }).finally(() => clearTimeout(t));
        if (!res.ok) return null;
        const body = await res.json();
        const n2 = typeof body.price === "number" ? body.price : Number(body.price);
        if (!(n2 > 0) || !Number.isFinite(n2)) return null;
        if (!cache2 || Date.now() - cache2.at >= CACHE_TTL_MS3) {
          cache2 = { at: Date.now(), bySym: /* @__PURE__ */ new Map() };
        }
        cache2.bySym.set(key, n2);
        return n2;
      } catch (e) {
        console.warn("[haedal-price]", key, e);
        return null;
      } finally {
        inflight2.delete(key);
      }
    })();
    inflight2.set(key, p);
  }
  return p;
}
async function overlayHaedalOracleSpots(spots, coinTypes, symbolOf) {
  const wanted = [...new Set(coinTypes.filter(Boolean))];
  await Promise.all(
    wanted.map(async (ct) => {
      const sym = symbolOf(ct);
      if (!sym) return;
      const usd = await fetchHaedalUsd(sym);
      if (usd == null) return;
      const prev = spots.get(ct);
      spots.set(ct, {
        price: usd,
        change24h: prev?.change24h ?? null,
        change5m: prev?.change5m ?? null,
        change1h: prev?.change1h ?? null,
        priceSource: "haedal"
      });
    })
  );
}

// src/services/haedalVaultsService.ts
var MAX_SANE_POSITION_USD6 = 5e7;
var MAX_SANE_HUMAN_TOKENS6 = 1e18;
var VAULT_LIST_TTL_MS2 = 60 * 6e4;
var VAULT_LIST_STORAGE_KEY = "haedal-vaults-v2-registry-v2";
var vaultListCache2 = null;
function vaultToJson(v) {
  return {
    id: v.id,
    lpTokenType: v.lpTokenType,
    totalSupply: v.totalSupply,
    coinTypeA: v.coinTypeA,
    coinTypeB: v.coinTypeB,
    quoteType: v.quoteType,
    lastAum: v.lastAum,
    buffer: [...v.buffer.entries()],
    marketsHandle: v.marketsHandle
  };
}
function vaultFromJson(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  if (typeof o.id !== "string" || typeof o.lpTokenType !== "string") return null;
  if (typeof o.coinTypeA !== "string" || typeof o.coinTypeB !== "string") return null;
  if (typeof o.totalSupply !== "string" || typeof o.marketsHandle !== "string") return null;
  const buffer = /* @__PURE__ */ new Map();
  if (Array.isArray(o.buffer)) {
    for (const row of o.buffer) {
      if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string") {
        buffer.set(row[0], row[1]);
      }
    }
  }
  return {
    id: o.id,
    lpTokenType: o.lpTokenType,
    totalSupply: o.totalSupply,
    coinTypeA: o.coinTypeA,
    coinTypeB: o.coinTypeB,
    quoteType: typeof o.quoteType === "string" ? o.quoteType : void 0,
    lastAum: typeof o.lastAum === "string" ? o.lastAum : "0",
    buffer,
    marketsHandle: o.marketsHandle
  };
}
function readStoredVaultList() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(VAULT_LIST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.at !== "number" || !Array.isArray(parsed.vaults)) return null;
    if (Date.now() - parsed.at > VAULT_LIST_TTL_MS2 * 24) return null;
    const vaults = parsed.vaults.map(vaultFromJson).filter((v) => v != null);
    if (!vaults.length) return null;
    return { at: parsed.at, vaults };
  } catch {
    return null;
  }
}
function writeStoredVaultList(cache3) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      VAULT_LIST_STORAGE_KEY,
      JSON.stringify({ at: cache3.at, vaults: cache3.vaults.map(vaultToJson) })
    );
  } catch {
  }
}
function rememberVaultList(vaults) {
  vaultListCache2 = { at: Date.now(), vaults };
  writeStoredVaultList(vaultListCache2);
  return vaults;
}
function unwrap3(val) {
  if (!val || typeof val !== "object") return null;
  const o = val;
  if (o.fields && typeof o.fields === "object") return o.fields;
  return o;
}
function parseUid2(val) {
  if (typeof val === "string" && val.startsWith("0x")) return val;
  const f = unwrap3(val);
  if (typeof f?.id === "string") return f.id;
  if (typeof f?.bytes === "string") return f.bytes;
  return null;
}
function readI323(val) {
  let bits;
  if (val != null && typeof val === "object") {
    const fields = unwrap3(val) ?? val;
    bits = Number(fields.bits ?? 0);
  } else {
    bits = Number(val ?? 0);
  }
  if (!Number.isFinite(bits)) return 0;
  return bits > 2147483647 ? bits - 4294967296 : bits;
}
function normType5(raw) {
  try {
    const s = raw.trim();
    const with0x3 = s.startsWith("0x") ? s : `0x${s}`;
    return normalizeStructTag10(with0x3);
  } catch {
    return null;
  }
}
function parseTypeName3(val) {
  if (typeof val === "string") return normType5(val);
  const f = unwrap3(val);
  if (typeof f?.name === "string") return normType5(f.name);
  if (typeof f?.pos0 === "string") return parseTypeName3(f.pos0);
  return null;
}
function parseQuoteCoinType(val, coinA, coinB) {
  const direct = parseTypeName3(val);
  if (direct) return direct;
  if (!val || typeof val !== "object") return null;
  const o = val;
  const fields = unwrap3(o.fields) ?? unwrap3(val);
  const fromPos = fields ? parseTypeName3(fields.pos0) : null;
  if (fromPos) return fromPos;
  const variant = typeof o.variant === "string" ? o.variant.toLowerCase() : "";
  if (variant === "base") return coinA;
  if (variant === "quote") return coinB;
  return null;
}
function symbolFromCoinType6(ct) {
  const parts = ct.split("::");
  return parts[2] ?? parts[1] ?? "\u2014";
}
function clampUsd5(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v <= MAX_SANE_POSITION_USD6 ? v : 0;
}
function humanFromRaw3(raw, decimals) {
  try {
    if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
    const n2 = new Decimal11(raw).div(new Decimal11(10).pow(decimals)).toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS6) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function addAmt(map, coin, raw) {
  if (!coin || raw === "0" || raw === "") return;
  const prev = map.get(coin) ?? "0";
  try {
    map.set(coin, (BigInt(prev) + BigInt(raw)).toString());
  } catch {
  }
}
function readBagAmounts(raw) {
  const out = /* @__PURE__ */ new Map();
  const f = unwrap3(raw);
  if (!f) return out;
  const balances = unwrap3(f.balances) ?? f;
  const contents = Array.isArray(balances?.contents) ? balances.contents : Array.isArray(f.contents) ? f.contents : [];
  for (const item of contents) {
    const row = unwrap3(item);
    if (!row) continue;
    const key = parseTypeName3(row.key);
    if (!key || row.value == null) continue;
    addAmt(out, key, String(row.value));
  }
  return out;
}
function parseVaultObject2(objectId, typeStr, fields) {
  const f = unwrap3(fields);
  if (!f) return null;
  const id = parseUid2(f.id) ?? objectId;
  const lpFromType = typeStr ? firstTypeArgument(typeStr) : null;
  const lpTokenType = lpFromType ? normType5(lpFromType) : null;
  const coinA = parseTypeName3(f.coin_type_a);
  const coinB = parseTypeName3(f.coin_type_b);
  const treasury = unwrap3(f.lp_token_treasury);
  const supplyWrap = unwrap3(treasury?.total_supply);
  const totalSupply = supplyWrap?.value != null ? String(supplyWrap.value) : "0";
  const markets = unwrap3(f.markets);
  const marketsHandle = parseUid2(markets?.id);
  if (!lpTokenType || !coinA || !coinB || !marketsHandle) return null;
  try {
    return {
      id: normalizeSuiAddress12(id),
      lpTokenType,
      totalSupply,
      coinTypeA: coinA,
      coinTypeB: coinB,
      quoteType: parseQuoteCoinType(f.quote_type, coinA, coinB) ?? void 0,
      lastAum: f.last_aum != null ? String(f.last_aum) : "0",
      buffer: readBagAmounts(f.buffer_assets),
      marketsHandle: normalizeSuiAddress12(marketsHandle)
    };
  } catch {
    return null;
  }
}
async function listDfObjectIds(parentId) {
  const ids = [];
  let cursor;
  do {
    const page = await withRpcBackoff(
      () => suiClient.getDynamicFields({
        parentId,
        cursor: cursor ?? void 0,
        limit: 50
      }),
      { label: "haedal-df", retries: 5, baseMs: 900 }
    );
    for (const item of page.data ?? []) {
      const id = dynamicFieldChildId(item);
      if (id) ids.push(id);
    }
    cursor = page.hasNextPage ? page.nextCursor ?? null : null;
  } while (cursor);
  return [...new Set(ids)];
}
async function listDfBagObjectIds(parentId) {
  const ids = [];
  let cursor;
  do {
    const page = await withRpcBackoff(
      () => suiClient.getDynamicFields({
        parentId,
        cursor: cursor ?? void 0,
        limit: 50
      }),
      { label: "haedal-df-bag", retries: 5, baseMs: 900 }
    );
    for (const item of page.data ?? []) {
      const id = item.objectId;
      if (typeof id === "string" && id.startsWith("0x")) ids.push(id);
    }
    cursor = page.hasNextPage ? page.nextCursor ?? null : null;
  } while (cursor);
  return [...new Set(ids)];
}
async function listVaults2(forceRefresh) {
  if (!forceRefresh && vaultListCache2 && Date.now() - vaultListCache2.at < VAULT_LIST_TTL_MS2) {
    return vaultListCache2.vaults;
  }
  if (!forceRefresh && !vaultListCache2) {
    const stored = readStoredVaultList();
    if (stored) {
      vaultListCache2 = stored;
      if (Date.now() - stored.at < VAULT_LIST_TTL_MS2) return stored.vaults;
    }
  }
  try {
    const ids = await listDfObjectIds(HAEDAL_VAULTS_V2_POOLS_HANDLE);
    const vaults = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const objs = await withRpcBackoff(
        () => multiGetObjectsHydrated(asRpcObjectClient(suiClient), chunk, {
          incremental: false,
          showType: true
        }),
        { label: "haedal-vaults-multi", retries: 4, baseMs: 800 }
      );
      for (const item of objs) {
        const obj = item?.data;
        const content = obj?.content;
        if (!obj?.objectId || content?.dataType !== "moveObject") continue;
        const parsed = parseVaultObject2(obj.objectId, content.type ?? obj.type, content.fields);
        if (parsed) vaults.push(parsed);
      }
    }
    if (vaults.length) return rememberVaultList(vaults);
    if (vaultListCache2?.vaults.length) return vaultListCache2.vaults;
    const stored = readStoredVaultList();
    if (stored?.vaults.length) {
      vaultListCache2 = stored;
      return stored.vaults;
    }
    return [];
  } catch (e) {
    console.warn("[haedal-vaults] listVaults", e);
    if (vaultListCache2?.vaults.length) return vaultListCache2.vaults;
    const stored = readStoredVaultList();
    if (stored?.vaults.length) {
      vaultListCache2 = stored;
      return stored.vaults;
    }
    throw e;
  }
}
function parseMarketOrPosition(raw, typeStr) {
  const f = unwrap3(raw);
  if (!f) return null;
  if (f.value != null && f.positions == null && f.position == null && f.amounts == null) {
    const inner = unwrap3(f.value) ?? f.value;
    const innerType = inner && typeof inner === "object" && "type" in inner ? String(inner.type ?? "") : typeStr;
    return parseMarketOrPosition(inner, innerType);
  }
  const type = typeStr ?? "";
  const posHandle = parseUid2(unwrap3(f.positions)?.id);
  if (posHandle) {
    return {
      kind: "market",
      positionsHandle: normalizeSuiAddress12(posHandle),
      isClmm: /CLMMMarket/i.test(type)
    };
  }
  const pos = unwrap3(f.position) ?? f;
  const amounts = readBagAmounts(f.amounts);
  const pool = typeof pos.pool === "string" ? pos.pool : typeof pos.pool_id === "string" ? pos.pool_id : void 0;
  const liqRaw = pos.liquidity != null ? String(pos.liquidity) : void 0;
  const tickLower = pos.tick_lower_index != null ? readI323(pos.tick_lower_index) : void 0;
  const tickUpper = pos.tick_upper_index != null ? readI323(pos.tick_upper_index) : void 0;
  const isClmm = tickLower != null && tickUpper != null && liqRaw != null && /^\d+$/.test(liqRaw) && liqRaw !== "0" || /CLMM/i.test(type);
  return {
    kind: "position",
    slice: {
      amounts,
      tickLower,
      tickUpper,
      poolId: pool ? normalizeSuiAddress12(pool) : void 0,
      liquidity: liqRaw && /^\d+$/.test(liqRaw) ? liqRaw : void 0,
      isClmm
    }
  };
}
async function collectVaultAmounts(vault) {
  const bufferByCoin = new Map(vault.buffer);
  const bagByCoin = /* @__PURE__ */ new Map();
  const clmmLegs = [];
  let poolId;
  const poolIds = /* @__PURE__ */ new Set();
  const marketIds = await listDfBagObjectIds(vault.marketsHandle);
  if (!marketIds.length) return { bufferByCoin, bagByCoin, clmmLegs, poolId, poolIds: [] };
  const marketObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), marketIds, {
    incremental: false,
    showType: true
  });
  const posIds = [];
  const ingestPosition = (slice, forceClmm) => {
    const asClmm = slice.isClmm || forceClmm;
    if (asClmm && slice.poolId && slice.liquidity && slice.tickLower != null && slice.tickUpper != null) {
      clmmLegs.push({
        poolId: slice.poolId,
        liquidity: slice.liquidity,
        tickLower: slice.tickLower,
        tickUpper: slice.tickUpper
      });
      poolIds.add(slice.poolId);
      poolId = slice.poolId;
      return;
    }
    for (const [ct, amt] of slice.amounts) addAmt(bagByCoin, ct, amt);
    if (slice.poolId) {
      poolIds.add(slice.poolId);
      poolId = slice.poolId;
    }
  };
  for (const item of marketObjs) {
    const content = item?.data?.content;
    if (content?.dataType !== "moveObject") continue;
    const parsed = parseMarketOrPosition(content.fields, content.type ?? item?.data?.type);
    if (!parsed) continue;
    if (parsed.kind === "market") {
      const childIds = await listDfBagObjectIds(parsed.positionsHandle);
      for (const id of childIds) posIds.push({ id, isClmm: parsed.isClmm });
      continue;
    }
    ingestPosition(parsed.slice, false);
  }
  if (posIds.length) {
    const unique = [...new Set(posIds.map((p) => p.id))];
    const posObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), unique, {
      incremental: false,
      showType: true
    });
    const clmmHint = new Map(posIds.map((p) => [p.id, p.isClmm]));
    for (const item of posObjs) {
      const content = item?.data?.content;
      if (content?.dataType !== "moveObject") continue;
      const parsed = parseMarketOrPosition(content.fields, content.type ?? item?.data?.type);
      if (parsed?.kind !== "position") continue;
      ingestPosition(parsed.slice, clmmHint.get(item?.data?.objectId ?? "") === true);
    }
  }
  return { bufferByCoin, bagByCoin, clmmLegs, poolId, poolIds: [...poolIds] };
}
function clmmRawAmounts(liquidity, sqrtPriceStr, tickLower, tickUpper) {
  try {
    const liqBn = /^\d+$/.test(liquidity) ? new BN6(liquidity, 10) : new BN6(0);
    const curSqrtBn = /^\d+$/.test(sqrtPriceStr) && sqrtPriceStr !== "0" ? new BN6(sqrtPriceStr, 10) : new BN6(0);
    if (liqBn.isZero() || curSqrtBn.isZero()) return null;
    const { coinA, coinB } = Utils6.getCoinAmountFromLiquidity(
      liqBn,
      curSqrtBn,
      TickMath6.tickIndexToSqrtPriceX64(tickLower),
      TickMath6.tickIndexToSqrtPriceX64(tickUpper),
      false
    );
    return { rawA: coinA.toString(10), rawB: coinB.toString(10) };
  } catch {
    return null;
  }
}
async function getHaedalVaultPositions(walletAddress, options) {
  const vaults = await listVaults2(false);
  if (!vaults.length) return [];
  const balances = await withRpcBackoff(
    () => suiClient.getAllBalances({ owner: walletAddress }),
    { label: "haedal-balances", retries: 3, baseMs: 600 }
  );
  const freeByType = /* @__PURE__ */ new Map();
  for (const b of balances) {
    const ct = normType5(b.coinType) ?? b.coinType;
    freeByType.set(ct, b.totalBalance);
  }
  let stakedByType = /* @__PURE__ */ new Map();
  let pendingByLp = /* @__PURE__ */ new Map();
  let farmByLp = /* @__PURE__ */ new Map();
  try {
    stakedByType = await withRpcBackoff(() => getStakedVaultLpByType(walletAddress), {
      label: "haedal-staked",
      retries: 4,
      baseMs: 800
    });
  } catch (e) {
    console.warn("[haedal-vaults] staked lp", e);
  }
  try {
    const snap = await withRpcBackoff(() => getVaultStakeIncentiveSnapshot(walletAddress), {
      label: "haedal-stake-rewards",
      retries: 3,
      baseMs: 800
    });
    pendingByLp = snap.byLpPending;
    farmByLp = snap.byLpFarm;
  } catch (e) {
    console.warn("[haedal-vaults] stake rewards", e);
  }
  const balByType = mergeLpBalances(freeByType, stakedByType);
  const held = vaults.filter((v) => {
    const raw = balByType.get(v.lpTokenType) ?? "0";
    try {
      return BigInt(raw) > 0n;
    } catch {
      return false;
    }
  });
  if (!held.length) return [];
  try {
    const fresh = await withRpcBackoff(
      () => multiGetObjectsHydrated(
        asRpcObjectClient(suiClient),
        held.map((v) => v.id),
        { incremental: false, showType: true }
      ),
      { label: "haedal-held-meta", retries: 3, baseMs: 700 }
    );
    for (let i = 0; i < held.length; i++) {
      const v = held[i];
      const obj = fresh[i]?.data;
      const content = obj?.content;
      if (!obj?.objectId || content?.dataType !== "moveObject") continue;
      const parsed = parseVaultObject2(obj.objectId, content.type ?? obj.type, content.fields);
      if (!parsed) continue;
      v.totalSupply = parsed.totalSupply;
      v.lastAum = parsed.lastAum;
      v.buffer = parsed.buffer;
      v.marketsHandle = parsed.marketsHandle;
      v.quoteType = parsed.quoteType;
    }
  } catch (e) {
    console.warn("[haedal-vaults] held meta", e);
  }
  const slices = /* @__PURE__ */ new Map();
  await mapPool(held, Math.min(2, RPC_CONCURRENCY), async (v) => {
    try {
      slices.set(v.id, await collectVaultAmounts(v));
    } catch (e) {
      console.warn("[haedal-vaults] markets", v.id, e);
      slices.set(v.id, {
        bufferByCoin: new Map(v.buffer),
        bagByCoin: /* @__PURE__ */ new Map(),
        clmmLegs: [],
        poolIds: []
      });
    }
  });
  const allPoolIds = [
    ...new Set(held.flatMap((v) => slices.get(v.id)?.poolIds ?? []))
  ];
  let poolMap = /* @__PURE__ */ new Map();
  if (allPoolIds.length) {
    try {
      poolMap = await fetchPools2(allPoolIds);
    } catch (e) {
      console.warn("[haedal-vaults] fetchPools", e);
    }
  }
  const coinTypes = /* @__PURE__ */ new Set();
  for (const v of held) {
    coinTypes.add(v.coinTypeA);
    coinTypes.add(v.coinTypeB);
    coinTypes.add(v.lpTokenType);
    if (v.quoteType) coinTypes.add(v.quoteType);
    const sl = slices.get(v.id);
    if (sl) {
      for (const ct of sl.bufferByCoin.keys()) coinTypes.add(ct);
      for (const ct of sl.bagByCoin.keys()) coinTypes.add(ct);
    }
    for (const r of pendingByLp.get(v.lpTokenType) ?? []) coinTypes.add(r.rewardCoinType);
    const farm = farmByLp.get(v.lpTokenType);
    if (farm) for (const e of farm.emissions) coinTypes.add(e.rewardCoinType);
  }
  const metaMap = /* @__PURE__ */ new Map();
  await mapPool([...coinTypes], RPC_CONCURRENCY, async (ct) => {
    try {
      const m = await suiClient.getCoinMetadata({ coinType: ct });
      metaMap.set(ct, {
        symbol: m?.symbol ?? symbolFromCoinType6(ct),
        decimals: m?.decimals ?? 0,
        iconUrl: typeof m?.iconUrl === "string" && m.iconUrl.startsWith("https://") ? m.iconUrl : null
      });
    } catch {
      metaMap.set(ct, { symbol: symbolFromCoinType6(ct), decimals: 0, iconUrl: null });
    }
  });
  const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType6(ct), decimals: 0, iconUrl: null };
  const feeAprByVault = /* @__PURE__ */ new Map();
  await mapPool(held, Math.min(4, RPC_CONCURRENCY), async (v) => {
    const sl = slices.get(v.id);
    const ids = sl?.poolIds?.length ? sl.poolIds : sl?.poolId ? [sl.poolId] : [];
    if (!ids.length) return;
    try {
      const apr = await getCetusVaultFeeAprPct(ids, {
        performanceFeeFrac: HAEDAL_VAULT_PERFORMANCE_FEE,
        asVaultApy: true
      });
      if (apr != null) feeAprByVault.set(v.id, apr);
    } catch (e) {
      console.warn("[haedal-vaults] fee apr", v.id.slice(0, 10), e);
    }
  });
  const spotOpts = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  let spots;
  try {
    spots = await resolveSpots([...coinTypes], (ct) => getMeta(ct).symbol, spotOpts);
  } catch {
    spots = /* @__PURE__ */ new Map();
  }
  try {
    await overlayHaedalOracleSpots(spots, [...coinTypes], (ct) => getMeta(ct).symbol);
  } catch (e) {
    console.warn("[haedal-vaults] haedal oracle", e);
  }
  const openedAt = Math.floor(Date.now() / 1e3);
  const out = [];
  for (const v of held) {
    const stakedRaw = stakedByType.get(v.lpTokenType) ?? "0";
    const lpRaw = balByType.get(v.lpTokenType) ?? "0";
    const sl = slices.get(v.id) ?? {
      bufferByCoin: new Map(v.buffer),
      bagByCoin: /* @__PURE__ */ new Map(),
      clmmLegs: [],
      poolIds: []
    };
    const vaultRaw = /* @__PURE__ */ new Map();
    for (const [ct, amt] of sl.bufferByCoin) addAmt(vaultRaw, ct, amt);
    for (const [ct, amt] of sl.bagByCoin) addAmt(vaultRaw, ct, amt);
    for (const leg of sl.clmmLegs) {
      const pool = poolMap.get(leg.poolId);
      if (!pool) continue;
      const raw = clmmRawAmounts(leg.liquidity, pool.sqrtPriceStr, leg.tickLower, leg.tickUpper);
      if (!raw) continue;
      addAmt(vaultRaw, v.coinTypeA, raw.rawA);
      addAmt(vaultRaw, v.coinTypeB, raw.rawB);
    }
    const shareA = shareLiquidityByLpAmount(lpRaw, vaultRaw.get(v.coinTypeA) ?? "0", v.totalSupply);
    const shareB = shareLiquidityByLpAmount(lpRaw, vaultRaw.get(v.coinTypeB) ?? "0", v.totalSupply);
    const metaA = getMeta(v.coinTypeA);
    const metaB = getMeta(v.coinTypeB);
    const lpMeta = getMeta(v.lpTokenType);
    let humA = humanFromRaw3(shareA, metaA.decimals);
    let humB = humanFromRaw3(shareB, metaB.decimals);
    const pxa = spots.get(v.coinTypeA)?.price;
    const pxb = spots.get(v.coinTypeB)?.price;
    const pxaF = typeof pxa === "number" && Number.isFinite(pxa) ? pxa : 0;
    const pxbF = typeof pxb === "number" && Number.isFinite(pxb) ? pxb : 0;
    const bagUsd = clampUsd5(humA * pxaF + humB * pxbF);
    const quoteCoin = v.quoteType ?? (metaA.symbol.toUpperCase() === "USDC" || metaA.symbol.toUpperCase() === "USDT" ? v.coinTypeA : v.coinTypeB);
    const dlmmOnly = sl.clmmLegs.length === 0;
    let aumVaultTvlUsd = 0;
    let aumUsd = 0;
    if (v.lastAum !== "0") {
      const qMeta = getMeta(quoteCoin);
      const qPx = spots.get(quoteCoin)?.price;
      const qPxF = typeof qPx === "number" && Number.isFinite(qPx) ? qPx : 0;
      const qPxUse = qPxF > 0 ? qPxF : /^(USDC|USDT|USDCsui|suiUSDT|AUSD|FDUSD)$/i.test(qMeta.symbol) ? 1 : 0;
      aumVaultTvlUsd = clampUsd5(humanFromRaw3(v.lastAum, qMeta.decimals) * qPxUse);
      const aumShare = shareLiquidityByLpAmount(lpRaw, v.lastAum, v.totalSupply);
      aumUsd = clampUsd5(humanFromRaw3(aumShare, qMeta.decimals) * qPxUse);
    }
    let vaultTvlUsd;
    {
      const vaultHumA = humanFromRaw3(vaultRaw.get(v.coinTypeA) ?? "0", metaA.decimals);
      const vaultHumB = humanFromRaw3(vaultRaw.get(v.coinTypeB) ?? "0", metaB.decimals);
      vaultTvlUsd = clampUsd5(vaultHumA * pxaF + vaultHumB * pxbF);
    }
    const compositionOk = vaultTvlUsd > 0 && bagUsd > 0;
    if (aumVaultTvlUsd > 0 && (dlmmOnly || !compositionOk)) {
      vaultTvlUsd = aumVaultTvlUsd;
    }
    const sharePct = vaultLpSharePct(lpRaw, v.totalSupply) ?? void 0;
    const bagsUnderreportAum = aumUsd > 0 && (dlmmOnly || !(bagUsd > 0) || aumUsd > bagUsd * 1.05);
    let valueUsd = bagUsd;
    if (bagsUnderreportAum) {
      valueUsd = aumUsd;
    } else if (!(bagUsd > 0)) {
      if (sharePct != null && sharePct > 0 && vaultTvlUsd > 0) {
        valueUsd = clampUsd5(vaultTvlUsd * (sharePct / 100));
      }
    }
    if (bagsUnderreportAum && valueUsd > 0 && pxaF > 0 && pxbF > 0) {
      if (bagUsd > valueUsd * 0.5) {
        const scale = valueUsd / bagUsd;
        humA *= scale;
        humB *= scale;
      } else {
        const quoteIsA = quoteCoin === v.coinTypeA;
        if (quoteIsA) {
          humA = valueUsd / pxaF;
          humB = 0;
        } else {
          humB = valueUsd / pxbF;
          humA = 0;
        }
      }
    }
    const tickLower = 0;
    const tickUpper = 0;
    const stakeRewards = pendingByLp.get(v.lpTokenType) ?? [];
    const pendingStakeRewards = stakeRewards.map((r) => {
      const px = spots.get(r.rewardCoinType)?.price;
      const pxF = typeof px === "number" && Number.isFinite(px) ? px : 0;
      return {
        symbol: r.symbol,
        coinType: r.rewardCoinType,
        amount: r.amount,
        amountUSD: clampUsd5(r.amount * pxF)
      };
    });
    const unclaimedRewardUSD = clampUsd5(
      pendingStakeRewards.reduce((s, r) => s + r.amountUSD, 0)
    );
    const farm = farmByLp.get(v.lpTokenType);
    const tvlForFarm = vaultTvlUsd > 0 ? vaultTvlUsd : aumVaultTvlUsd;
    let rewardApr = farm && tvlForFarm > 0 ? vaultFarmRewardAprPct({
      vaultTvlUsd: tvlForFarm,
      vaultTotalSupply: v.totalSupply,
      // Earn quotes Reward APR on full vault TVL (incentive panel), not staked-only.
      farmLpStakedRaw: v.totalSupply,
      emissions: farm.emissions.map((e) => {
        const px = spots.get(e.rewardCoinType)?.price;
        const pxF = typeof px === "number" && Number.isFinite(px) ? px : 0;
        return { ratePerSec: e.ratePerSec, decimals: e.decimals, priceUsd: pxF };
      })
    }) : null;
    if (rewardApr != null && rewardApr > 500) rewardApr = null;
    let vaultFeeApr = feeAprByVault.get(v.id) ?? null;
    if (vaultFeeApr != null && vaultFeeApr > 500) vaultFeeApr = null;
    if (dlmmOnly && sl.poolIds.length === 0) vaultFeeApr = null;
    out.push({
      id: v.id,
      protocol: "cetus",
      poolId: sl.poolId ?? v.id,
      pair: `${metaA.symbol}/${metaB.symbol} \xB7 vault`,
      tokenA: metaA.symbol,
      tokenB: metaB.symbol,
      tokenAAddress: v.coinTypeA,
      tokenBAddress: v.coinTypeB,
      tokenAIconUrl: metaA.iconUrl,
      tokenBIconUrl: metaB.iconUrl,
      tokenADecimals: metaA.decimals,
      tokenBDecimals: metaB.decimals,
      fee: 0,
      // Multi-leg vault: do not expose a single CLMM tick range (was last leg only + currentTick=0).
      tickLower,
      tickUpper,
      currentTick: 0,
      currentSqrtPrice: "0",
      liquidity: lpRaw,
      status: "in_range",
      tokenAAmount: humA,
      tokenBAmount: humB,
      currentPriceA_USD: pxaF,
      currentPriceB_USD: pxbF,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: 0,
      unclaimedFeeB: 0,
      unclaimedFeeUSD: 0,
      unclaimedRewardUSD,
      openedAt,
      daysOpen: 0,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: vaultFeeApr != null && Number.isFinite(vaultFeeApr) ? vaultFeeApr : 0,
      cetusVault: {
        vaultId: v.id,
        lpTokenType: v.lpTokenType,
        lpTokenRaw: lpRaw,
        lpTokenAmount: humanFromRaw3(lpRaw, lpMeta.decimals || 9),
        stakedLpTokenRaw: stakedRaw !== "0" ? stakedRaw : void 0,
        feeLabel: "Earn",
        provider: "Haedal",
        quoteCoinType: quoteCoin,
        vaultTvlUsd: vaultTvlUsd > 0 ? vaultTvlUsd : void 0,
        sharePct,
        vaultAprPct: vaultFeeApr != null && Number.isFinite(vaultFeeApr) ? vaultFeeApr : void 0,
        rewardAprPct: rewardApr != null && Number.isFinite(rewardApr) ? rewardApr : void 0,
        pendingStakeRewards: pendingStakeRewards.length ? pendingStakeRewards : void 0
      }
    });
  }
  return out;
}

// src/services/haedalLendingVaultsService.ts
import Decimal12 from "decimal.js";
import { normalizeStructTag as normalizeStructTag11, normalizeSuiAddress as normalizeSuiAddress13 } from "@mysten/sui/utils";

// src/utils/haedalLendingVault.ts
var HAEDAL_LENDING_FARMING_PACKAGE = "0xbddc4ecfd16683d1859500a5db1fb2cf00eeecb6719b76066bdc39c74dd03251";
var HAEDAL_LENDING_FARM_ACC_SCALE = 10n ** 12n;
var STAKE_PREFIX = `${HAEDAL_LENDING_FARMING_PACKAGE}::farming::StakeInfo<`;
function lendingStakeShareType(objectType) {
  if (!objectType.startsWith(STAKE_PREFIX) || !objectType.endsWith(">")) return null;
  const inner = objectType.slice(STAKE_PREFIX.length, -1).trim();
  return inner || null;
}
function splitMoveTypeArgs(objectType) {
  const lt = objectType.indexOf("<");
  const gt = objectType.lastIndexOf(">");
  if (lt < 0 || gt <= lt) return [];
  const inner = objectType.slice(lt + 1, gt);
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "<") depth++;
    if (ch === ">") depth--;
    if (ch === "," && depth === 0) {
      const t = cur.trim();
      if (t) out.push(t);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}
function normalizeTypeName(name) {
  const t = name.trim();
  if (!t) return t;
  return t.startsWith("0x") ? t : `0x${t}`;
}
function pendingLendingFarmRewardRaw(opts) {
  let acc = opts.accPerShare;
  if (!opts.paused && opts.totalShares > 0n && opts.rewardPerSecond > 0n) {
    const horizon = opts.nowSec < opts.endSec ? opts.nowSec : opts.endSec;
    const from = opts.lastUpdateSec > opts.startSec ? opts.lastUpdateSec : opts.startSec;
    if (horizon > from) {
      acc += opts.rewardPerSecond * (horizon - from) * HAEDAL_LENDING_FARM_ACC_SCALE / opts.totalShares;
    }
  }
  const gross = opts.shares * acc / HAEDAL_LENDING_FARM_ACC_SCALE;
  const live = gross > opts.debt ? gross - opts.debt : 0n;
  return live + (opts.storedPending > 0n ? opts.storedPending : 0n);
}

// src/services/haedalLendingVaultsService.ts
var MAX_SANE_POSITION_USD7 = 5e7;
var MAX_SANE_HUMAN = 1e18;
function unwrap4(val) {
  if (!val || typeof val !== "object") return null;
  const o = val;
  if (o.fields && typeof o.fields === "object") return o.fields;
  return o;
}
function asStr(val) {
  if (typeof val === "string") return val;
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  if (typeof val === "bigint") return val.toString();
  return "0";
}
function asBig(val) {
  try {
    const s = asStr(val);
    if (!/^\d+$/.test(s)) return 0n;
    return BigInt(s);
  } catch {
    return 0n;
  }
}
function clampUsd6(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v <= MAX_SANE_POSITION_USD7 ? v : 0;
}
function humanFromRaw4(raw, decimals) {
  if (decimals < 0 || !Number.isFinite(decimals)) return 0;
  try {
    const n2 = new Decimal12(raw.toString()).div(new Decimal12(10).pow(decimals)).toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function symbolFromCoinType7(ct) {
  const parts = ct.split("::");
  return parts[2] ?? parts[1] ?? "\u2014";
}
function normCoin(ct) {
  try {
    return normalizeStructTag11(ct.startsWith("0x") ? ct : `0x${ct}`);
  } catch {
    return ct;
  }
}
async function listStakeInfos(owner) {
  const out = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const res = await withRpcBackoff(
      () => suiClient.getOwnedObjects({
        owner,
        cursor: cursor ?? void 0,
        limit: 50,
        options: { showType: true, showContent: true }
      }),
      { label: "haedal-lending-owned", retries: 3, baseMs: 600 }
    );
    for (const item of res.data ?? []) {
      const type = item.data?.type ?? "";
      const shareType = lendingStakeShareType(type);
      if (!shareType) continue;
      const fields = unwrap4(item.data?.content?.fields);
      const poolId = typeof fields?.pool === "string" ? fields.pool : "";
      const objectId = item.data?.objectId;
      if (!poolId || !objectId) continue;
      out.push({ objectId, shareType: normCoin(shareType), poolId });
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}
function parseRewardConfigs(raw) {
  const f = unwrap4(raw);
  const contents = f?.contents;
  if (!Array.isArray(contents)) return [];
  const out = [];
  for (const row of contents) {
    const entry = unwrap4(row);
    const key = unwrap4(entry?.key);
    const name = typeof key?.name === "string" ? key.name : "";
    const value = unwrap4(entry?.value);
    if (!name || !value) continue;
    out.push({
      coinType: normCoin(normalizeTypeName(name)),
      accPerShare: asBig(value.acc_reward_per_share),
      rewardPerSecond: asBig(value.reward_per_second),
      lastUpdateSec: asBig(value.last_update_time),
      startSec: asBig(value.start_time),
      endSec: asBig(value.end_time)
    });
  }
  return out;
}
function parseFarmPool(objectId, type, fields) {
  const shareType = splitMoveTypeArgs(type)[0];
  const vaultId = typeof fields.source_addr === "string" ? fields.source_addr : "";
  const positions = unwrap4(fields.positions);
  const tableId = unwrap4(positions?.id)?.id;
  if (!shareType || !vaultId || typeof tableId !== "string") return null;
  return {
    id: objectId,
    vaultId,
    shareType: normCoin(shareType),
    tableId,
    totalShares: asBig(fields.total_shares),
    paused: fields.is_paused === true,
    rewards: parseRewardConfigs(fields.reward_configs)
  };
}
function debtFor(fields, coinType) {
  const want = normCoin(coinType);
  const read2 = (bag) => {
    const contents = unwrap4(bag)?.contents;
    if (!Array.isArray(contents)) return 0n;
    for (const row of contents) {
      const entry = unwrap4(row);
      const name = unwrap4(entry?.key)?.name;
      if (typeof name !== "string") continue;
      if (normCoin(normalizeTypeName(name)) === want) return asBig(entry?.value);
    }
    return 0n;
  };
  return { debt: read2(fields.debts), stored: read2(fields.pending_rewards) };
}
async function getHaedalLendingVaultPositions(owner, options) {
  const ownerNorm = normalizeSuiAddress13(owner);
  const stakes = await listStakeInfos(ownerNorm);
  if (stakes.length === 0) return [];
  const poolIds = [...new Set(stakes.map((s) => s.poolId))];
  const poolObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), poolIds, {
    showType: true,
    showContent: true
  });
  const farms = /* @__PURE__ */ new Map();
  for (const item of poolObjs) {
    const obj = item?.data;
    const content = obj?.content;
    if (!obj?.objectId || !content?.fields) continue;
    if (content.dataType && content.dataType !== "moveObject") continue;
    const parsed = parseFarmPool(
      obj.objectId,
      content.type ?? obj.type ?? "",
      content.fields
    );
    if (parsed) farms.set(obj.objectId, parsed);
  }
  const sharesByVault = /* @__PURE__ */ new Map();
  const stakedByVault = /* @__PURE__ */ new Map();
  const pendingByVault = /* @__PURE__ */ new Map();
  const farmByVault = /* @__PURE__ */ new Map();
  await Promise.all(
    stakes.map(async (stake) => {
      const farm = farms.get(stake.poolId);
      if (!farm) return;
      const pos = await withRpcBackoff(
        () => suiClient.getDynamicFieldObject({
          parentId: farm.tableId,
          name: { type: "address", value: ownerNorm }
        }),
        { label: "haedal-lending-position", retries: 3, baseMs: 500 }
      );
      const value = unwrap4(
        unwrap4(pos.data?.content?.fields)?.value
      );
      if (!value) return;
      const shares = asBig(value.shares);
      if (shares <= 0n) return;
      sharesByVault.set(farm.vaultId, (sharesByVault.get(farm.vaultId) ?? 0n) + shares);
      stakedByVault.set(farm.vaultId, (stakedByVault.get(farm.vaultId) ?? 0n) + shares);
      farmByVault.set(farm.vaultId, farm);
      const bag = pendingByVault.get(farm.vaultId) ?? /* @__PURE__ */ new Map();
      const nowSec = BigInt(Math.floor(Date.now() / 1e3));
      for (const reward of farm.rewards) {
        const { debt, stored } = debtFor(value, reward.coinType);
        const raw = pendingLendingFarmRewardRaw({
          shares,
          accPerShare: reward.accPerShare,
          debt,
          rewardPerSecond: reward.rewardPerSecond,
          lastUpdateSec: reward.lastUpdateSec,
          startSec: reward.startSec,
          endSec: reward.endSec,
          totalShares: farm.totalShares,
          nowSec,
          storedPending: stored,
          paused: farm.paused
        });
        if (raw > 0n) bag.set(reward.coinType, (bag.get(reward.coinType) ?? 0n) + raw);
      }
      pendingByVault.set(farm.vaultId, bag);
    })
  );
  const vaultIds = [...sharesByVault.keys()];
  if (vaultIds.length === 0) return [];
  let walletByShare = /* @__PURE__ */ new Map();
  try {
    const bals = await suiClient.getAllBalances({ owner: ownerNorm });
    walletByShare = new Map(
      bals.map((b) => [normCoin(b.coinType), asBig(b.totalBalance)])
    );
  } catch (e) {
    console.warn("[haedal-lending] balances", e);
  }
  const vaultObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), vaultIds, {
    showType: true,
    showContent: true
  });
  const rows = [];
  for (const item of vaultObjs) {
    const obj = item?.data;
    const content = obj?.content;
    if (!obj?.objectId || !content?.fields) continue;
    if (content.dataType && content.dataType !== "moveObject") continue;
    const fields = content.fields;
    const [assetType, shareFromType] = splitMoveTypeArgs(content.type ?? obj.type ?? "");
    const farm = farmByVault.get(obj.objectId);
    if (!assetType || !farm) continue;
    const shareType = normCoin(shareFromType || farm.shareType);
    const treasury = unwrap4(fields.share_treasury);
    const totalSupply = asBig(unwrap4(treasury?.total_supply)?.value);
    const staked = stakedByVault.get(obj.objectId) ?? 0n;
    const wallet = walletByShare.get(shareType) ?? 0n;
    const userShares = staked + wallet;
    if (userShares <= 0n || totalSupply <= 0n) continue;
    rows.push({
      vaultId: obj.objectId,
      assetType: normCoin(assetType),
      shareType,
      assetDecimals: Number(fields.asset_decimals ?? 0),
      totalAssets: asBig(fields.last_total_assets),
      totalSupply,
      userShares,
      stakedShares: staked,
      farm
    });
  }
  if (rows.length === 0) return [];
  const coinTypes = /* @__PURE__ */ new Set();
  for (const row of rows) {
    coinTypes.add(row.assetType);
    coinTypes.add(row.shareType);
    for (const r of row.farm.rewards) coinTypes.add(r.coinType);
    for (const ct of pendingByVault.get(row.vaultId)?.keys() ?? []) coinTypes.add(ct);
  }
  const metaMap = /* @__PURE__ */ new Map();
  await Promise.all(
    [...coinTypes].map(async (ct) => {
      try {
        const m = await suiClient.getCoinMetadata({ coinType: ct });
        metaMap.set(ct, {
          symbol: m?.symbol?.trim() || symbolFromCoinType7(ct),
          decimals: typeof m?.decimals === "number" ? m.decimals : 0,
          iconUrl: typeof m?.iconUrl === "string" && m.iconUrl.startsWith("https://") ? m.iconUrl : null
        });
      } catch {
        metaMap.set(ct, { symbol: symbolFromCoinType7(ct), decimals: 0, iconUrl: null });
      }
    })
  );
  const metaOf = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType7(ct), decimals: 0, iconUrl: null };
  const spotOpts = options?.forceRefreshPrices ? { forceRefresh: true } : void 0;
  const spots = await resolveSpots([...coinTypes], (ct) => metaOf(ct).symbol, spotOpts);
  const out = [];
  for (const row of rows) {
    const assetMeta = metaOf(row.assetType);
    const shareMeta = metaOf(row.shareType);
    const decimals = row.assetDecimals || assetMeta.decimals || 9;
    const userAssetsRaw = row.userShares * row.totalAssets / row.totalSupply;
    const humanAssets = humanFromRaw4(userAssetsRaw, decimals);
    const px = spots.get(row.assetType)?.price;
    const pxF = typeof px === "number" && Number.isFinite(px) ? px : 0;
    const valueUsd = clampUsd6(humanAssets * pxF);
    const vaultTvlUsd = clampUsd6(humanFromRaw4(row.totalAssets, decimals) * pxF);
    const sharePct = vaultLpSharePct(row.userShares.toString(), row.totalSupply.toString()) ?? void 0;
    const pendingStakeRewards = [...pendingByVault.get(row.vaultId)?.entries() ?? []].map(
      ([coinType, raw]) => {
        const m = metaOf(coinType);
        const amount = humanFromRaw4(raw, m.decimals || 9);
        const rpx = spots.get(coinType)?.price;
        const rpxF = typeof rpx === "number" && Number.isFinite(rpx) ? rpx : 0;
        return {
          symbol: m.symbol,
          coinType,
          amount,
          amountUSD: clampUsd6(amount * rpxF)
        };
      }
    );
    const unclaimedRewardUSD = clampUsd6(
      pendingStakeRewards.reduce((s, r) => s + r.amountUSD, 0)
    );
    let rewardApr = vaultFarmRewardAprPct({
      vaultTvlUsd,
      vaultTotalSupply: row.totalSupply.toString(),
      farmLpStakedRaw: row.totalSupply.toString(),
      emissions: row.farm.rewards.map((e) => {
        const m = metaOf(e.coinType);
        const rpx = spots.get(e.coinType)?.price;
        const rpxF = typeof rpx === "number" && Number.isFinite(rpx) ? rpx : 0;
        return {
          ratePerSec: e.rewardPerSecond.toString(),
          decimals: m.decimals || 9,
          priceUsd: rpxF
        };
      })
    });
    if (rewardApr != null && rewardApr > 500) rewardApr = null;
    const symbol = assetMeta.symbol || "SUI";
    out.push({
      id: row.vaultId,
      protocol: "cetus",
      poolId: row.vaultId,
      pair: `${symbol} \xB7 Lending`,
      tokenA: symbol,
      tokenB: symbol,
      tokenAAddress: row.assetType,
      tokenBAddress: row.assetType,
      tokenAIconUrl: assetMeta.iconUrl,
      tokenBIconUrl: assetMeta.iconUrl,
      tokenADecimals: decimals,
      tokenBDecimals: decimals,
      fee: 0,
      tickLower: 0,
      tickUpper: 0,
      currentTick: 0,
      currentSqrtPrice: "0",
      liquidity: row.userShares.toString(),
      status: "in_range",
      tokenAAmount: humanAssets,
      tokenBAmount: 0,
      currentPriceA_USD: pxF,
      currentPriceB_USD: pxF,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: 0,
      unclaimedFeeB: 0,
      unclaimedFeeUSD: 0,
      unclaimedRewardUSD,
      openedAt: 0,
      daysOpen: 0,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: 0,
      cetusVault: {
        vaultId: row.vaultId,
        lpTokenType: row.shareType,
        lpTokenRaw: row.userShares.toString(),
        lpTokenAmount: humanFromRaw4(row.userShares, shareMeta.decimals || decimals),
        stakedLpTokenRaw: row.stakedShares > 0n ? row.stakedShares.toString() : void 0,
        feeLabel: "Lending",
        provider: "Haedal",
        quoteCoinType: row.assetType,
        vaultTvlUsd: vaultTvlUsd > 0 ? vaultTvlUsd : void 0,
        sharePct,
        rewardAprPct: rewardApr != null && Number.isFinite(rewardApr) ? rewardApr : void 0,
        pendingStakeRewards: pendingStakeRewards.length ? pendingStakeRewards : void 0
      }
    });
  }
  return out;
}

// src/services/currentMultiplyVaultsService.ts
import { Transaction as Transaction4 } from "@mysten/sui/transactions";
import { bcs as bcs4 } from "@mysten/sui/bcs";
var API2 = "https://api.current.finance";
var PROTOCOL_PKG2 = "0x45bae0425e9098ce5cba3d3fa2836220ad24c9f88aa0dffffb5a52b49319fc70";
var DECIMAL_SCALE2 = 10n ** 18n;
var MARKET_OBJECT_BY_TYPE2 = {
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket": "0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df",
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EmberMarket": "0x8e85c433f791685c65fa66923110b8385e13f955daf8792ef805ce2d47139bbc",
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::AltCoinMarket": "0x6f5230c346e27132b8d4d92cb3f4f9c7f4e736d5c32b8f0a2b063c97e67d78f7",
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EthenaMarket": "0xeeef7e9abe201e16c3ca6417b91fa49bec28edcb077eb2fd4a1f126c251e6899",
  "fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MatrixGoldMarket": "0xafe28c816d322a56bdab27b90d4b5e882a0a34ee2d9f02c6a07402a2b69be900"
};
var decimalSchema2 = bcs4.struct("Decimal", { value: bcs4.u256() });
var overviewSchema2 = bcs4.struct("ObligationDetail", {
  emode_group_id: bcs4.u8(),
  borrows: bcs4.vector(
    bcs4.struct("ObligationBorrow", {
      asset: bcs4.string(),
      borrow_index: decimalSchema2,
      debt: decimalSchema2
    })
  ),
  deposits: bcs4.vector(
    bcs4.struct("ObligationDeposit", {
      asset: bcs4.string(),
      ctoken_amount: bcs4.u64()
    })
  )
});
function with0x2(t) {
  const s = t.trim();
  return s.startsWith("0x") || s.startsWith("0X") ? s : `0x${s}`;
}
function typeKey2(t) {
  return t.trim().replace(/^0x/i, "").toLowerCase();
}
function marketTypeKey(t) {
  return typeKey2(t);
}
async function getJson2(path) {
  const res = await fetch(extFetchUrl(`${API2}${path}`), { signal: AbortSignal.timeout(2e4) });
  if (!res.ok) throw new Error(`Current Multiply API ${res.status} ${path}`);
  const json = await res.json();
  if (json.code != null && json.code !== 0) {
    throw new Error(`Current Multiply API ${json.message ?? json.code} ${path}`);
  }
  return json.data;
}
var multiplyListCache = null;
var multiplyInFlight = /* @__PURE__ */ new Map();
var multiplyCacheByWallet = /* @__PURE__ */ new Map();
function stampMultiplyStale(positions, savedAtMs) {
  return positions.map((p) => ({
    ...p,
    readStale: true,
    lastSuccessAtMs: savedAtMs,
    currentMultiply: p.currentMultiply ? { ...p.currentMultiply, readStale: true, completeness: "partial" } : p.currentMultiply
  }));
}
async function fetchMultiplyList() {
  const now2 = Date.now();
  if (!multiplyListCache || now2 - multiplyListCache.ts >= 6e4) {
    const rows = await getJson2("/multiply/getMultiplyList");
    multiplyListCache = { ts: now2, rows: rows ?? [] };
  }
  return {
    rows: multiplyListCache.rows,
    receivedAtMs: multiplyListCache.ts,
    cacheAgeMs: now2 - multiplyListCache.ts
  };
}
function matchVault(list, marketType, emode, collateral, debt) {
  const marketName = (marketTypeKey(marketType).split("::").pop() ?? "").toLowerCase();
  const cKey = typeKey2(collateral);
  const dKey = typeKey2(debt);
  return list.find((v) => {
    if ((v.emodeGroup ?? -1) !== emode) return false;
    if (typeKey2(v.strategy ?? "") !== cKey || typeKey2(v.borrower ?? "") !== dKey) return false;
    const from = (v.fromMarket ?? "").toLowerCase();
    if (from && marketName && from !== marketName) return false;
    return true;
  });
}
function coinRaw2(scaled, scale = DECIMAL_SCALE2) {
  if (scale === 0n) return 0n;
  return scaled / scale;
}
async function inspectOverview2(marketType, marketId, obligationId, sender) {
  const tx = new Transaction4();
  tx.moveCall({
    target: `${PROTOCOL_PKG2}::obligation_query::get_obligation_overview`,
    typeArguments: [with0x2(marketType)],
    arguments: [tx.object(marketId), tx.pure.id(obligationId)]
  });
  const res = await suiClient.devInspectTransactionBlock({ sender, transactionBlock: tx });
  if (res.error) throw new Error(`Current Multiply overview: ${res.error}`);
  const raw = res.results?.[0]?.returnValues?.[0]?.[0];
  if (!raw) throw new Error("Current Multiply overview: empty return");
  return overviewSchema2.parse(Uint8Array.from(raw));
}
async function inspectRates2(marketType, marketId, assets, sender) {
  const out = /* @__PURE__ */ new Map();
  if (assets.length === 0) return out;
  const tx = new Transaction4();
  for (const asset of assets) {
    tx.moveCall({
      target: `${PROTOCOL_PKG2}::market_query::get_asset_market_rates`,
      typeArguments: [with0x2(marketType)],
      arguments: [tx.object(marketId), tx.pure.string(asset.replace(/^0x/i, "")), tx.object("0x6")]
    });
  }
  const res = await suiClient.devInspectTransactionBlock({ sender, transactionBlock: tx });
  if (res.error) throw new Error(`Current Multiply rates: ${res.error}`);
  const vec = bcs4.vector(decimalSchema2);
  for (let i = 0; i < assets.length; i++) {
    const raw = res.results?.[i]?.returnValues?.[0]?.[0];
    if (!raw) continue;
    const parsed = vec.parse(Uint8Array.from(raw));
    out.set(typeKey2(assets[i]), {
      exchange: BigInt(parsed[0]?.value ?? 0),
      borrowIndex: BigInt(parsed[1]?.value ?? 0)
    });
  }
  return out;
}
async function resolveMarketObjectId2(marketType, obligationId) {
  const key = marketTypeKey(marketType);
  for (const [k, id2] of Object.entries(MARKET_OBJECT_BY_TYPE2)) {
    if (marketTypeKey(k) === key) return id2;
  }
  const obj = await suiClient.getObject({ id: obligationId, options: { showContent: true } });
  const content = obj.data?.content;
  const id = content?.fields?.lending_market_id;
  return typeof id === "string" && id.startsWith("0x") ? id : null;
}
function readDecimals2(info) {
  if (info?.decimals == null || info.decimals === "") return null;
  const d = Number(info.decimals);
  return Number.isFinite(d) && d >= 0 && d <= 18 ? d : null;
}
function readPrice2(info) {
  if (info?.price == null || info.price === "") return null;
  const p = Number(info.price);
  return Number.isFinite(p) && p > 0 ? p : null;
}
function finiteOrNull(n2) {
  return n2 != null && Number.isFinite(n2) ? n2 : null;
}
async function getCurrentMultiplyVaultPositions(walletAddress, _opts) {
  const key = walletAddress.toLowerCase();
  const prev = multiplyInFlight.get(key);
  if (prev) return prev;
  const work = loadCurrentMultiplyVaultPositionsOnce(walletAddress, _opts).then((rows) => {
    multiplyCacheByWallet.set(key, { rows, savedAtMs: Date.now() });
    return rows;
  }).catch((e) => {
    const cached2 = multiplyCacheByWallet.get(key);
    if (cached2?.rows.length) {
      console.warn("[current-multiply] refresh failed, serving cached STALE", e);
      return stampMultiplyStale(cached2.rows, cached2.savedAtMs);
    }
    throw e;
  }).finally(() => {
    if (multiplyInFlight.get(key) === work) multiplyInFlight.delete(key);
  });
  multiplyInFlight.set(key, work);
  return work;
}
async function loadCurrentMultiplyVaultPositionsOnce(walletAddress, _opts) {
  const rows = await getJson2(
    `/multiply/getLeverageObligationByAddress/${walletAddress}`
  );
  const apiReceivedAtMs = Date.now();
  const active2 = (rows ?? []).filter(
    (r) => r.lendingObligationId && r.collateralToken && r.debtToken && r.positionState !== false
  );
  if (active2.length === 0) return [];
  const vaultMeta = await fetchMultiplyList().catch(() => ({
    rows: [],
    receivedAtMs: Date.now(),
    cacheAgeMs: 0
  }));
  const vaultList = vaultMeta.rows;
  const marketRows = await fetchAllMarketRows().catch(() => []);
  const marketMeta = currentMarketListMeta();
  const out = [];
  for (const row of active2) {
    const obligationId = row.lendingObligationId;
    const marketType = with0x2(row.market ?? "");
    const collateralType = with0x2(row.collateralToken);
    const debtType = with0x2(row.debtToken);
    const emode = Number(row.emodeGroup ?? 0);
    const vault = matchVault(vaultList, marketType, emode, collateralType, debtType);
    const supplyMeta = vault?.tokenInfo0;
    const borrowMeta = vault?.tokenInfo1;
    const supplyDec = readDecimals2(supplyMeta);
    const borrowDec = readDecimals2(borrowMeta);
    const pxSupply = readPrice2(supplyMeta);
    const pxBorrow = readPrice2(borrowMeta);
    const apiCollRaw = parseRawIntegerAmount(row.collateralAmount);
    const apiDebtRaw = parseRawIntegerAmount(row.debtAmount);
    let supplyRaw = apiCollRaw;
    let borrowRaw = apiDebtRaw;
    let depositExchange = DECIMAL_SCALE2;
    let source = "api_amounts";
    let chainAmountsReadAtMs = null;
    let rewardsReadAtMs = null;
    const completenessFlags = [];
    const marketId = await resolveMarketObjectId2(marketType, obligationId).catch(() => null);
    if (marketId) {
      try {
        const overview = await inspectOverview2(marketType, marketId, obligationId, walletAddress);
        const assets = [
          ...overview.deposits.map((d) => d.asset),
          ...overview.borrows.map((b) => b.asset)
        ];
        const rates = await inspectRates2(marketType, marketId, assets, walletAddress);
        const dep = overview.deposits.find((d) => typeKey2(d.asset) === typeKey2(collateralType));
        const bor = overview.borrows.find((b) => typeKey2(b.asset) === typeKey2(debtType));
        if (dep) {
          depositExchange = rates.get(typeKey2(dep.asset))?.exchange ?? DECIMAL_SCALE2;
          supplyRaw = coinRaw2(BigInt(dep.ctoken_amount) * depositExchange);
        }
        if (bor) {
          const borrowMarketIndex = rates.get(typeKey2(bor.asset))?.borrowIndex ?? DECIMAL_SCALE2;
          const stored = BigInt(bor.borrow_index.value);
          const debt = BigInt(bor.debt.value);
          const scaled = stored > 0n ? debt * borrowMarketIndex / stored : debt;
          borrowRaw = coinRaw2(scaled);
        }
        source = apiCollRaw != null || apiDebtRaw != null ? "mixed" : "on_chain_overview";
        chainAmountsReadAtMs = Date.now();
      } catch (err) {
        console.warn("[current-multiply] on-chain overview fallback to API amounts", obligationId, err);
        completenessFlags.push("partial_api_fallback");
        source = "api_amounts";
      }
    } else {
      completenessFlags.push("partial_api_fallback");
    }
    if (supplyDec == null) completenessFlags.push("partial_missing_decimals");
    if (borrowDec == null) completenessFlags.push("partial_missing_decimals");
    if (pxSupply == null || pxBorrow == null) completenessFlags.push("partial_missing_prices");
    const supplyHuman = supplyRaw != null && supplyDec != null ? humanFromRawBigint(supplyRaw, supplyDec) : null;
    const borrowHuman = borrowRaw != null && borrowDec != null ? humanFromRawBigint(borrowRaw, borrowDec) : null;
    const supplyUsd = supplyHuman != null && pxSupply != null ? supplyHuman * pxSupply : null;
    const borrowUsd = borrowHuman != null && pxBorrow != null ? borrowHuman * pxBorrow : null;
    const equityUsd = multiplyEquityUsd(supplyUsd, borrowUsd);
    const multiplier = multiplyMultiplier(supplyUsd, equityUsd);
    const baseSupplyApr = finiteOrNull(vault?.supplyAPR ?? null);
    const baseBorrowApr = finiteOrNull(vault?.borrowAPR ?? null);
    if (baseSupplyApr == null || baseBorrowApr == null) completenessFlags.push("partial_missing_rates");
    let depositRewardApr = null;
    let borrowRewardApr = null;
    let claimableRewards = [];
    let claimableRewardsUsd = null;
    let rewardsStatus = "unavailable";
    let pendingStakeRewards;
    if (marketId && supplyDec != null && borrowDec != null && pxSupply != null && pxBorrow != null) {
      const [depMining, borMining, mined] = await Promise.all([
        readMiningRewardApr(marketId, "deposit", collateralType, depositExchange, supplyDec, pxSupply, marketRows),
        readMiningRewardApr(marketId, "borrow", debtType, DECIMAL_SCALE2, borrowDec, pxBorrow, marketRows),
        readClaimableMining(marketId, obligationId, [collateralType], [debtType], marketRows)
      ]);
      rewardsReadAtMs = Math.max(depMining.readAtMs, borMining.readAtMs, mined.readAtMs);
      const knownApr = (read2) => read2.status === "complete" || read2.status === "empty" ? read2.apr ?? 0 : null;
      depositRewardApr = knownApr(depMining);
      borrowRewardApr = knownApr(borMining);
      if (depositRewardApr == null || borrowRewardApr == null) completenessFlags.push("partial_missing_rewards");
      rewardsStatus = mined.status;
      claimableRewards = mined.rows.map((r) => ({
        symbol: r.symbol,
        coinType: r.coinType,
        amountRaw: r.amountRaw,
        decimals: r.decimals,
        amount: r.amount,
        amountUsd: r.valueUSD
      }));
      if (mined.status === "empty") claimableRewardsUsd = 0;
      else if ((mined.status === "complete" || mined.status === "partial") && claimableRewards.every((r) => r.amountUsd != null) && claimableRewards.length > 0) {
        claimableRewardsUsd = claimableRewards.reduce((s, r) => s + (r.amountUsd ?? 0), 0);
      } else if (mined.status === "complete" && claimableRewards.length === 0) {
        rewardsStatus = "empty";
        claimableRewardsUsd = 0;
      } else {
        claimableRewardsUsd = null;
      }
      if (mined.status === "partial" || mined.status === "unavailable") {
        completenessFlags.push("partial_missing_rewards");
      }
      pendingStakeRewards = claimableRewards.filter((r) => r.amount != null && r.amountUsd != null).map((r) => ({
        symbol: r.symbol,
        coinType: r.coinType,
        amount: r.amount ?? 0,
        amountUSD: r.amountUsd ?? 0
      }));
    } else {
      completenessFlags.push("partial_missing_rewards");
    }
    const apr = multiplyNetAprBreakdown({
      collateralUsd: supplyUsd,
      debtUsd: borrowUsd,
      equityUsd,
      baseSupplyApr,
      baseBorrowApr,
      depositIncentiveApr: depositRewardApr,
      borrowIncentiveApr: borrowRewardApr,
      ratesSource: baseSupplyApr != null && baseBorrowApr != null ? "multiply_list" : "unavailable"
    });
    const liqLtv = finiteOrNull(vault?.liqLTV ?? null);
    const maxLtv = finiteOrNull(vault?.maxLTV ?? null);
    const risk = multiplyRiskFromSpot({
      collateralAmount: supplyHuman,
      debtAmount: borrowHuman,
      collateralUsd: supplyUsd,
      debtUsd: borrowUsd,
      liquidationLtv: liqLtv,
      maxLtv
    });
    const tokenA = supplyMeta?.symbol ?? collateralType.split("::").pop() ?? "SUPPLY";
    const tokenB = borrowMeta?.symbol ?? debtType.split("::").pop() ?? "DEBT";
    const fromMarket = row.fromMarket ?? vault?.fromMarket ?? null;
    const initialNet = finiteOrNull(row.initialNetValue != null ? Number(row.initialNetValue) : null);
    const lastUpdate = row.updateTime != null && Number.isFinite(row.updateTime) && row.updateTime > 0 ? row.updateTime : null;
    if (apr.coverage !== "complete") completenessFlags.push("partial");
    const completeness = mergeMultiplyCompleteness(completenessFlags);
    const requestFinishedAtMs = Date.now();
    const currentMultiply = {
      kind: "current_multiply",
      obligationId,
      leverageOwnerCapId: row.leverageOwnerCap ?? null,
      marketType,
      marketObjectId: marketId,
      emodeGroup: Number.isFinite(emode) ? emode : null,
      fromMarket,
      collateral: {
        coinType: collateralType,
        symbol: tokenA,
        amountRaw: supplyRaw != null ? supplyRaw.toString() : "",
        decimals: supplyDec,
        amount: supplyHuman,
        priceUsd: pxSupply,
        valueUsd: supplyUsd,
        iconUrl: supplyMeta?.icon ?? null,
        priceSource: pxSupply != null ? "multiply_list" : "unavailable"
      },
      debt: {
        coinType: debtType,
        symbol: tokenB,
        amountRaw: borrowRaw != null ? borrowRaw.toString() : "",
        decimals: borrowDec,
        amount: borrowHuman,
        priceUsd: pxBorrow,
        valueUsd: borrowUsd,
        iconUrl: borrowMeta?.icon ?? null,
        priceSource: pxBorrow != null ? "multiply_list" : "unavailable"
      },
      equityUsd,
      multiplier,
      apr,
      risk,
      claimableRewards,
      claimableRewardsUsd,
      rewardsStatus,
      initialNetValueUsd: initialNet,
      lastUpdateTimeMs: lastUpdate,
      observedAtMs: requestFinishedAtMs,
      freshness: {
        requestFinishedAtMs,
        chainAmountsReadAtMs,
        apiReceivedAtMs,
        apiPositionUpdateTimeMs: lastUpdate,
        ratesCacheAgeMs: vaultMeta.cacheAgeMs,
        rewardsReadAtMs,
        marketListPartial: marketMeta.partial
      },
      source,
      completeness,
      appUrl: currentMultiplyAppUrl({
        fromMarket,
        collateralCoinType: collateralType,
        debtCoinType: debtType
      })
    };
    const equityKnown = equityUsd != null && Number.isFinite(equityUsd);
    const rewardUsdKnown = claimableRewardsUsd != null && Number.isFinite(claimableRewardsUsd);
    const unclaimedRewardUSD = rewardUsdKnown ? claimableRewardsUsd : Number.NaN;
    out.push({
      id: obligationId,
      protocol: "cetus",
      poolId: row.leverageOwnerCap ?? obligationId,
      pair: `${tokenA}/${tokenB}`,
      tokenA,
      tokenB,
      tokenAAddress: collateralType,
      tokenBAddress: debtType,
      tokenAIconUrl: supplyMeta?.icon ?? void 0,
      tokenBIconUrl: borrowMeta?.icon ?? void 0,
      tokenADecimals: supplyDec ?? Number.NaN,
      tokenBDecimals: borrowDec ?? Number.NaN,
      fee: 0,
      tickLower: 0,
      tickUpper: 0,
      currentTick: 0,
      currentSqrtPrice: "0",
      // Non-zero sentinel so isEmptyLpPosition is false; not CLMM liquidity.
      liquidity: supplyRaw != null && supplyRaw > 0n ? supplyRaw.toString() : "1",
      lifecycleStatus: "active",
      // Not a CLMM range — Vaults filter excludes via cetusVault; keep out_of_range so
      // accidental CLMM aggregators never count Multiply as In Range.
      status: "out_of_range",
      tokenAAmount: supplyHuman ?? Number.NaN,
      // Debt stays on the position for detail UI; exposure aggregators must not treat it as a long asset.
      tokenBAmount: borrowHuman ?? Number.NaN,
      currentPriceA_USD: pxSupply ?? Number.NaN,
      currentPriceB_USD: pxBorrow ?? Number.NaN,
      // Equity only. Unknown equity stays NaN so Net Worth does not book $0.
      currentValueUSD: equityKnown ? equityUsd : Number.NaN,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: 0,
      unclaimedFeeB: 0,
      unclaimedFeeUSD: 0,
      unclaimedRewardUSD,
      openedAt: 0,
      daysOpen: 0,
      lifetimeEarningsUSD: Number.NaN,
      vsHodlDeltaUSD: 0,
      aprEstimatePct: apr.netAprPct ?? Number.NaN,
      currentMultiply,
      cetusVault: {
        vaultId: obligationId,
        lpTokenType: "current-multiply",
        lpTokenRaw: String(row.leverageOwnerCap ?? obligationId),
        // Compatibility shell only — never store multiplier here (was Share 4% / 4 LP bug).
        lpTokenAmount: 0,
        feeLabel: "Multiply",
        provider: "Current",
        quoteCoinType: debtType,
        vaultAprPct: apr.coverage === "complete" ? apr.netAprPct ?? void 0 : void 0,
        rewardAprPct: void 0,
        pendingStakeRewards
      }
    });
  }
  return out;
}

// src/services/turbosService.ts
import { TickMath as TickMath7, Utils as Utils7 } from "@mmt-finance/clmm-sdk";
import { normalizeStructTag as normalizeStructTag12, normalizeSuiAddress as normalizeSuiAddress14 } from "@mysten/sui/utils";
import Decimal13 from "decimal.js";
import BN7 from "bn.js";
var TURBOS_POSITION_TYPE = `${PROTOCOL_PACKAGES.TURBOS}::position_nft::TurbosPositionNFT`;
var MAX_SANE_POSITION_USD8 = 5e7;
var MAX_SANE_HUMAN_TOKENS7 = 1e18;
var STABLECOIN_SYMS2 = /* @__PURE__ */ new Set([
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "TUSD",
  "FDUSD",
  "PYUSD",
  "USDD",
  "FRAX",
  "LUSD",
  "SUSD",
  "GUSD"
]);
function unwrapStruct2(val) {
  if (!val || typeof val !== "object") return null;
  const obj = val;
  if (obj.fields != null && typeof obj.fields === "object") {
    return obj.fields;
  }
  return obj;
}
function normTypeSafe3(raw) {
  try {
    return normalizeStructTag12(raw.trim());
  } catch {
    return null;
  }
}
function normCoinType3(raw) {
  if (typeof raw !== "string" || !raw) return null;
  const s = raw.trim();
  const full = s.startsWith("0x") ? s : `0x${s}`;
  return normTypeSafe3(full);
}
function extractTypeName(val) {
  if (!val || typeof val !== "object") return null;
  const obj = val;
  const f = obj.fields ?? obj;
  const name = f.name;
  if (typeof name !== "string" || !name) return null;
  return normCoinType3(name);
}
function normId3(raw) {
  if (typeof raw !== "string") return "";
  try {
    return normalizeSuiAddress14(raw.trim());
  } catch {
    return raw.trim();
  }
}
function i32FromBits(bits) {
  const n2 = typeof bits === "number" ? bits : typeof bits === "string" ? Number(bits) : NaN;
  if (!Number.isFinite(n2)) return 0;
  const u = Math.floor(n2) & 4294967295;
  return u > 2147483647 ? u - 4294967296 : u;
}
function readTick(val) {
  const s = unwrapStruct2(val);
  if (!s) return 0;
  return i32FromBits(s.bits);
}
function safeHumanFromBnRaw3(rawBn, decimals) {
  try {
    const raw = rawBn.toString(10);
    if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
    const d = new Decimal13(raw).div(new Decimal13(10).pow(decimals));
    const n2 = d.toNumber();
    if (!Number.isFinite(n2) || n2 < 0 || n2 > MAX_SANE_HUMAN_TOKENS7) return 0;
    return n2;
  } catch {
    return 0;
  }
}
function rawToHuman(raw, decimals) {
  const s = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "0";
  if (!/^\d+$/.test(s)) return 0;
  try {
    return safeHumanFromBnRaw3(new BN7(s, 10), decimals);
  } catch {
    return 0;
  }
}
function spotPriceSafe3(raw) {
  if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8) return 0;
  return raw;
}
function clampUsd7(v) {
  return Number.isFinite(v) && v >= 0 && v <= MAX_SANE_POSITION_USD8 ? v : 0;
}
function symbolFromCoinType8(ct) {
  const p = ct.split("::");
  return p[2] ?? p[1] ?? "\u2014";
}
function parseNftObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const o = obj;
  const data = o.data ?? o;
  const content = data.content;
  if (!content) return null;
  const fields = content.fields ?? content;
  const nftId = normId3(data.objectId ?? data.id?.id);
  const poolId = normId3(fields.pool_id);
  const positionId = normId3(fields.position_id);
  if (!nftId || !poolId || !positionId) return null;
  const coinTypeA = extractTypeName(fields.coin_type_a);
  const coinTypeB = extractTypeName(fields.coin_type_b);
  return { nftId, poolId, positionId, coinTypeA, coinTypeB };
}
function parsePositionObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const o = obj;
  const data = o.data ?? o;
  const content = data.content;
  if (!content) return null;
  const f = content.fields ?? content;
  const liquidity = String(f.liquidity ?? "0");
  const lowerTick = readTick(f.tick_lower_index);
  const upperTick = readTick(f.tick_upper_index);
  const lowerTickRaw = f.tick_lower_index;
  const upperTickRaw = f.tick_upper_index;
  const tokensOwedA = String(f.tokens_owed_a ?? "0");
  const tokensOwedB = String(f.tokens_owed_b ?? "0");
  const feeGrowthInsideA = String(f.fee_growth_inside_a ?? "0");
  const feeGrowthInsideB = String(f.fee_growth_inside_b ?? "0");
  const rewardAmounts = [];
  const rewardGrowthInsides = [];
  if (Array.isArray(f.reward_infos)) {
    for (const ri of f.reward_infos) {
      const rif = unwrapStruct2(ri);
      rewardAmounts.push(String(rif?.amount_owed ?? "0"));
      rewardGrowthInsides.push(String(rif?.reward_growth_inside ?? "0"));
    }
  }
  return { liquidity, lowerTick, upperTick, lowerTickRaw, upperTickRaw, tokensOwedA, tokensOwedB, feeGrowthInsideA, feeGrowthInsideB, rewardAmounts, rewardGrowthInsides };
}
function parsePoolObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const o = obj;
  const data = o.data ?? o;
  const content = data.content;
  if (!content) return null;
  const f = content.fields ?? content;
  const sqrtPriceStr = String(f.sqrt_price ?? "0");
  const currentTick = readTick(f.tick_current_index);
  const rawFee = typeof f.fee === "number" ? f.fee : Number(f.fee) || 0;
  const feeRate = rawFee / 1e6;
  const rewardCoinTypes = [];
  const rewardGrowthGlobals = [];
  const rewardEmissionsPerSecond = [];
  if (Array.isArray(f.reward_infos)) {
    for (const ri of f.reward_infos) {
      const rif = unwrapStruct2(ri);
      const ct = normCoinType3(rif?.vault_coin_type);
      if (ct) rewardCoinTypes.push(ct);
      rewardGrowthGlobals.push(String(rif?.growth_global ?? "0"));
      rewardEmissionsPerSecond.push(String(rif?.emissions_per_second ?? "0"));
    }
  }
  const poolLiquidity = String(f.liquidity ?? "0");
  const feeGrowthGlobalA = String(f.fee_growth_global_a ?? "0");
  const feeGrowthGlobalB = String(f.fee_growth_global_b ?? "0");
  let ticksTableId = null;
  try {
    const tm = unwrapStruct2(f.tick_manager);
    const ticks = tm?.ticks;
    const ticksF = ticks?.fields ?? ticks;
    const idW = ticksF?.id;
    const rawId = idW?.id ?? idW;
    if (typeof rawId === "string" && rawId.startsWith("0x")) {
      ticksTableId = rawId;
    }
  } catch {
  }
  return { sqrtPriceStr, currentTick, feeRate, rewardCoinTypes, feeGrowthGlobalA, feeGrowthGlobalB, rewardGrowthGlobals, rewardEmissionsPerSecond, poolLiquidity, ticksTableId };
}
async function fetchTurbosTickFeeGrowth(poolId, tickRaw, tickIndex) {
  let nameType;
  let nameValue;
  const rawObj = tickRaw;
  if (rawObj && typeof rawObj.type === "string" && rawObj.fields) {
    nameType = rawObj.type;
    nameValue = rawObj.fields;
  } else {
    nameType = `${PROTOCOL_PACKAGES.TURBOS}::i32::I32`;
    nameValue = { bits: tickIndex >>> 0 };
  }
  try {
    const obj = await suiClient.getDynamicFieldObject({
      parentId: poolId,
      name: { type: nameType, value: nameValue }
    });
    if (!obj?.data?.content) return null;
    const c = obj.data.content;
    const fields = c.fields ?? c;
    const tickFields = unwrapStruct2(fields.value ?? fields);
    if (!tickFields) return null;
    const readU128 = (v) => {
      const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : "0";
      try {
        return BigInt(s);
      } catch {
        return 0n;
      }
    };
    const feeGrowthOutsideA = readU128(tickFields.fee_growth_outside_a);
    const feeGrowthOutsideB = readU128(tickFields.fee_growth_outside_b);
    const rewardGrowthOutsides = [];
    if (Array.isArray(tickFields.reward_growths_outside)) {
      for (const r of tickFields.reward_growths_outside) rewardGrowthOutsides.push(readU128(r));
    }
    return { feeGrowthOutsideA, feeGrowthOutsideB, rewardGrowthOutsides };
  } catch (e) {
    console.warn("[turbos-tick] fetch failed poolId", poolId.slice(0, 16), "tick", tickIndex, e?.message);
    return null;
  }
}
var U128_MAX_PLUS_1 = 2n ** 128n;
function computeFeeGrowthInside(feeGrowthGlobal, lowerFeeGrowthOutside, upperFeeGrowthOutside, lowerTick, upperTick, currentTick) {
  const feeGrowthBelow = currentTick >= lowerTick ? lowerFeeGrowthOutside : (feeGrowthGlobal - lowerFeeGrowthOutside + U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
  const feeGrowthAbove = currentTick < upperTick ? upperFeeGrowthOutside : (feeGrowthGlobal - upperFeeGrowthOutside + U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
  return (feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove + 2n * U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
}
var U64_MAX = 18446744073709551615n;
function computeTotalOwed(tokensOwedRaw, feeGrowthInsideNow, feeGrowthInsideLast, liquidity) {
  try {
    const liq = BigInt(liquidity);
    if (liq === 0n) return tokensOwedRaw;
    const owed = BigInt(tokensOwedRaw);
    const delta = (feeGrowthInsideNow - feeGrowthInsideLast + U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
    const live = delta * liq >> 128n;
    const total = owed + live > U64_MAX ? owed : owed + live;
    return total.toString();
  } catch {
    return tokensOwedRaw;
  }
}
function computeTotalRewardOwed(amountOwedRaw, rewardGrowthInsideNow, rewardGrowthInsideLast, liquidity) {
  try {
    const liq = BigInt(liquidity);
    if (liq === 0n) return amountOwedRaw;
    const owed = BigInt(amountOwedRaw);
    const delta = (rewardGrowthInsideNow - rewardGrowthInsideLast + U128_MAX_PLUS_1) % U128_MAX_PLUS_1;
    const live = delta * liq >> 64n;
    const total = owed + live > U64_MAX ? owed : owed + live;
    return total.toString();
  } catch {
    return amountOwedRaw;
  }
}
async function getTurbosPositions(walletAddress) {
  const nfts = [];
  let cursor = null;
  do {
    const page = await suiClient.getOwnedObjects({
      owner: walletAddress,
      cursor: cursor ?? void 0,
      filter: { StructType: TURBOS_POSITION_TYPE },
      options: { showContent: true, showType: true }
    });
    for (const item of page.data) {
      const parsed = parseNftObject(item);
      if (parsed) nfts.push(parsed);
    }
    cursor = page.hasNextPage ? page.nextCursor ?? null : null;
  } while (cursor);
  if (nfts.length === 0) return [];
  const positionObjs = await suiClient.multiGetObjects({
    ids: nfts.map((n2) => n2.positionId),
    options: { showContent: true }
  });
  const posData = /* @__PURE__ */ new Map();
  for (let i = 0; i < nfts.length; i++) {
    const raw = positionObjs[i];
    if (!raw) continue;
    const parsed = parsePositionObject(raw);
    if (!parsed) continue;
    if (parsed.liquidity === "0" || !parsed.liquidity) continue;
    posData.set(nfts[i].positionId, parsed);
  }
  const openNfts = nfts.filter((n2) => posData.has(n2.positionId));
  if (openNfts.length === 0) return [];
  const uniquePoolIds = [...new Set(openNfts.map((n2) => n2.poolId))];
  const poolObjs = await suiClient.multiGetObjects({
    ids: uniquePoolIds,
    options: { showContent: true }
  });
  const poolData = /* @__PURE__ */ new Map();
  for (let i = 0; i < uniquePoolIds.length; i++) {
    const raw = poolObjs[i];
    if (!raw) continue;
    const parsed = parsePoolObject(raw);
    if (!parsed) continue;
    poolData.set(uniquePoolIds[i], parsed);
  }
  const allCoinTypes = /* @__PURE__ */ new Set();
  for (const n2 of openNfts) {
    const pool = poolData.get(n2.poolId);
    if (!pool) continue;
    if (n2.coinTypeA) allCoinTypes.add(n2.coinTypeA);
    if (n2.coinTypeB) allCoinTypes.add(n2.coinTypeB);
    for (const ct of pool.rewardCoinTypes) allCoinTypes.add(ct);
  }
  const metaMap = /* @__PURE__ */ new Map();
  await mapPool([...allCoinTypes], RPC_CONCURRENCY, async (ct) => {
    try {
      const m = await suiClient.getCoinMetadata({ coinType: ct });
      metaMap.set(ct, {
        symbol: m?.symbol ?? symbolFromCoinType8(ct),
        decimals: m?.decimals ?? 9,
        iconUrl: typeof m?.iconUrl === "string" && m.iconUrl.startsWith("https://") ? m.iconUrl : null
      });
    } catch {
      metaMap.set(ct, { symbol: symbolFromCoinType8(ct), decimals: 9, iconUrl: null });
    }
  });
  const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType8(ct), decimals: 9, iconUrl: null };
  let spotsMap = /* @__PURE__ */ new Map();
  try {
    spotsMap = await resolveSpots([...allCoinTypes], (ct) => getMeta(ct).symbol);
  } catch {
  }
  const tickFetchResults = /* @__PURE__ */ new Map();
  await mapPool(openNfts, RPC_CONCURRENCY, async (nft) => {
    const pos = posData.get(nft.positionId);
    if (!pos) return;
    const [lower, upper] = await Promise.all([
      fetchTurbosTickFeeGrowth(nft.poolId, pos.lowerTickRaw, pos.lowerTick),
      fetchTurbosTickFeeGrowth(nft.poolId, pos.upperTickRaw, pos.upperTick)
    ]);
    tickFetchResults.set(nft.positionId, { lower, upper });
  });
  const out = [];
  for (const nft of openNfts) {
    const pos = posData.get(nft.positionId);
    const pool = poolData.get(nft.poolId);
    if (!pos || !pool) continue;
    const rawCtA = nft.coinTypeA ?? "";
    const rawCtB = nft.coinTypeB ?? "";
    if (!rawCtA || !rawCtB) continue;
    const metaA = getMeta(rawCtA);
    const metaB = getMeta(rawCtB);
    const liqBn = /^\d+$/.test(pos.liquidity) ? new BN7(pos.liquidity, 10) : new BN7(0);
    const curSqrtBn = /^\d+$/.test(pool.sqrtPriceStr) && pool.sqrtPriceStr !== "0" ? new BN7(pool.sqrtPriceStr, 10) : new BN7(0);
    let humA = 0;
    let humB = 0;
    if (!liqBn.isZero() && !curSqrtBn.isZero()) {
      try {
        const lowerSqrt = TickMath7.tickIndexToSqrtPriceX64(pos.lowerTick);
        const upperSqrt = TickMath7.tickIndexToSqrtPriceX64(pos.upperTick);
        const { coinA, coinB } = Utils7.getCoinAmountFromLiquidity(
          liqBn,
          curSqrtBn,
          lowerSqrt,
          upperSqrt,
          false
        );
        humA = safeHumanFromBnRaw3(coinA, metaA.decimals);
        humB = safeHumanFromBnRaw3(coinB, metaB.decimals);
      } catch {
      }
    }
    const tickResult = tickFetchResults.get(nft.positionId);
    let rawUnclA;
    let rawUnclB;
    if (tickResult?.lower && tickResult?.upper) {
      try {
        const fggA = BigInt(pool.feeGrowthGlobalA || "0");
        const fggB = BigInt(pool.feeGrowthGlobalB || "0");
        const fgiNowA = computeFeeGrowthInside(
          fggA,
          tickResult.lower.feeGrowthOutsideA,
          tickResult.upper.feeGrowthOutsideA,
          pos.lowerTick,
          pos.upperTick,
          pool.currentTick
        );
        const fgiNowB = computeFeeGrowthInside(
          fggB,
          tickResult.lower.feeGrowthOutsideB,
          tickResult.upper.feeGrowthOutsideB,
          pos.lowerTick,
          pos.upperTick,
          pool.currentTick
        );
        rawUnclA = computeTotalOwed(
          pos.tokensOwedA,
          fgiNowA,
          BigInt(pos.feeGrowthInsideA || "0"),
          pos.liquidity
        );
        rawUnclB = computeTotalOwed(
          pos.tokensOwedB,
          fgiNowB,
          BigInt(pos.feeGrowthInsideB || "0"),
          pos.liquidity
        );
      } catch {
        rawUnclA = pos.tokensOwedA;
        rawUnclB = pos.tokensOwedB;
      }
    } else {
      rawUnclA = pos.tokensOwedA;
      rawUnclB = pos.tokensOwedB;
    }
    const unclFeeA = rawToHuman(rawUnclA, metaA.decimals);
    const unclFeeB = rawToHuman(rawUnclB, metaB.decimals);
    let unclRewardUsd = 0;
    for (let i = 0; i < pool.rewardCoinTypes.length; i++) {
      const rct = pool.rewardCoinTypes[i];
      const rMeta = getMeta(rct);
      let rRaw = pos.rewardAmounts[i] ?? "0";
      if (tickResult?.lower && tickResult?.upper) {
        try {
          const rewardGlobal = BigInt(pool.rewardGrowthGlobals[i] ?? "0");
          const lowerRewardOutside = tickResult.lower.rewardGrowthOutsides[i] ?? 0n;
          const upperRewardOutside = tickResult.upper.rewardGrowthOutsides[i] ?? 0n;
          const rewardInsideLast = BigInt(pos.rewardGrowthInsides[i] ?? "0");
          const rewardInsideNow = computeFeeGrowthInside(
            rewardGlobal,
            lowerRewardOutside,
            upperRewardOutside,
            pos.lowerTick,
            pos.upperTick,
            pool.currentTick
          );
          rRaw = computeTotalRewardOwed(rRaw, rewardInsideNow, rewardInsideLast, pos.liquidity);
        } catch {
        }
      }
      const rHum = rawToHuman(rRaw, rMeta.decimals);
      const rPx = spotPriceSafe3(spotsMap.get(rct)?.price);
      if (rPx > 0) unclRewardUsd += rHum * rPx;
    }
    const pxA = spotPriceSafe3(spotsMap.get(rawCtA)?.price);
    const pxB = spotPriceSafe3(spotsMap.get(rawCtB)?.price);
    const valueUsd = clampUsd7(
      (pxA > 0 ? humA * pxA : 0) + (pxB > 0 ? humB * pxB : 0)
    );
    const feeUsd = (pxA > 0 ? unclFeeA * pxA : 0) + (pxB > 0 ? unclFeeB * pxB : 0);
    const inRange = pool.currentTick >= pos.lowerTick && pool.currentTick <= pos.upperTick;
    const aIsStable = STABLECOIN_SYMS2.has(metaA.symbol.toUpperCase());
    const bIsStable = STABLECOIN_SYMS2.has(metaB.symbol.toUpperCase());
    const swap = aIsStable && !bIsStable;
    const symA = swap ? metaB.symbol : metaA.symbol;
    const symB = swap ? metaA.symbol : metaB.symbol;
    const ctA = swap ? rawCtB : rawCtA;
    const ctB = swap ? rawCtA : rawCtB;
    const dMetaA = swap ? metaB : metaA;
    const dMetaB = swap ? metaA : metaB;
    const dPxA = swap ? pxB : pxA;
    const dPxB = swap ? pxA : pxB;
    const dHumA = swap ? humB : humA;
    const dHumB = swap ? humA : humB;
    const dFeeA = swap ? unclFeeB : unclFeeA;
    const dFeeB = swap ? unclFeeA : unclFeeB;
    const dTickLower = swap ? -pos.upperTick : pos.lowerTick;
    const dTickUpper = swap ? -pos.lowerTick : pos.upperTick;
    let sqrtPriceOut = pool.sqrtPriceStr;
    if (swap) {
      try {
        const orig = BigInt(pool.sqrtPriceStr);
        if (orig > 0n) sqrtPriceOut = (2n ** 128n / orig).toString();
      } catch {
      }
    }
    const feeLabelPct = `${(pool.feeRate * 100).toFixed(3)}%`;
    const pair = `${symA}/${symB} \xB7 ${feeLabelPct}${inRange ? "" : " \xB7 OUT"}`;
    out.push({
      id: nft.nftId,
      protocol: "turbos",
      poolId: nft.poolId,
      turbosPositionObjectId: nft.positionId,
      turbosSwapped: swap,
      turbosOriginalDecimalsA: metaA.decimals,
      turbosOriginalDecimalsB: metaB.decimals,
      pair,
      tokenA: symA,
      tokenB: symB,
      tokenAAddress: ctA,
      tokenBAddress: ctB,
      tokenAIconUrl: dMetaA.iconUrl,
      tokenBIconUrl: dMetaB.iconUrl,
      tokenADecimals: dMetaA.decimals,
      tokenBDecimals: dMetaB.decimals,
      fee: pool.feeRate,
      tickLower: dTickLower,
      tickUpper: dTickUpper,
      currentTick: pool.currentTick,
      currentSqrtPrice: sqrtPriceOut,
      liquidity: pos.liquidity,
      status: inRange ? "in_range" : "out_of_range",
      tokenAAmount: dHumA,
      tokenBAmount: dHumB,
      currentPriceA_USD: dPxA,
      currentPriceB_USD: dPxB,
      currentValueUSD: valueUsd,
      depositedUSD: 0,
      // set by enrichment
      pnlUSD: 0,
      // set by enrichment
      pnlPct: 0,
      // set by enrichment
      unclaimedFeeA: dFeeA,
      unclaimedFeeB: dFeeB,
      unclaimedFeeUSD: feeUsd,
      unclaimedRewardUSD: unclRewardUsd,
      openedAt: 0,
      // set by enrichment
      daysOpen: 0,
      // set by enrichment
      lifetimeEarningsUSD: 0,
      // set by enrichment
      vsHodlDeltaUSD: 0,
      // set by enrichment
      aprEstimatePct: 0,
      // set by enrichment
      historyPartial: false
    });
  }
  out.sort((a, b) => (b.currentValueUSD ?? 0) - (a.currentValueUSD ?? 0));
  return out;
}

// src/services/aftermathService.ts
import { Aftermath as Aftermath2 } from "aftermath-ts-sdk";
var _sdk = null;
var _sdkFailed = false;
var _sdkInflight = null;
async function getAftermathSdk() {
  if (_sdkFailed) return null;
  if (_sdk) return _sdk;
  if (_sdkInflight) return _sdkInflight;
  _sdkInflight = (async () => {
    try {
      const a = new Aftermath2("MAINNET");
      await a.init({ fullnodeUrl: getRpcUrl() });
      _sdk = a;
      return a;
    } catch (err) {
      console.error("[Aftermath] SDK init failed:", err);
      _sdkFailed = true;
      return null;
    } finally {
      _sdkInflight = null;
    }
  })();
  return _sdkInflight;
}
function addLeadingZeros(coinType) {
  const sep = coinType.indexOf("::");
  if (sep < 0) {
    if (!coinType.startsWith("0x")) return coinType;
    const hex2 = coinType.slice(2);
    return hex2.length >= 64 ? coinType : "0x" + hex2.padStart(64, "0");
  }
  const addr = coinType.slice(0, sep);
  if (!addr.startsWith("0x")) return coinType;
  const hex = addr.slice(2);
  if (hex.length >= 64) return coinType;
  return "0x" + hex.padStart(64, "0") + coinType.slice(sep);
}
function coinSymbolFromType(coinType) {
  const sym = coinType.split("::").pop();
  return sym && sym.length > 0 ? sym : "?";
}
function poolNameFromLpType(lpCoinType) {
  const raw = coinSymbolFromType(lpCoinType).toLowerCase();
  const stripped = raw.replace(/^af_lp_/, "");
  const parts = stripped.split("_").filter(Boolean);
  return parts.map((p) => p.toUpperCase()).join("/") + " LP";
}
function symbolsFromLpType(lpCoinType) {
  const raw = coinSymbolFromType(lpCoinType).toLowerCase();
  const stripped = raw.replace(/^af_lp_/, "");
  const parts = stripped.split("_").filter(Boolean);
  if (parts.length === 0) return ["?", "?"];
  if (parts.length === 1) return [parts[0].toUpperCase(), "?"];
  if (parts.length === 2) return [parts[0].toUpperCase(), parts[1].toUpperCase()];
  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid).join("").toUpperCase(), parts.slice(mid).join("").toUpperCase()];
}
function toBigInt(v) {
  if (v == null) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "string") {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  }
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.round(v));
  return 0n;
}
async function fetchCoinDecimals(coinTypes) {
  const result = /* @__PURE__ */ new Map();
  await mapPool([...coinTypes], RPC_CONCURRENCY, async (ct) => {
    const fallback = 9;
    try {
      const meta = await suiClient.getCoinMetadata({ coinType: ct });
      const dec = typeof meta?.decimals === "number" && meta.decimals >= 0 ? meta.decimals : fallback;
      result.set(ct, dec);
      result.set(addLeadingZeros(ct), dec);
    } catch {
      result.set(ct, fallback);
      result.set(addLeadingZeros(ct), fallback);
    }
  });
  return result;
}
async function getAftermathFarmsPositions(walletAddress) {
  const sdk2 = await getAftermathSdk();
  if (!sdk2) return [];
  const farmsApi = sdk2.Farms();
  const poolsApi = sdk2.Pools();
  const pricesApi = sdk2.Prices();
  const stakedPositions = await farmsApi.getOwnedStakedPositions({ walletAddress });
  console.debug("[Aftermath] stakedPositions:", stakedPositions.length);
  if (!stakedPositions.length) return [];
  const uniqueStakingPoolIds = [
    ...new Set(stakedPositions.map((p) => p.stakedPosition.stakingPoolObjectId))
  ];
  const stakingPools = await farmsApi.getStakingPools({ objectIds: uniqueStakingPoolIds });
  const stakingPoolById = new Map(stakingPools.map((sp) => [sp.stakingPool.objectId, sp]));
  console.debug("[Aftermath] stakingPools:", stakingPools.length);
  const uniqueLpCoinTypes = [
    ...new Set(stakedPositions.map((p) => addLeadingZeros(p.stakedPosition.stakeCoinType)))
  ];
  let poolIdArrays = [];
  try {
    const raw = await poolsApi.getPoolObjectIdsForLpCoinTypes({ lpCoinTypes: uniqueLpCoinTypes });
    poolIdArrays = Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.warn("[Aftermath] getPoolObjectIdsForLpCoinTypes failed:", e);
  }
  console.debug("[Aftermath] poolIdArrays:", JSON.stringify(poolIdArrays));
  const lpCoinTypeToPoolId = /* @__PURE__ */ new Map();
  uniqueLpCoinTypes.forEach((lpType, i) => {
    const entry = poolIdArrays[i];
    if (Array.isArray(entry) && entry.length > 0) lpCoinTypeToPoolId.set(lpType, String(entry[0]));
    else if (typeof entry === "string" && entry.length > 0) lpCoinTypeToPoolId.set(lpType, entry);
  });
  const uniquePoolIds = [.../* @__PURE__ */ new Set([...lpCoinTypeToPoolId.values()])].filter(Boolean);
  const ammPools = uniquePoolIds.length ? await poolsApi.getPools({ objectIds: uniquePoolIds }).catch(() => []) : [];
  const ammPoolById = new Map(ammPools.map((p) => [p.pool.objectId, p]));
  console.debug("[Aftermath] ammPools:", ammPools.length);
  const rawCoinTypes = /* @__PURE__ */ new Set();
  for (const pool of ammPools) {
    const coins = pool.pool?.coins;
    if (coins) Object.keys(coins).forEach((ct) => rawCoinTypes.add(ct));
  }
  for (const sp of stakingPools) sp.rewardCoinTypes().forEach((ct) => rawCoinTypes.add(ct));
  uniqueLpCoinTypes.forEach((ct) => rawCoinTypes.add(ct));
  const priceInfoRaw = await pricesApi.getCoinsToPriceInfo({
    coins: [...rawCoinTypes].map(addLeadingZeros)
  }).catch(() => ({}));
  const priceMap = /* @__PURE__ */ new Map();
  for (const [ct, info] of Object.entries(priceInfoRaw)) {
    const price = info.price ?? 0;
    priceMap.set(ct, price);
    priceMap.set(addLeadingZeros(ct), price);
  }
  const getPrice = (ct) => priceMap.get(ct) ?? priceMap.get(addLeadingZeros(ct)) ?? 0;
  const metaTypes = /* @__PURE__ */ new Set();
  stakedPositions.forEach((p) => metaTypes.add(p.stakedPosition.stakeCoinType));
  for (const sp of stakingPools) sp.rewardCoinTypes().forEach((ct) => metaTypes.add(ct));
  for (const pool of ammPools) {
    const coins = pool.pool?.coins;
    if (coins) Object.keys(coins).forEach((ct) => metaTypes.add(ct));
  }
  const actualDecimals = await fetchCoinDecimals(metaTypes);
  const getActualDec = (ct) => actualDecimals.get(ct) ?? actualDecimals.get(addLeadingZeros(ct)) ?? 9;
  console.debug("[Aftermath] actualDecimals:", [...actualDecimals.entries()].slice(0, 6));
  const result = [];
  for (const pos of stakedPositions) {
    const sp = pos.stakedPosition;
    const normalizedStakeCoinType = addLeadingZeros(sp.stakeCoinType);
    const stakingPool = stakingPoolById.get(sp.stakingPoolObjectId);
    if (!stakingPool) {
      console.warn("[Aftermath] No staking pool for:", sp.stakingPoolObjectId);
      continue;
    }
    const poolId = lpCoinTypeToPoolId.get(normalizedStakeCoinType) ?? "";
    const ammPool = poolId ? ammPoolById.get(poolId) : null;
    console.debug("[Aftermath] pos", sp.objectId, "| poolId:", poolId, "| ammPool:", !!ammPool);
    const farmTvl = await farmsApi.getTVL({ farmIds: [sp.stakingPoolObjectId] }).catch(() => 0);
    console.debug("[Aftermath] farmTvl:", farmTvl);
    const poolCoins = ammPool?.pool?.coins ?? {};
    const coinTypeList = Object.keys(poolCoins);
    const AFTERMATH_FIXED_ONE_N = 1e18;
    const poolCoinHumanBals = {};
    let totalPoolUSD = 0;
    for (const [ct, coin] of Object.entries(poolCoins)) {
      const normalizedBal = toBigInt(coin.normalizedBalance ?? coin.balance ?? 0n);
      const humanBal = Number(normalizedBal) / AFTERMATH_FIXED_ONE_N;
      const price = getPrice(ct);
      poolCoinHumanBals[ct] = humanBal;
      totalPoolUSD += humanBal * price;
    }
    const lpCoinDecimals = typeof ammPool?.pool?.lpCoinDecimals === "number" ? ammPool.pool.lpCoinDecimals : 9;
    const stakedRaw = toBigInt(sp.stakedAmount);
    const humanStaked = Number(stakedRaw) / Math.pow(10, lpCoinDecimals);
    const poolTotalStakedRaw = toBigInt(stakingPool.stakingPool.stakedAmount);
    let fraction = poolTotalStakedRaw > 0n ? Number(stakedRaw) / Number(poolTotalStakedRaw) : 0;
    if (fraction === 0 && ammPool) {
      const lpSupplyRaw = toBigInt(ammPool.pool?.lpCoinSupply);
      if (lpSupplyRaw > 0n) {
        const rawRatio = Number(stakedRaw) / Number(lpSupplyRaw);
        if (rawRatio > 0 && rawRatio <= 1.01) {
          fraction = rawRatio;
        } else {
          const humanLpSupply = Number(lpSupplyRaw);
          if (humanLpSupply > 0) fraction = humanStaked / humanLpSupply;
        }
      }
    }
    console.debug(
      "[Aftermath] stakedRaw:",
      stakedRaw,
      "| poolTotalStakedRaw:",
      poolTotalStakedRaw,
      "| humanStaked:",
      humanStaked,
      "| fraction:",
      fraction,
      "| farmTvl:",
      farmTvl
    );
    const symbolToPrice = {};
    for (const rct of stakingPool.rewardCoinTypes()) {
      const p = getPrice(rct);
      if (p > 0) symbolToPrice[coinSymbolFromType(rct).toUpperCase()] = p;
    }
    const getPriceRobust = (ct) => {
      const direct = getPrice(ct);
      if (direct > 0) return direct;
      return symbolToPrice[coinSymbolFromType(ct).toUpperCase()] ?? 0;
    };
    const tokenAmounts = {};
    let currentValueUSD = 0;
    for (const [ct, humanBal] of Object.entries(poolCoinHumanBals)) {
      const userAmt = humanBal * fraction;
      tokenAmounts[ct] = userAmt;
      currentValueUSD += userAmt * getPriceRobust(ct);
    }
    if (farmTvl > 0 && fraction > 0) currentValueUSD = farmTvl * fraction;
    console.debug(
      "[Aftermath] totalPoolUSD:",
      totalPoolUSD,
      "| fraction:",
      fraction,
      "| currentValueUSD:",
      currentValueUSD
    );
    const [fallbackA, fallbackB] = symbolsFromLpType(sp.stakeCoinType);
    const tokenAType = coinTypeList[0] ?? "";
    const tokenBType = coinTypeList[1] ?? "";
    const tokenAAmount = tokenAmounts[tokenAType] ?? 0;
    const tokenBAmount = tokenAmounts[tokenBType] ?? 0;
    const tokenA = tokenAType ? coinSymbolFromType(tokenAType) : fallbackA;
    const tokenB = tokenBType ? coinSymbolFromType(tokenBType) : fallbackB;
    const pair = coinTypeList.length >= 2 ? `${tokenA}/${tokenB}` : poolNameFromLpType(sp.stakeCoinType);
    try {
      pos.updatePosition({ stakingPool });
    } catch {
    }
    const rewardBalances = pos.rewardCoinsToClaimableBalance({ stakingPool });
    console.debug("[Aftermath] rewardBalances keys:", Object.keys(rewardBalances));
    let unclaimedRewardUSD = 0;
    const rewardBreakdown = [];
    for (const [ct, rawAmt] of Object.entries(rewardBalances)) {
      const dec = getActualDec(ct);
      const humanAmt = Number(rawAmt) / Math.pow(10, dec);
      const price = getPrice(ct);
      const amtUSD = humanAmt * price;
      unclaimedRewardUSD += amtUSD;
      rewardBreakdown.push({ symbol: coinSymbolFromType(ct), coinType: ct, amount: humanAmt, amountUSD: amtUSD });
    }
    console.debug("[Aftermath] rewards:", rewardBreakdown);
    const AFTERMATH_FIXED_ONE_B = 1e18;
    let aprEstimatePct = 0;
    try {
      if (farmTvl > 0) {
        const coinsToPrice = {};
        const coinsToDecimals = {};
        for (const ct of stakingPool.rewardCoinTypes()) {
          coinsToPrice[ct] = getPrice(ct);
          coinsToDecimals[ct] = getActualDec(ct);
        }
        const baseApr = stakingPool.calcTotalApr({ coinsToPrice, coinsToDecimals, tvlUsd: farmTvl });
        console.debug("[Aftermath] baseApr:", baseApr);
        const userMult = Number(toBigInt(sp.lockMultiplier));
        const effectiveMult = userMult > 0 ? userMult : AFTERMATH_FIXED_ONE_B;
        aprEstimatePct = baseApr * (effectiveMult / AFTERMATH_FIXED_ONE_B) * 100;
      }
    } catch (e) {
      console.debug("[Aftermath] APR error:", e);
    }
    const lockStartMs = sp.lockStartTimestamp ?? 0;
    const openedAt = lockStartMs > 0 ? Math.floor(lockStartMs / 1e3) : 0;
    const daysOpen = openedAt > 0 ? (Date.now() / 1e3 - openedAt) / 86400 : 0;
    let aftermathLockUnlockMs;
    try {
      if (sp.lockDurationMs > 0) {
        const unlockMs = pos.unlockTimestamp();
        aftermathLockUnlockMs = unlockMs > 0 ? unlockMs : void 0;
      }
    } catch {
    }
    result.push({
      id: sp.objectId,
      protocol: "aftermath",
      poolId,
      pair,
      tokenA,
      tokenB,
      tokenAAddress: tokenAType,
      tokenBAddress: tokenBType,
      tokenAIconUrl: null,
      tokenBIconUrl: null,
      tokenADecimals: getActualDec(tokenAType),
      tokenBDecimals: getActualDec(tokenBType),
      fee: 0,
      tickLower: 0,
      tickUpper: 0,
      currentTick: 0,
      currentSqrtPrice: "0",
      liquidity: "0",
      status: "in_range",
      tokenAAmount,
      tokenBAmount,
      currentPriceA_USD: getPrice(tokenAType),
      currentPriceB_USD: getPrice(tokenBType),
      currentValueUSD,
      depositedUSD: 0,
      pnlUSD: 0,
      pnlPct: 0,
      unclaimedFeeA: 0,
      unclaimedFeeB: 0,
      unclaimedFeeUSD: 0,
      unclaimedRewardUSD,
      openedAt,
      daysOpen,
      lifetimeEarningsUSD: 0,
      vsHodlDeltaUSD: 0,
      aprEstimatePct,
      aftermathRewardBreakdown: rewardBreakdown.length > 0 ? rewardBreakdown : void 0,
      aftermathLockUnlockMs,
      aftermathLpAmount: humanStaked
    });
  }
  return result;
}

// src/services/portfolioLpSources.ts
var LP_SOURCE_CONCURRENCY = (() => {
  const n2 = Number(process.env.PORTFOLIO_LP_SOURCE_CONCURRENCY ?? 4);
  return Number.isFinite(n2) && n2 >= 1 && n2 <= 12 ? n2 : 6;
})();
var PORTFOLIO_LP_SOURCE_IDS = [
  "momentum",
  "bluefin",
  "cetus-clmm",
  "cetus-dlmm",
  "cetus-vaults",
  "haedal-vaults",
  "haedal-lending-vaults",
  "current-multiply",
  "turbos",
  "aftermath"
];
var LOADERS = {
  momentum: (w) => getMomentumPositions(w),
  bluefin: (w, o) => getBluefinSpotPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
  "cetus-clmm": (w, o) => getCetusPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
  "cetus-dlmm": (w, o) => getCetusDlmmPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
  "cetus-vaults": (w, o) => getCetusVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
  "haedal-vaults": (w, o) => getHaedalVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
  "haedal-lending-vaults": (w, o) => getHaedalLendingVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
  "current-multiply": (w, o) => getCurrentMultiplyVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
  turbos: (w) => getTurbosPositions(w),
  aftermath: (w) => getAftermathFarmsPositions(w)
};
async function loadPortfolioLpSource(id, wallet, opts) {
  try {
    const positions = await LOADERS[id](wallet, opts);
    return { id, ok: true, positions };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { id, ok: false, error, positions: [] };
  }
}
async function loadAllPortfolioLpSources(wallet, opts) {
  const parallelIds = PORTFOLIO_LP_SOURCE_IDS.filter((id) => id !== "current-multiply");
  const parallelLoads = await mapPool(parallelIds, LP_SOURCE_CONCURRENCY, async (id) => {
    try {
      return await loadPortfolioLpSource(id, wallet, opts);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { id, ok: false, error, positions: [] };
    }
  });
  let multiplyLoad;
  try {
    multiplyLoad = await loadPortfolioLpSource("current-multiply", wallet, opts);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    multiplyLoad = { id: "current-multiply", ok: false, error, positions: [] };
  }
  const byId = new Map([
    ...parallelLoads.map((l) => [l.id, l]),
    [multiplyLoad.id, multiplyLoad]
  ]);
  const loads = PORTFOLIO_LP_SOURCE_IDS.map((id) => byId.get(id));
  const statuses = loads.map((l) => ({
    id: l.id,
    ok: l.ok,
    error: l.error,
    count: l.ok ? l.positions.length : 0
  }));
  const incomplete = loads.some((l) => !l.ok);
  const positions = loads.filter((l) => l.ok).flatMap((l) => l.positions);
  return { loads, statuses, positions, incomplete };
}

// src/services/server/loadPortfolioSnapshot.ts
var EMPTY_LEND = {
  supplies: [],
  borrows: [],
  totalSuppliedUSD: 0,
  totalBorrowedUSD: 0,
  netValueUSD: 0,
  healthFactor: null,
  rewardsToClaim: [],
  protocol: "AlphaLend"
};
function logSnapErr(part, e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[snapshot] ${part}:`, msg);
}
async function loadPortfolioSnapshotForAddress(rawAddress) {
  const full = await loadPortfolioSnapshotDetailed(rawAddress);
  if (full.incomplete || !full.snapshot) return null;
  return { ...full.snapshot, incomplete: false, lpSources: full.lpSources };
}
async function loadPortfolioSnapshotDetailed(rawAddress) {
  let result = await loadPortfolioSnapshotDetailedOnce(rawAddress);
  if (result.incomplete && resolveSuiDataTransport() !== "jsonrpc") {
    const prev = process.env.SUI_DATA_TRANSPORT;
    const prevVite = process.env.VITE_SUI_DATA_TRANSPORT;
    try {
      process.env.SUI_DATA_TRANSPORT = "jsonrpc";
      process.env.VITE_SUI_DATA_TRANSPORT = "jsonrpc";
      _resetPortfolioReadSuiClientForTests();
      const retry = await loadPortfolioSnapshotDetailedOnce(rawAddress);
      if (!retry.incomplete) result = retry;
    } finally {
      if (prev === void 0) delete process.env.SUI_DATA_TRANSPORT;
      else process.env.SUI_DATA_TRANSPORT = prev;
      if (prevVite === void 0) delete process.env.VITE_SUI_DATA_TRANSPORT;
      else process.env.VITE_SUI_DATA_TRANSPORT = prevVite;
      _resetPortfolioReadSuiClientForTests();
    }
  }
  return result;
}
async function loadPortfolioSnapshotDetailedOnce(rawAddress) {
  const walletAddr = normalizeSuiAddress15(rawAddress).toLowerCase();
  const client = createServerSuiClient();
  const lendingSources = [];
  let balanceOk = true;
  const balance = await getWalletBalance(walletAddr, client).catch((e) => {
    balanceOk = false;
    logSnapErr("balance", e);
    return [];
  });
  let lend = EMPTY_LEND;
  try {
    lend = await getLendingPositions(walletAddr);
    lendingSources.push({ id: "alphalend", ok: true, status: "ok" });
  } catch (e) {
    logSnapErr("alphalend", e);
    lendingSources.push({
      id: "alphalend",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      status: "unavailable"
    });
  }
  let navi = EMPTY_NAVI_SNAP;
  try {
    navi = await getNaviPositions(walletAddr);
    lendingSources.push({ id: "navi", ok: true, status: "ok" });
  } catch (e) {
    logSnapErr("navi", e);
    lendingSources.push({
      id: "navi",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      status: "unavailable"
    });
  }
  let current = EMPTY_CURRENT_SNAP;
  try {
    current = await getCurrentPositions(walletAddr);
    lendingSources.push({ id: "current", ok: true, status: "ok" });
  } catch (e) {
    logSnapErr("current", e);
    lendingSources.push({
      id: "current",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      status: "unavailable"
    });
  }
  const lp = await loadAllPortfolioLpSources(walletAddr);
  let walletVisibleUSD = 0;
  let classifyOk = true;
  try {
    const bucket = await classifyAllBalances(balance);
    walletVisibleUSD = sumVisibleWalletUSD(bucket);
  } catch (e) {
    classifyOk = false;
    logSnapErr("walletClassify", e);
  }
  return assemblePortfolioSnapshot({
    walletAddr,
    hourBucket: currentHourBucket(),
    balanceOk,
    classifyOk,
    walletUSD: finiteUsd(walletVisibleUSD),
    lpLoads: lp.loads,
    positions: lp.positions,
    lendingSources,
    lendingNetUSD: finiteUsd(
      finiteUsd(lend.netValueUSD) + finiteUsd(navi.netValueUSD) + finiteUsd(current.netValueUSD)
    )
  });
}
function assemblePortfolioSnapshot(input) {
  const lpSources = input.lpLoads.map((l) => ({
    id: l.id,
    ok: l.ok,
    error: l.error,
    count: l.ok ? l.positions.length : 0
  }));
  const lpIncomplete = input.lpLoads.some((l) => !l.ok);
  const lendingIncomplete = input.lendingSources.some((s) => s.status !== "ok" || !s.ok);
  const incomplete = lpIncomplete || lendingIncomplete || !input.balanceOk || !input.classifyOk;
  let lpUSD = 0;
  let aftermathUSD = 0;
  for (const p of input.positions) {
    let val = null;
    if (isCurrentMultiplyVaultPosition(p)) {
      val = multiplyPortfolioContribution(p).usd;
    } else {
      val = positionValueUsdOrNull(p) ?? liquidityUsdOrNull(p);
    }
    if (val == null) continue;
    if (p.protocol === "aftermath") aftermathUSD += val;
    else lpUSD += val;
  }
  const walletUSD = finiteUsd(input.walletUSD);
  const totalUSD = finiteUsd(walletUSD + lpUSD + aftermathUSD + input.lendingNetUSD);
  if (totalUSD <= 0 && !incomplete) {
    return {
      snapshot: null,
      incomplete: false,
      lpSources,
      lendingSources: input.lendingSources,
      preservePreviousIfIncomplete: false
    };
  }
  const snapshot = {
    id: makeSnapshotId(input.walletAddr, input.hourBucket),
    walletAddr: input.walletAddr,
    hourBucket: input.hourBucket,
    ts: input.hourBucket,
    lpUSD: finiteUsd(lpUSD),
    aftermathUSD: finiteUsd(aftermathUSD),
    lendingNetUSD: input.lendingNetUSD,
    walletUSD,
    totalUSD,
    incomplete,
    lpSources
  };
  return {
    snapshot,
    incomplete,
    lpSources,
    lendingSources: input.lendingSources,
    preservePreviousIfIncomplete: incomplete
  };
}

// server/cronEntry.ts
async function runPortfolioSnapshotForWallet(wallet) {
  return loadPortfolioSnapshotForAddress(wallet);
}
export {
  runPortfolioSnapshotForWallet
};
