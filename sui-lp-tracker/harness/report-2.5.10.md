# v2.5.10 report

Snapshot / runs: 2026-11-27 (Kyiv). Master before package: `7a7bcab` (2.5.9).

## Setup

- `master` @ `7a7bcab` → this package bumps to **2.5.10**
- `serve-prod` :4173 pid **32300** (at package start)

## 1) Cetus closed — N06 solo (`--full --wallets N06 --lanes 1`)

| Metric | Value |
|--------|------:|
| expect `closedAtLeast.cetus` | 26 |
| live closed (after fix) | **1560** |
| verdict | **PASS** `1560 ≥ 26` |
| wall time | 594.9s (closed stage 476.3s) |

**Before fix (same solo command):** `closed cetus 0 < 26` INCONCLUSIVE (`page_cap`).  
Primary GraphQL/Sender scan already had **1560 ClosePosition seeds** / ~1598 positions; `multiGetObjects` for pool coin types timed out under gRPC cooldown → all seeds dropped → silent zero.  

**Fix:** chunked pool-meta retry; if meta still empty → **placeholder coin types** so burned NFTs stay in the closed list; skip deep-rescan when seeds already exist; skip per-position deep typed when wallet map already has events.  
Under load, INCONCLUSIVE is not “skip” — stepwise retry then keep rows.

Isolated diag (no harness): `closePositionEventPids=1560`, `liveClosed=1560`.

## 2) Suilend §8.1 — anchors resnapshot

`suilendAnchorSnapshotAtUTC` = **2026-11-27T10:51:18.736Z** (same pass). ±5% unchanged.

| Wallet | old supply | new supply | old borrow | new borrow |
|--------|-----------:|-----------:|-----------:|-----------:|
| N04 | 3314.75 | **2938.90** | 1545.64 | **1547.83** |
| N05 | 55142.17 | **55201.71** | 23799.92 | **26190.51** |
| N08 | 387.94 | **28.12** | 22.17 | **0** |
| N09 | 8.32 | **1.43** | 0 | **0** |
| N13 | 8713.74 | **9806.50** | 2433.89 | **2296.97** |
| N14 | 36072.16 | **26098.38** | 14987.52 | **13751.64** |
| N16 | 30957.32 | **32704.39** | 16450.45 | **18621.35** |
| W01 | 0.01 | **0.01** | 0 | **0** |
| W03 | 4308.55 | **4779.63** | 2499.80 | **2500.58** |

### N08 deposit/withdraw

- All fixture assets still present (WAL, IKA, sSUI, SEND); `missing_vs_fixture = []`.
- Live underlying amounts ≈ fixture-implied amounts (e.g. WAL ~1133); **borrow 22.17 → 0** (repaid).
- Supply USD 387.94 → 28.12 (−92.8%): valuation/price path on same deposits, not a missing obligation.  
  WAL implied snap px ~0.331 vs live llama ~0.023 (ratio 0.07).

### N14 −28% by asset (live vs old anchor mv)

| Asset | live_usd | fix_mv | usd Δ% | live/implied px ratio | dominant |
|-------|---------:|-------:|-------:|----------------------:|----------|
| xBTC | 6155 | 8164 | −24.6% | 0.754 | price |
| DEEP | 828 | 1654 | −49.9% | 0.501 | price |
| sSUI | 13533 | 18793 | −28.0% | 0.720 | price |
| WBTC | 5325 | 6840 | −22.1% | 0.779 | price |
| WAL | 238 | 622 | −61.8% | 0.382 | price |
| **sum** | **26080** | **36072** | **−27.7%** | | **price_drift** |

No missing deposits vs fixture.

## 3) N09 TIMEOUT

Solo `--full --wallets N09 --lanes 1 --timeout-ms 900000`: **200.1s complete** (no TIMEOUT).

| Stage | ms |
|-------|---:|
| suilend | 8630 |
| scallop | 558 |
| opens | 24267 |
| scanSession | 64130 (momentum 64126, bluefin 51665) |
| enrichment | 219 |
| unsupported | 4176 |
| **closed** | **98064** |
| **total** | **200055** |

Prior full 3-lane TIMEOUT @ 900s was RPC contention, not a 200s+ intrinsic wallet.  
**Fix:** harness full-mode closed adapters run **sequentially** (not `Promise.all`) to cut stampede.

N09 §8.1 supply also resnapshotted 8.32 → 1.43 (solo measured 1.43).

## Code / fixture

- `cetusClosedPositions.ts` / `cetusLpEvents.ts` — meta retry + placeholders + less deep spam
- `review-fixture-live.ts` — sequential closed
- `regression_fixture_v2.json` — new `expect.suilend` + `suilendAnchorSnapshotAtUTC`
