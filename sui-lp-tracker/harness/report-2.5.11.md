# v2.5.11 report

## Setup
- Started from `master` @ `e6161ee` (2.5.10); serve-prod pid **32300** left running (hash match).
- After fix: bumped to **2.5.11**, rebuild, commit + restart serve-prod.

## N06 Cetus closed (diag)
| Metric | Value |
|--------|------:|
| ClosePosition event rows | 1560 |
| Unique ClosePosition positionIds | 1560 |
| Unique closed returned | 1560 |
| Placeholder coin types (`?—?`) | **0** (pool meta filled) |
| `partialHistory` (event trunc) | 29 |
| Finite PnL rows | 1560 |

Placeholder path not hit this run. Prior 2.5.10 meta-miss made SUI/SUI look like full rows — 2.5.11 marks those as `?—?` + **partial** badge and sets PnL/deposit/fees to NaN (excluded from ClosedSummaryStrip aggregates). Event-partial rows also show explicit **partial** badge.

Sample event-partial rows (badge=`partial`, real pairs this run):
- DEEP/SUI · 0.050% · PnL ≈ $24.32 · 0d · partial
- DEEP/SUI · 0.050% · PnL ≈ $24.32 · 0d · partial
- DEEP/SUI · 0.050% · PnL ≈ $24.32 · 0d · partial
- DEEP/SUI · 0.050% · PnL ≈ $24.48 · 0d · partial
- DEEP/SUI · 0.050% · PnL ≈ $24.32 · 0d · partial

## Full fixture (`--full --timeout-ms 900000 --lanes 3`)
`PASS=140 FAIL=5 INCONCLUSIVE=7` · 6057.8s · exit 1

### Per wallet
| Wallet | Verdict | Reason |
|--------|---------|--------|
| N01–N06, N08, N11–N18, N20 | PASS | |
| N07 | INCONCLUSIVE | TIMEOUT 900s |
| N09 | INCONCLUSIVE | bluefin closed 0&lt;1 but scan truncated |
| N10 | FAIL | suilend supply/borrow !~ anchors ±5% (price/position drift) |
| N19 | FAIL | suilend supply≈52.8 / borrow≈32.1 vs anchors 0 |
| W01 | FAIL | suilend supply 0.00907 !~ 0.01 (±5%) |
| W02, W02s, W04, W05, W06 | INCONCLUSIVE | TIMEOUT 900s |
| W03, W07–W11 | PASS | |

Artifacts: `harness/report-2.5.11-full.txt`, `harness/last-live-results.json`, `harness/diag-n06-placeholder-2.5.11.txt`.
