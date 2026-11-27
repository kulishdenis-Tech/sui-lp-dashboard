# v2.5.13 report

## Setup
- Start: `5ecf0e5` · serve-prod **pid 46032** (no restart)

## 1) TIMEOUT solo (`--lanes 1`, closed concurrency)

| Wallet | Before (seq / multi-lane 2.5.11) | After solo conc=2 | Bottleneck |
|--------|----------------------------------|-------------------|------------|
| N07 | TIMEOUT 900s (lanes=3) · solo seq **339.6s** closed=233 | **238.6s** PASS · closed=148 (cetus 138 + turbos 130 overlap) | closed.cetus/turbos |
| W02 | TIMEOUT 900s | **358s** PASS · closed.cetus=227 | closed.cetus |
| W02s | TIMEOUT 900s | **370s** PASS · closed.cetus=222 | closed.cetus |
| W04 | TIMEOUT 900s | **361s** PASS · closed.cetus=162 | closed.cetus |
| W05 | TIMEOUT 900s | **97s** PASS | — |
| W06 | TIMEOUT 900s | **145s** PASS | scanSession 96 |

**Cause:** 2.5.10 fully-sequential closed stacked 4 adapters after slow `scanSession` **and** multi-lane GraphQL stampede → 900s. Not “sequential alone = 900s” (N07 solo seq finished in 340s).

**Fix:** `REVIEW_CLOSED_CONCURRENCY=2` (default) + per-adapter `closed.*` stageMs; throttle default in-flight 4 / gap 60ms.

**≤180s cold:** hit for W05/W06 only. N07/W02-class still wall-clock-bound by `closed.cetus` (~140–230s). Further cut needs adapter page caps, not more concurrency (conc=2 already ≈ max(cetus,turbos)).

## 2) Suilend N10 / N19 / W01 (pre-resnap)

| ID | Live supply | Anchor | Δ% | Live borrow | Anchor | Δ% | Reason |
|----|------------:|-------:|---:|------------:|-------:|---:|--------|
| N10 | 1 145 930 | 966 281 | **+18.6%** | 957 456 | 816 844 | **+17.2%** | EEARN/PPLUS still present + **new XAUM**; USD up → amount+price |
| N19 | 138 | 0 | ∞ | 77 | 0 | ∞ | **new_positions** (BTC/SUI + USDSUI borrow) |
| W01 | 0.0089 | 0.01 | **−11%** | 0 | 0 | 0 | dust SUI/SPRING_SUI **price_drift** |

Resnapshotted N10/N19/W01 @ `2026-11-27T16:52:30.244Z` (±5% unchanged).

## 3) Full `--full --timeout-ms 900000 --lanes 3`

`PASS=148 FAIL=5 INCONCLUSIVE=9` · 4694s · exit 1

### Per wallet
| Verdict | Wallets | Reason |
|---------|---------|--------|
| PASS | N02–N04, N06, N10, N12–N18, N20, W02, W02s, W06–W11 | |
| FAIL | N01 | suilend supply dust/price vs 1.42 |
| FAIL | N11 | closed momentum 0 &lt; 22 (not truncated → hard FAIL) |
| FAIL | W01 | suilend dust 0.0089 !~ 0.01 (+ momentum truncated) |
| FAIL | W03 | suilend supply/borrow drift vs anchors |
| INCONCLUSIVE | N05, N19 | **TIMEOUT 900s** |
| INCONCLUSIVE | N07, N08, N09, W04, W05 | closed truncated below min |

### TIMEOUT vs 2.5.9 / 2.5.11
| Version | TIMEOUT wallets | Count |
|---------|-----------------|------:|
| 2.5.9 | N09 | **1** |
| 2.5.11 | N07, W02, W02s, W04, W05, W06 | **6** |
| 2.5.13 | N05, N19 | **2** |

Former 2.5.11 TIMEOUT set: **0/6 still TIMEOUT** under lanes=3 (N07/W04/W05 → truncated INCONCLUSIVE; W02/W02s/W06 → PASS).
