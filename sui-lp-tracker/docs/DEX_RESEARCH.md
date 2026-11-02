# DEX Research — Arbitrage Scanner (Phase A)

**Status:** Research for Phase B adapters  
**Date:** 2026-09-12  
**Rule:** Prefer official SDK docs/contracts. Fuzzland `sui-mev` / Mysten `capybot` = architecture reference only, not copy-paste.

---

## 1. Summary table

| DEX | Type | Official quote path | In tracker today | Phase |
|-----|------|---------------------|------------------|-------|
| **Cetus** | CLMM | `@cetusprotocol/sui-clmm-sdk` → `Swap.preSwap` / `calculateRates` | Positions via RPC; SDK underused | **B** |
| **Turbos** | CLMM | `turbos-clmm-sdk` → `trade.computeSwapResultV2` | Positions via RPC; SDK **not installed** | **B** |
| **Aftermath** | AMM + router | `aftermath-ts-sdk` → `Router.getCompleteTradeRouteGivenAmountIn` | Farms + spots | **G** (or late C for compare) |
| **DeepBook** | CLOB | Mysten DeepBook v3 SDK / on-chain books | None | **G** |
| **Momentum** | CLMM | `@mmt-finance/clmm-sdk` (positions; confirm swap quote API) | Positions | Later |
| **FlowX** | AMM/CLMM | TBD official | Types only | Later |
| **Kriya** | AMM | TBD official | Package IDs only | Later |
| **Bluefin** | CLMM | Spot API / SDK TBD for swaps | Positions | Optional later |

---

## 2. Cetus — how quotes will work

### Official sources

- Developer docs: [Pre Swap](https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk-v2/sdk-modules/cetusprotocol-sui-clmm-sdk/pre-swap)  
- Pools: [Getting CLMM Pools](https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk-v2/sdk-modules/cetusprotocol-sui-clmm-sdk/getting-clmm-pools)  
- Package in repo: `@cetusprotocol/sui-clmm-sdk` (^1.4.3)  
- Tracker package ID: `PROTOCOLS.CETUS_CLMM` in `src/utils/constants.ts`

### Recommended quote pipeline (executable, not mid)

1. Init SDK with **our** RPC: `CetusClmmSDK.createSDK({ env: 'mainnet', full_rpc_url | sui_client })`  
2. `sdk.Pool.getPool(poolId)` → `current_sqrt_price`, coin types, fee, liquidity  
3. Prefer one of:
   - **Simulate:** `sdk.Swap.preSwap({ pool, current_sqrt_price, coin_type_a/b, decimals_a/b, a2b, by_amount_in: true, amount })`  
   - **Local CLMM:** `sdk.Pool.fetchTicks` / `fetchTicksByRpc` then `sdk.Swap.calculateRates({ …, swap_ticks, current_pool })`  
4. Map result → `SwapQuote`:
   - `amountIn` / `amountOut` (raw bigint)  
   - `feeAmount` if exposed  
   - `sqrtPriceAfter` / ticks crossed if available  
   - `priceImpactPct` derived vs pre-trade mid from sqrt price  
   - `asOfMs` + checkpoint if obtainable  

### Fee / double-counting

DEX fee is **inside** Cetus preSwap amount-out.  
`ProfitCalculator` must **not** subtract pool fee again; document `feesIncludedInQuote: true`.

### Pool discovery

- `sdk.Pool.getPoolsWithPage()` for registry bootstrap  
- Filter by coin types (priority: SUI, USDC, USDT, NS, WAL, DEEP, CETUS)  
- Liquidity USD via quote legs × spot USD (reuse `resolveSpots`)  
- Config `MIN_POOL_LIQUIDITY_USD` (default 5000)

### Risks

- SDK may expect older `@mysten/sui` client shapes → isolate behind adapter + pass `SuiJsonRpcClient` carefully  
- `preSwap` simulation costs RPC; cache pool+ticks briefly  
- Do **not** invent amounts from `current_sqrt_price` alone  

### NS/SUI

Resolve concrete Cetus NS/SUI pool id(s) at Phase B from `getPoolsWithPage` + coin-type filter (do not hardcode unverified ids in docs).

---

## 3. Turbos — how quotes will work

### Official sources

