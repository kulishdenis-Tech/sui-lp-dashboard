# v2.5.12 report

## N06 PnL diagnosis (pre-fix)
- 1560 unique positionIds / 1560 ClosePosition events / 2 pools
- PnL unique (8dp): 1287; min≈-1.82 max≈35.61 median≈0.0018
- Top freq: ~0 float noise (143+122), then **23.68×4**, **35.52×4**, **35.61×4** (not 1560 identical)
- Prior **24.32** = same cohort at older DEEP spot (`1999.999999 × ~0.01216`); now `× 0.01184 = 23.68`
- Those rows: **different** positionIds + **different** closeTx; **same** withdraw size; **no** openTx/`add_liquidity`; `depositedUSD=0` → fake PnL = withdraw@spot
- Σ pnl all ≈ **$689.65**; Σ 29 partial ≈ **$585.66** (85% of total) — inflated

## Fix
Missing `add_liquidity` → `depositedUSD`/`pnlUSD`/`pnlPct` = NaN (still listed, **partial** badge).

## Post-fix quick check
- finite PnL 1531; Σ all ≈ **$104.0**; Σ partial = **0**; duplicate 23.68 cohort gone from aggregates

## Full fixture 2.5.11 (unchanged reference)
PASS=22 · FAIL=3 (N10/N19/W01 Suilend) · INCONCLUSIVE=7 (N07/W02/W02s/W04–W06 TIMEOUT; N09 bluefin truncated)
