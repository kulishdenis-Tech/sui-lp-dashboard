# v2.5.14 report (`fix/closed-2.5.14`)

## Changes
1. **N11 Momentum closed=0 regression** — root: under multi-lane stress `getAllPools` could yield/poison empty cache → all pool metas null → silent `positions=[]` with `incomplete=false` (FAIL). Fix: never cache empty pools; retry; mark `meta_miss` / truncated empty as `incomplete`. Solo always had 49; full now **49≥22 PASS**.
2. **Tests** — truncated/meta_miss empty → `incomplete`, not silent complete zero (`closedIncomplete.test.ts` 3/3).
3. **Cetus closed speed** — bounded build concurrency (default 8), parallel multiGet chunks, coin-meta cache. N07 cold closed ~80s; W11 full `closed.cetus=77s` (≤120). Fat wallets still scan-bound when deep recovery runs.
4. **No serve-prod / no master merge** — laptop is not prod.

## Solo TIMEOUT (lanes=1)
| Wallet | Elapsed | Key steps | Result |
|--------|--------:|-----------|--------|
| N05 | 294s | scanSession 91s · closed.cetus 139s · closed.turbos 84s | PASS |
| N19 | 329s | scanSession 95s · closed.cetus 210s · closed.turbos 154s | PASS |

(Multi-lane TIMEOUT was contention, not solo impossibility.)

## INCONCLUSIVE from 2.5.13 (reference)
N05 TIMEOUT · N19 TIMEOUT · N07/N08/N09/W04/W05 closed truncated below min.

## Full `--full --lanes 3 --timeout-ms 900000`
`PASS=162 FAIL=1 INCONCLUSIVE=8` · 4447s · exit 1

### Per wallet vs 2.5.13
| | 2.5.13 | 2.5.14 |
|--|--------|--------|
| PASS wallets | 21 | **26** |
| FAIL | 4 (N01,N11,W01,W03) | **1** (W01 dust Suilend) |
| INCONCLUSIVE | 7 | **5** (N07,N08,N19,W04,W05) |
| TIMEOUT | 2 (N05,N19) | **1** (N19) |
| N11 momentum | FAIL 0&lt;22 | **PASS 49≥22** |
| N05 | TIMEOUT | **PASS** |

### 2.5.14 INCONCLUSIVE
| Wallet | Reason |
|--------|--------|
| N07 | bluefin 0&lt;2 truncated |
| N08 | momentum 0&lt;4 truncated |
| N19 | TIMEOUT 900s |
| W04 | cetus/bluefin truncated |
| W05 | bluefin truncated |

W01 FAIL: suilend dust 0.0089 !~ 0.01 (±5%) + truncated closed mins.
