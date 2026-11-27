# Full fixture 2.5.9 report

Summary: **PASS=149 FAIL=12 INCONCLUSIVE=10** · 5161.8s

## Per-wallet FAIL / INCONCLUSIVE

### N04
- **FAIL** `N04/§8.1`: suilend supply 2932.5908213463226 !~ 3314.75 (±5%)

### N05
- **FAIL** `N05/§8.1`: suilend borrow 25982.16982465192 !~ 23799.92 (±5%)
- **INCONCLUSIVE** `N05/§8.3/cetus`: closed cetus 0 < 4 but scan truncated

### N06
- **INCONCLUSIVE** `N06/§8.3/cetus`: closed cetus 0 < 26 but scan truncated

### N07
- **INCONCLUSIVE** `N07/§8.3/cetus`: closed cetus 0 < 2 but scan truncated
- **INCONCLUSIVE** `N07/§8.3/bluefin`: closed bluefin 0 < 2 but scan truncated
- **INCONCLUSIVE** `N07/§8.3/turbos`: closed turbos 0 < 3 but scan truncated

### N08
- **FAIL** `N08/§8.1`: suilend supply 28.302132918902217 !~ 387.94 (±5%)
- **FAIL** `N08/§8.1`: suilend borrow 0 !~ 22.17 (±5%)

### N09
- **INCONCLUSIVE** `N09/wallet`: TIMEOUT after 900000ms

### N13
- **FAIL** `N13/§8.1`: suilend supply 9755.304186246149 !~ 8713.74 (±5%)
- **FAIL** `N13/§8.1`: suilend borrow 2296.837887525003 !~ 2433.89 (±5%)

### N14
- **FAIL** `N14/§8.1`: suilend supply 26061.247699640717 !~ 36072.16 (±5%)
- **FAIL** `N14/§8.1`: suilend borrow 13744.69809169119 !~ 14987.52 (±5%)

### N16
- **FAIL** `N16/§8.1`: suilend supply 32910.42364979331 !~ 30957.32 (±5%)
- **FAIL** `N16/§8.1`: suilend borrow 18679.668481290093 !~ 16450.45 (±5%)

### W01
- **FAIL** `W01/§8.1`: suilend supply 0.009055214145765423 !~ 0.01 (±5%)
- **INCONCLUSIVE** `W01/§8.3/bluefin`: closed bluefin 0 < 15 but scan truncated
- **INCONCLUSIVE** `W01/§8.3/momentum`: closed momentum 0 < 1 but scan truncated

### W03
- **FAIL** `W03/§8.1`: suilend supply 4766.2267291515 !~ 4308.55 (±5%)
- **INCONCLUSIVE** `W03/§8.3/turbos`: closed turbos 0 < 41 but scan truncated

### W04
- **INCONCLUSIVE** `W04/§8.3/cetus`: closed cetus 0 < 2 but scan truncated

## N10 Bluefin (relative GraphQL floor)
- PASS `N10/§8.1`: suilend supply ≈ 977775.3240780229
- PASS `N10/§8.1`: suilend borrow ≈ 826172.579294764
- PASS `N10/§8.3/bluefin`: closed bluefin 178 ≥ 176 (graphql floor)
- PASS `N10/§8.4`: no silent deposit zeros
- PASS `N10/§8.6`: source statuses present

## Top-5 slowest scan steps
- (see harness console: scanSession.momentum ~236s class)

See also `harness/diag-2.5.9-suilend.md`.