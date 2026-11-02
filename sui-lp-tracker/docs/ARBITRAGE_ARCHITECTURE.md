# Arbitrage Scanner — Architecture

**Status:** Phase E infrastructure reliability + long-run research. Supabase/UI/execution not started.  
**Date:** 2026-09-13  
**Scope:** Shadow / paper mode only. No real swaps. No private keys. `TRADING_ENABLED=false` forever in Phase 1.

---

## 1. Current project architecture

### Product

`sui-lp-tracker` is a **read-only** Sui portfolio dashboard:

- Wallet balances + multi-source USD spots  
- Open / closed LP positions (Bluefin, Momentum, Cetus, Turbos)  
- Lending (Navi, AlphaLend) + Aftermath farms  
- Analytics snapshots (~15 min)  
- LP event history enrichment (PnL / HODL / claimed fees)

It does **not** build or sign swap transactions today.

### Stack

| Layer | Choice |
|--------|--------|
| Frontend | Vite 8 + React 19 + TypeScript ~6 + Zustand + React Router 7 + Tailwind 4 |
| Sui | `@mysten/sui` **2.16** (`SuiJsonRpcClient`), `@mysten/dapp-kit` |
| RPC default | `https://sui-rpc.publicnode.com` (Mysten public JSON-RPC deprecated Jul 2026) |
| Backend | Vercel serverless under `api/` |
| DB | Supabase Postgres (service role) |
| Workers | Supabase pg_cron → `/api/cron/dispatch-*` → GitHub Actions → `vite-node` scripts |
| Tests | Vitest |

### Data flow today (portfolio)

```
Browser
  → loadAll(address)
    → balance / LP / lending services (parallel)
    → spotPrice.resolveSpots (OKX → CG → DexScreener → Aftermath → GT → DexPaprika)
    → enrichment (events + historical quotes)
  → Zustand UI tabs: Balance | LP | Lending | Analytics

Server (watchlist only)
  → portfolio_snapshots / lp_position_history / app_visits
```

### Existing DEX usage (critical gap)

| Protocol | Current use | Executable quotes? |
|----------|-------------|--------------------|
| Cetus | Position + event scan (mostly raw RPC; `@cetusprotocol/sui-clmm-sdk` in deps but barely used) | **No** |
| Turbos | Position + event scan (raw RPC + MMT `TickMath`) | **No** (`turbos-clmm-sdk` **not** installed) |
| Aftermath | Farms + spot batch via `aftermath-ts-sdk` | Router exists in SDK; **not wired** for arb |
| Momentum | Positions via `@mmt-finance/clmm-sdk` | **No** |
| Bluefin | Positions + unclaimed | **No** (swap host proxied, no quote client) |
| FlowX / Kriya / DeepBook | Types / constants only or absent | **No** |

**Spot mid prices ≠ executable CLMM prices.** Arb must never use DexScreener/OKX alone for profitability.

### Deployment constraints

- Vercel Hobby is **unsuitable** for sub-second continuous scanning (timeouts, cold starts, billing limits already observed).  
- Local / dedicated worker (Node process or GHA is too slow for live arb; use long-running Node + optional Supabase write).  
- Dev Vite proxies `/api/*` → prod; do **not** import browser modules from `/api/_lib` (already fixed once for black-screen / Vercel 402).

---

## 2. What we can reuse

| Asset | Path | Arb use |
|-------|------|---------|
| RPC client + URL normalize | `src/services/suiClient.ts`, `src/utils/suiRpcUrl.ts` | Pool/object reads; later dry-run |
| Bounded concurrency | `src/utils/concurrency.ts` (`mapPool`) | Parallel pool quotes |
| Rate limiters | `src/utils/rateLimiter.ts` | Protect RPC / DEX APIs |
| Ext / CORS proxy | `src/utils/externalFetchUrl.ts`, `api/ext.ts`, `api/_lib/proxyHosts.ts` | Browser-safe HTTP if needed |
| Spot USD (SUI→USD, gas) | `src/services/spotPrice/*` | Convert gas + PnL to USD **after** executable quotes |
| Coin type normalize | `src/utils/suiCoinType.ts` | Token vertices |
| Package IDs | `src/utils/constants.ts` | Cetus / Turbos package filters |
| Tick helpers | `src/utils/tickPriceRange.ts` + MMT math | Display / sanity checks (not sole quote source) |
| Adapter registry pattern | `src/services/adapters/*` | Model for `DexAdapter` |
| Design system | `src/design/appPrimitives.ts`, `TabNav`, cards | New **ARBITRAGE** tab |
| Supabase admin pattern | `api/_lib/supabaseAdmin.ts` | New arb tables |
| Env patterns | `.env.example`, `vite-env.d.ts` | Scanner config |

