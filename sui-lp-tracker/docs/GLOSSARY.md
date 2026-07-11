# LP dashboard glossary (English)

Shared terminology for UI, tooltips, and **`positionDerivedMetrics`**. The on-chain-backed field `OpenPosition.currentValueUSD` holds **Liquidity** (USD only). **Value** is computed with **`positionValueUsd()`** (Liquidity plus unclaimed fees and rewards at spot).

## Liquidity

**Liquidity** — USD value of pool position tokens at the current spot price. Excludes unclaimed fees and rewards.

- **In API / store:** `currentValueUSD`
- **Helper:** `liquidityUsd(position)` — same numeric value, explicit name in code.

## Value

**Value** — Liquidity plus unclaimed fees and rewards at current spot price (`positionValueUsd(position)`). Use for per-position **Value** column, LP strip **Total Value**, and open-LP slice of net worth when aggregating positions.

- **Helper:** `positionValueUsd(position)`

## Related (brief)

- **Net deposited (events):** cumulative add − remove in USD at tx-time prices (`depositedUSD` after enrichment).
- **Lifetime earnings:** claimed fees/rewards from history (`lifetimeEarningsUSD`) + unclaimed at spot (`totalLifetimeEarningsUsd()`).
- Dashboard **Total Value** (`totalNetUSD`): sum of wallet balance, open LP (per-position **Value**), and lending **Credit/Borrow** net as implemented in `computeNetWorth`.
- **Closed LP rows:** побудова з ончейн-подій / адаптерами DEX та опційним lifecycle indexer (`VITE_LP_LIFECYCLE_INDEXER`); см. **`docs/ARCHITECTURE.md`** (розділ LP → закриті позиції).

## UI note

- **Pool** column header in the open-positions table has no tooltip (no “i” affordance when there is no definition string).