- [preSwap / computeSwapResultV2](https://turbos.gitbook.io/turbos/developer-docs/via-sdk/clmm/preswap)  
- [swap](https://turbos.gitbook.io/turbos/developer-docs/via-sdk/clmm/swap)  
- npm: `turbos-clmm-sdk` (to be added)  
- Tracker package IDs: `PROTOCOLS.TURBOS`, `TURBOS_PUBLISHED_AT` in `constants.ts`

### Recommended quote pipeline

1. `new TurbosSdk(Network.mainnet, { url: resolveServerSuiRpcUrl() })` (API surface evolved; verify against installed major at Phase B)  
2. `turbosSdk.pool.getPool(poolId)`  
3. **Executable quote:**
   ```ts
   await turbosSdk.trade.computeSwapResultV2({
     pools: [{ pool: poolId, a2b, amountSpecified }],
     amountSpecifiedIsInput: true,
     tickStep: 100, // configurable
     address: SHADOW_SIMULATION_ADDRESS, // no key; dry-run sender only
   })
   ```
4. Response fields (per docs): `amount_a`, `amount_b`, `fee_amount`, `sqrt_price`, `tick_current_index`, `liquidity`  
5. Map to common `SwapQuote` with `feesIncludedInQuote: true`

### Discovery

- Use SDK pool list APIs if available; else typed object queries by Turbos pool type + filter  
- Same liquidity / priority-token filters as Cetus  

### Risks

- Docs still show legacy `JsonRpcProvider` examples — must validate against `@mysten/sui` 2.x  
- Requires a **sender address** for simulation even in paper mode → use dedicated burn/watch address, **never** a funded hot wallet key  
- `tickStep` caps how far price can walk; too low → understates impact / false profit  

---

## 4. Aftermath (Phase G preview)

### Official

- [Router](https://docs.aftermath.finance/for-developers/typescript-sdk/products/router)  
- Already in repo: `aftermath-ts-sdk`  

### Quote

```ts
const route = await afSdk.Router().getCompleteTradeRouteGivenAmountIn({
  coinInType, coinOutType, coinInAmount,
  protocolWhitelist: ['Aftermath'], // for single-DEX arb legs; or open for meta-compare
})
```

Returns `coinOut.amount`, fees, `spotPrice`, multi-pool splits.

### Arb role

- Good for **multi-hop within Aftermath** and as a **third venue** vs Cetus/Turbos  
- For fair 2-leg **Cetus↔Turbos** research, keep Aftermath out of the first detector to avoid comparing router-aggregated paths vs single-pool CLMM  

---

## 5. DeepBook (Phase G)

- CLOB, not CLMM — different quote model (order book depth)  
- Integrate via current Mysten DeepBook documentation at implementation time  
- Mark **unsupported** until bid/ask depth quotes are proven executable  

---

## 6. Pool state update strategy

| Mode | When | Mechanism |
|------|------|-----------|
| **Bootstrap** | Startup | `discoverPools` per adapter → `arb_dex_pools` |
| **Refresh** | Every scan tick (target &lt;1s where feasible) | Parallel `getPoolState` / getPool with `mapPool` concurrency limit |
| **Ticks** | Before local calculateRates | `fetchTicks` cached per pool with short TTL |
| **Event-driven (later)** | Optional | Subscribe to pool object changes / swap events; invalidate cache |
| **Staleness** | Always | Each state carries `fetchedAtMs` + optional checkpoint; RouteFinder rejects or flags if `|t1-t2| > MAX_STATE_SKEW_MS` |

Do **not** full-chain scan. Do **not** refetch token decimals every loop (metadata cache).

---

## 7. Expected RPC requirements

| Workload | Estimate (Phase B–C, NS/SUI focus) |
|----------|-------------------------------------|
| Pools watched | Start ~2–20 (NS/SUI fee tiers × 2 DEX), grow to 100+ |
| Per scan | 2× getPool + 2× preSwap/compute × size-grid (or optimize with fewer sizes after coarse pass) |
| Dry-run | Occasional shadow PTB when profit &gt; alert threshold |
| Safe public RPC | Research OK; expect rate limits |
| Dedicated RPC | Required before claiming “capturable” latency |

Primary + fallback URLs via env (`SUI_RPC_URL`, `SUI_RPC_FALLBACK_URLS`).

---

## 8. Reference projects (patterns only)

### Fuzzland / sui-mev

Use for: concurrent pool fetch patterns, opportunity structs, Sui object ownership pitfalls.  
Do **not** copy execution / flash-loan bots into this tracker.

### Mysten / capybot

Use for: PTB construction style, multi-DEX bot skeleton, simulation mindset.  
Do **not** port trading loop into the SPA.

---

## 9. CLMM math policy

**Forbidden:** constant-product `x*y=k` for Cetus/Turbos profitability.  

**Required:** official preSwap / computeSwapResult / calculateRates with ticks.  

**Tests (Phase B+):** decimals, a2b direction, fee-in-quote, large size impact, insufficient liquidity, RPC failure → `unsupported` / null quote (never fake numbers).

---

## 10. Flash loans (Phase 1 economics only)

- Research Cetus flash-loan package at Phase D/E using **current** Cetus docs  
- `FlashLoanEstimator`: fee bps × borrow notional  
- Field `capitalMode: 'OWN_CAPITAL' | 'FLASH_LOAN_SIMULATION'`  
- **No** flash-loan PTB execution in Phase 1  

---

## 11. Open questions (resolve in Phase B kickoff)

1. Exact mainnet NS coin type + Cetus/Turbos pool object ids for primary fee tier(s).  
2. Cetus SDK init API on installed `^1.4.3` (`createSDK` vs older `initCetusSDK`).  
3. TurbosSdk constructor compatible with `SuiJsonRpcClient` 2.16.  
4. Shadow simulation address (public, empty, documented).  
5. Where worker runs (local Node vs VPS) while Vercel stays dashboard-only.  

---

## 12. Phase B acceptance criteria (when approved)

- [ ] `DexAdapter` interface + Cetus + Turbos implementations  
- [ ] NS/SUI pools discovered and polled  
- [ ] Executable quotes for a size grid logged (not mid-price)  
- [ ] Existing Balance/LP/Lending/Analytics unchanged  
- [ ] `TRADING_ENABLED` compile-time false; no signing imports  
- [ ] Unit tests for quote mapping + profit calc stubs  
- [ ] Typecheck + vitest green  