**Do not reuse:** portfolio `loadAll`, LP enrichment, position event scanners as the arb hot path.

---

## 3. What must be added

### New module (isolated)

```
src/arbitrage/
  types.ts                 # Pool, PoolState, SwapQuote, Opportunity, …
  config.ts                # env-backed thresholds (MIN_*, sizes, slippage)
  DexAdapter.ts            # interface
  PoolRegistry.ts
  MarketGraph.ts
  RouteFinder.ts           # 2-leg first; 3-leg later
  TradeSizeOptimizer.ts
  ProfitCalculator.ts
  OpportunityTracker.ts    # lifetime / dedupe
  ShadowExecutor.ts        # dry-run only; no sign
  FlashLoanEstimator.ts    # economics only
  latency.ts               # p50/p90/p95/p99
  scanner/
    ArbitrageScanner.ts    # orchestrator loop
    runOnce.ts             # CLI / worker entry
  dex/
    cetus/
    turbos/
    aftermath/
    deepbook/              # stub until Phase G
    flowx/                 # stub
    kriya/                 # stub
    momentum/              # stub / later
  ui/
    ArbitrageModule.tsx
    LiveOpportunitiesTable.tsx
    NsSuiDetailPage.tsx    # special NS/SUI view
    LifetimeHistogram.tsx
    ScannerStatusBar.tsx
```

### Worker (outside Vercel request path)

```
scripts/arbitrage-scan-loop.ts   # long-running Node; TRADING_ENABLED hard-blocked
api/arbitrage/*.ts               # read-only REST for dashboard (opportunities, metrics)
supabase/arbitrage.sql           # new tables
```

### Hard safety

```ts
export const TRADING_ENABLED = false as const
// Phase 1: no ExecutionEngine.signAndExecute; no private key APIs imported
```

Even if env says `TRADING_ENABLED=true`, Phase 1 code paths must not include a signing implementation.

---

## 4. Proposed data flow (Phase 1 shadow)

```
┌─────────────────────┐
│ ArbitrageScanner    │  interval / event wake
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ PoolRegistry        │  discover + filter (liq USD, priority tokens)
└─────────┬───────────┘
          │ concurrent getPoolState (DexAdapter)
          ▼
┌─────────────────────┐
│ MarketGraph         │  directed edges = executable pools
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ RouteFinder         │  2-leg: A→B@DEX1, B→A@DEX2 (start: SUI↔NS Cetus↔Turbos)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ TradeSizeOptimizer  │  grid $10…$5k + local refine
│  + ProfitCalculator │  fees-in-quote, gas, slippage reserve, flash sim
└─────────┬───────────┘
          │ netProfit >= thresholds
          ▼
┌─────────────────────┐
│ OpportunityTracker  │  same routeSignature → update lifetime / peak
└─────────┬───────────┘
          │ optional threshold
          ▼
┌─────────────────────┐
│ ShadowExecutor      │  build PTB (unsigned) → dryRun → record deltas
└─────────┬───────────┘
          │
          ▼
   Supabase + Dashboard (ARBITRAGE tab)
```

---

## 5. Database (proposed)

Reuse Supabase. New SQL (do not alter portfolio tables):

| Table | Purpose |
|-------|---------|
| `arb_dex_pools` | Normalized registry |
| `arb_pool_snapshots` | Sparse state samples (retention policy) |
| `arb_opportunities` | Live + closed opportunities + lifetime |
| `arb_shadow_executions` | Quote vs sim vs reobserve |
| `arb_scanner_metrics` | Latency histograms / scan summaries |

Indexes: `detected_at`, `route_signature`, `status`, `net_profit_usd`, token pair.

Retention: high-freq snapshots TTL (e.g. 24–72h); opportunities kept longer for 72h report.

---

## 6. Dashboard integration

- Add tab **`arbitrage`** beside Analytics (Zustand `AppTab` + `TabNav`).  
- Route optional: `/arbitrage` and `/arbitrage/ns-sui` for deep link.  
- Match existing dark slate / sky design system.  
- UI reads **API** (worker writes DB); browser does **not** run the full scanner loop (RPC overload + extension issues).

Screens:

1. Scanner status + KPIs  
2. Live opportunities table (default sort net profit DESC)  
3. NS/SUI detail (per-DEX executable price, spread, events)  
4. Lifetime histogram  
5. Later: 72h research report page  

---

## 7. RPC / runtime requirements

