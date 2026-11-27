# Full fixture 2.5.8 report

Summary: **PASS=148 FAIL=16 INCONCLUSIVE=7 SKIPPED=0** · 4922.6s (lanes=3, timeout=900000ms)

## Per-wallet FAIL / INCONCLUSIVE

### N04
- **FAIL** `N04/§8.1`: suilend supply 2924.9899017585712 !~ 3314.75 (±5%)

### N05
- **FAIL** `N05/§8.1`: suilend borrow 26023.664332203483 !~ 23799.92 (±5%)
- **FAIL** `N05/§8.3/cetus`: closed cetus 0 < 4

### N06
- **FAIL** `N06/§8.3/cetus`: closed cetus 0 < 26

### N07
- **FAIL** `N07/§8.3/cetus`: closed cetus 0 < 2
- **INCONCLUSIVE** `N07/§8.3/bluefin`: closed bluefin 0 < 2 but scan truncated
- **INCONCLUSIVE** `N07/§8.3/turbos`: closed turbos 0 < 3 but scan truncated

### N08
- **FAIL** `N08/§8.1`: suilend supply 28.13202743902273 !~ 387.94 (±5%)
- **FAIL** `N08/§8.1`: suilend borrow 0 !~ 22.17 (±5%)

### N09
- **INCONCLUSIVE** `N09/wallet`: TIMEOUT after 900000ms

### N13
- **FAIL** `N13/§8.1`: suilend supply 9755.706098702567 !~ 8713.74 (±5%)
- **FAIL** `N13/§8.1`: suilend borrow 2296.767466135117 !~ 2433.89 (±5%)

### N14
- **FAIL** `N14/§8.1`: suilend supply 26053.74580745912 !~ 36072.16 (±5%)
- **FAIL** `N14/§8.1`: suilend borrow 13743.23729993543 !~ 14987.52 (±5%)

### N16
- **FAIL** `N16/§8.1`: suilend supply 32751.120095515937 !~ 30957.32 (±5%)
- **FAIL** `N16/§8.1`: suilend borrow 18636.98053904586 !~ 16450.45 (±5%)

### W01
- **FAIL** `W01/§8.1`: suilend supply 0.00901961285351746 !~ 0.01 (±5%)
- **INCONCLUSIVE** `W01/§8.3/bluefin`: closed bluefin 0 < 15 but scan truncated
- **INCONCLUSIVE** `W01/§8.3/momentum`: closed momentum 0 < 1 but scan truncated

### W03
- **FAIL** `W03/§8.1`: suilend supply 4729.706194863049 !~ 4308.55 (±5%)
- **INCONCLUSIVE** `W03/§8.3/turbos`: closed turbos 0 < 41 but scan truncated

### W04
- **FAIL** `W04/§8.3/cetus`: closed cetus 0 < 2

### W07
- **INCONCLUSIVE** `W07/§8.3/momentum`: closed momentum 0 < 29 but scan truncated

## Top-5 slowest [scan] steps
- N19 scanSession.momentum 236266ms graphql
- N19 scanSession.total 236266ms graphql
- W01 scanSession.momentum 236266ms graphql
- N07 scanSession.total 227706ms graphql
- N07 scanSession.momentum 227705ms graphql

## N10 Bluefin
- PASS `N10/§8.1`: suilend supply ≈ 981608.2231425644
- PASS `N10/§8.1`: suilend borrow ≈ 826117.2715554205
- PASS `N10/§8.3/bluefin`: closed bluefin 177 ≥ 18
- PASS `N10/§8.4`: no silent deposit zeros
- PASS `N10/§8.6`: source statuses present

## Suilend N01/N02/N04
- PASS `N01/§8.1`: suilend supply ≈ 1.3544966553823368
- PASS `N01/§8.1`: suilend borrow ≈ 0
- PASS `N02/§8.1`: suilend supply ≈ 6.323773111201853
- PASS `N02/§8.1`: suilend borrow ≈ 0
- FAIL `N04/§8.1`: suilend supply 2924.9899017585712 !~ 3314.75 (±5%)
- PASS `N04/§8.1`: suilend borrow ≈ 1547.7151059889227

See also `harness/diag-2.5.8-n10-suilend.md`.