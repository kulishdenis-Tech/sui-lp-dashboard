# Suilend §8.1 FAIL wallets — 2.5.9 diag (tolerance unchanged ±5%)

| Wallet | live supply | anchor | Δ% supply | live borrow | anchor borrow | Δ% borrow | conclusion |
|--------|-------------|--------|-----------|-------------|---------------|-----------|------------|
| N04 | 2933 | 3314.75 | −11.5% | 1548 | 1545.64 | +0.1% | **price_drift** (XAUM same ctokens, gold px ↓) |
| N05 | 55200 | 55142 | +0.1% | 25929 | 23799.92 | **+8.9%** | supply OK; borrow **price/debt drift** (positions present) |
| N08 | 28 | 387.94 | **−92.8%** | 0 | 22.17 | −100% | **amount↓ / likely withdrawn** (WAL/IKA/sSUI still listed but USD collapsed; borrow gone) |
| N13 | 9720 | 8713.74 | **+11.5%** | 2297 | 2433.89 | −5.6% | **price_drift** (+ minor missing STEAMM LP dust) |
| N14 | 25949 | 36072 | **−28.1%** | 13741 | 14987 | −8.3% | **price_drift** (xBTC/DEEP/sSUI/WBTC/WAL present; USD under) |
| N16 | 32691 | 30957 | **+5.6%** | 18652 | 16450 | **+13.4%** | **price_drift** (xBTC only; BTC px / debt) |
| W01 | 0.0090 | 0.01 | −9.8% | 0 | 0 | 0 | **price_drift** (dust SUI/sSUI) |
| W03 | 4743 | 4308.55 | **+10.1%** | 2500 | 2499.8 | +0.0% | **price_drift** (SUI/sSUI up) |

Anchors and ±5% **not** changed in this package.