| Need | Recommendation |
|------|----------------|
| Hot path quotes | Dedicated RPC (Ankr / Alchemy / BlockVision / self-hosted) — PublicNode OK for research, not for competitive latency |
| Fallbacks | Primary + fallback list; health check; timeout; 429 backoff (extend `suiRpcUrl` pattern) |
| State freshness | Attach checkpoint / timestamp to every `PoolState` / `SwapQuote`; flag cross-DEX stale pairs |
| Subscriptions | Prefer object/event subscriptions where reliable; Phase B may start with bounded polling |
| Gas | `devInspect` / dry-run representative 2-leg PTB; cache estimate briefly; SUI→USD via existing spots |

**Latency instrumentation** mandatory on every scan stage (rpc / quote / optimize / sim / total) → p50/p90/p95/p99.

---

## 8. Implementation plan (phased)

| Phase | Deliverable | Gate |
|-------|-------------|------|
| **A** | This audit + `DEX_RESEARCH.md` | **← you are here; wait for approval** |
| **B** | `DexAdapter`, PoolRegistry, Cetus + Turbos adapters, NS/SUI monitor | Typecheck + unit tests; tracker unchanged |
| **C** | 2-leg detector Cetus ↔ Turbos, focus `SUI → NS → SUI` | Paper opportunities in memory / logs |
| **D** | Size grid + net profit (fees, gas, slippage, flash sim fields) | Threshold filters |
| **E** | Supabase tables + lifetime tracker + ShadowExecutor | No signing |
| **F** | ARBITRAGE tab + NS/SUI page | Design-system aligned |
| **G** | Aftermath + DeepBook adapters | Mark unsupported if quotes unreliable |
| **H** | Triangular 3-leg | After 2-leg proven |
| **I** | 48–72h continuous run + research report | Decide whether real execution is justified |

---

## 9. Key risks

1. **False arb from mid prices** — mitigated by SDK preSwap / computeSwapResult only.  
2. **CLMM tick depth** — naive x*y=k forbidden; must use official quote paths.  
3. **Stale cross-DEX state** — different RPC ages invent profit; must timestamp + reject/flag.  
4. **Public RPC latency / limits** — opportunities die in &lt;100ms; research may conclude “not capturable”.  
5. **SDK / Mysten version skew** — Cetus & Turbos SDKs often pin older `@mysten/sui`; isolate adapters + shims (same pattern as AlphaLend).  
6. **Vercel as scanner host** — will fail; worker must be separate.  
7. **NS liquidity thin** — size optimizer critical; large notionals look profitable on mid and lose on impact.  
8. **Flash loan** — Phase 1 economics only; Cetus flash-loan API must be re-verified before any later phase.  
9. **Scope creep** — do not rewrite tracker; keep arb module behind feature flag / separate tab.  
10. **Legal / ToS** — monitoring only in Phase 1; no MEV execution.

---

## 10. Libraries / APIs proposed (Phase B+)

| Purpose | Proposal | Already in repo? |
|---------|----------|------------------|
| Cetus CLMM quotes | `@cetusprotocol/sui-clmm-sdk` — `Pool.getPool` + `Swap.preSwap` / `calculateRates` | Yes (underused) |
| Turbos CLMM quotes | Add `turbos-clmm-sdk` — `pool.getPool` + `trade.computeSwapResultV2` | **No — add** |
| Aftermath routes | Existing `aftermath-ts-sdk` — `Router.getCompleteTradeRouteGivenAmountIn` | Yes |
| Tick math fallback | `@mmt-finance/clmm-sdk` | Yes |
| Sui RPC / dry-run | `@mysten/sui` JsonRpc | Yes |
| DeepBook | Official Mysten DeepBook SDK / on-chain — Phase G | No |
| Reference only | Fuzzland `sui-mev`, Mysten `capybot` — patterns, not copy | — |

---

## 11. Files intended for Phase B (preview — not yet modified)

**Add:**

- `src/arbitrage/**` (as tree above)  
- `docs/DEX_RESEARCH.md` (companion)  
- `supabase/arbitrage.sql` (Phase E)  
- `scripts/arbitrage-scan-once.ts` (later loop)

**Touch lightly:**

- `src/store/appStore.ts` — extend `AppTab` only  
- `src/components/layout/TabNav.tsx` — new tab  
- `src/components/MainContent.tsx` — render `ArbitrageModule`  
- `.env.example` — scanner config keys  
- `package.json` — add `turbos-clmm-sdk` when Phase B starts  

**Do not touch:** wallet signing, `WalletProvider` keys, existing LP/lending services except shared utils.

---

## 12. Stop condition

Phase A ends here. **No Phase B code until explicit approval.**
