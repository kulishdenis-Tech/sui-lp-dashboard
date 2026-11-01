# QA Fixes Implementation Summary

**Branch:** `cursor/qa-fixes-nov-2026-a520`  
**PR:** https://github.com/kulishdenis-Tech/sui-lp-dashboard/pull/1  
**Date:** 2026-11-01  
**QA Report:** `uploads/sui-dashboard-qa-2026-11-01.md`

## Implemented Fixes

### ✅ P1-1: Local IDB snapshot includes Current Finance (QA-2026-11-01-01)

**Issue:** Browser IDB snapshot builder omitted Current Finance lending, causing local totals to be ~$3,706 lower than cloud snapshots.

**Root Cause:**
- `usePortfolioHistory.ts` had manual `buildSnapshot` that only summed `lendingSnapshot + naviSnapshot`
- Used deprecated `positionValueUsd` which coerces incomplete Bluefin unclaimed to $0

**Fix:**
- Replaced manual implementation with `buildPortfolioSnapshot` from `portfolioSnapshotBuild.ts`
- This properly includes all three lending sources: AlphaLend, Navi, and Current Finance
- Uses `positionValueUsdOrNull` with fallback to `liquidityUsdOrNull`

**Files Changed:**
- `sui-lp-tracker/src/hooks/usePortfolioHistory.ts`
- `sui-lp-tracker/src/utils/portfolioSnapshotBuild.test.ts` (new test)

**Tests Added:**
```typescript
it('QA-2026-11-01-01: includes Current Finance in lending total', () => {
  // Verifies store with $3,706 Current net produces correct IDB snapshot
})
```

**Verification:**
- ✅ Unit tests pass
- ✅ Test confirms Current Finance included in lending total
- ⚠️ Live wallet verification requires actual wallet data with Current positions

---

### ✅ QA Follow-up: Fixed `computeNetWorth` deprecated API usage

**Issue:** `computeNetWorth` (line 21 in `netWorth.ts`) still used deprecated `positionValueUsd`, causing snapshot `totalUSD` to be wrong when positions have incomplete unclaimed.

**Root Cause:**
- `openLpUSD` calculation used `positionValueUsd(p)` which coerces incomplete unclaimed to $0
- This meant positions with unavailable Bluefin unclaimed showed $0 LP value in net worth

**Fix:**
- Updated to use `positionValueUsdOrNull(p) ?? liquidityUsdOrNull(p) ?? 0`
- Now matches snapshot builder behavior: Value when complete, Liquidity when incomplete
- Never coerces incomplete unclaimed to $0

**Files Changed:**
- `sui-lp-tracker/src/utils/netWorth.ts`
- `sui-lp-tracker/src/utils/netWorth.test.ts` (new test)

**Tests Added:**
```typescript
it('QA follow-up: uses positionValueUsdOrNull with fallback to liquidityUsdOrNull', () => {
  // Incomplete unclaimed: uses liquidity only (1000)
  // Complete unclaimed: uses Value = liquidity + fees + rewards (2150)
  // Total: 3150
})
```

**Verification:**
- ✅ Unit tests pass
- ✅ Test confirms incomplete unclaimed uses liquidity only
- ✅ Test confirms complete unclaimed uses full Value

### ✅ P1-2: Parallelized advisor state API (QA-2026-11-01-02)

**Issue:** `/api/advisor/state` took 80-100s due to sequential loading of LP sources and Current mining APR reads.

**Root Cause:**
- `loadAllPortfolioLpSources` used sequential `for` loop (10 sources)
- `getCurrentPositions` made sequential `await` calls to `readMiningRewardApr` for each deposit/borrow
- `buildAdvisorState` loaded Current then LP sequentially

**Fix:**
1. **LP sources parallelization:**
   - Changed to `Promise.allSettled` for concurrent loading
   - Errors in one source don't block others

2. **Current Finance mining APR parallelization:**
   - Batch all mining APR reads for deposits and borrows
   - Use `Promise.all` to execute concurrently
   - Process results in order afterward

3. **Advisor state parallelization:**
   - Load Current and LP concurrently with `Promise.allSettled`
   - Price fetches already parallelized with `Promise.all`

**Files Changed:**
- `sui-lp-tracker/src/services/portfolioLpSources.ts`
- `sui-lp-tracker/src/services/currentService.ts`
- `sui-lp-tracker/src/services/server/advisorState.ts`
- `sui-lp-tracker/src/services/portfolioLpSources.test.ts` (new test)

**Tests Added:**
```typescript
it('loads all LP sources in parallel with Promise.allSettled', async () => {
  // Verifies parallel execution
})

it('isolates errors per source and continues loading others', async () => {
  // Verifies error isolation
})
```

**Expected Performance Impact:**
- Wall-clock time should drop from 80-100s to much lower (exact timing depends on network)
- LP sources load concurrently (10x faster if network-bound)
- Current mining APR reads happen concurrently (N+M times faster)
- **Concurrency limit (5)** prevents event loop starvation during heavy network operations

**Files Changed:**
- `sui-lp-tracker/src/services/portfolioLpSources.ts`
- `sui-lp-tracker/src/services/currentService.ts`
- `sui-lp-tracker/src/services/server/advisorState.ts` (added concurrency limit)
- `sui-lp-tracker/src/services/portfolioLpSources.test.ts` (new test)

**Verification:**
- ✅ Unit tests pass
- ✅ Error isolation verified in tests
- ⚠️ Performance measurement requires live testing on actual wallet

---

### ✅ P2: Market01 venue label fix (QA-2026-11-01-03)

**Issue:** Market01 displayed as "Market 01" via regex fallback instead of meaningful name.

**Fix:**
- Added explicit mapping: `Market01` → `'Market 01 (sUSN)'` (unconfirmed name)
- Updated `venueName` function in `currentService.ts`

**Files Changed:**
- `sui-lp-tracker/src/services/currentService.ts`
- `sui-lp-tracker/src/services/currentService.test.ts` (new test)

**Tests Added:**
```typescript
it('maps Market01 to "Market 01 (sUSN)"', () => {
  expect(venueName('Market01')).toBe('Market 01 (sUSN)')
})
```

**Verification:**
- ✅ Unit tests pass
- ✅ Test confirms Market01 maps correctly
- ⚠️ Real market name is unconfirmed - should verify with Current Finance docs

---

### ✅ P3: Health Factor thresholds updated (QA-2026-11-01-05)

**Issue:** Health Factor colors used 2.0/1.3 thresholds instead of requested 1.8/1.2.

**Fix:**
- Updated `hfColor` function:
  - Green: HF ≥1.8 (target)
  - Yellow: 1.2 ≤ HF <1.8 (warning)
  - Red: HF <1.2 (critical)
- Updated liquidation price proximity thresholds comment
- Updated tooltip text to reflect new thresholds

**Files Changed:**
- `sui-lp-tracker/src/components/lending/LendingModule.tsx`
- `sui-lp-tracker/src/components/lending/LendingModule.test.ts` (new test)

**Tests Added:**
```typescript
describe('QA-2026-11-01-05: Health Factor color thresholds', () => {
  it('applies green for HF ≥ 1.8 (target)', () => { ... })
  it('applies yellow for 1.2 ≤ HF < 1.8 (warning)', () => { ... })
  it('applies red for HF < 1.2 (critical)', () => { ... })
})

describe('QA-2026-11-01-05: Liquidation price proximity thresholds', () => {
  // 8 tests covering all threshold boundaries
})
```

**Verification:**
- ✅ Unit tests pass
- ✅ All threshold boundaries verified

---

## Not Implemented (P3 Low Priority)

### ⚠️ QA-2026-11-01-04: STALE/UNVERIFIED badge on portfolio totals

**Reason:** Requires product decision and additional UI work:
- Badge component for SummaryCards
- Incomplete/stale flag propagation to UI
- Trust level field in advisor JSON
- Definition of "stale" threshold

### ⚠️ QA-2026-11-01-06: ≤15% protocol concentration warning

**Reason:** Requires product decision:
- Compute protocol share of `totalNetUSD`
- UI warning component design
- Decision on soft limit vs. warning only
- Clarification of "protocol" granularity (per venue? per lending protocol?)

---

## Test Results

All new tests passing. Full test suite results:

```
Test Files  3 failed | 50 passed | 1 skipped (54)
     Tests  2 failed | 239 passed | 1 skipped (242)
```

**Note:** The 3 failed test files and 2 failed tests are **pre-existing failures on master branch**:
- `snapshotCompleteness.test.ts` - missing module `@/pages/overviewLab/overviewMetrics`
- `quotePoolImpact.test.ts` - missing module `@/poolQuote/pricing/state/ClmmStateCache`
- `externalFetchUrl.test.ts` - 2 routing tests (environment-specific)

**Our changes:**
- ✅ 1 new test in `netWorth.test.ts` (QA follow-up for deprecated API fix)
- ✅ 22 tests added in initial commit
- ✅ All new tests pass (23 total)
- ✅ Existing passing tests remain green (239 passing)
- ✅ No new test failures introduced

---

## Known Limitations

1. **Local vs cloud parity verification** requires actual wallet data with:
   - Active Current Finance positions
   - Incomplete Bluefin unclaimed fees
   - Sufficient history to compare IDB vs Supabase snapshots

2. **Advisor API performance** timing depends on:
   - Network latency to RPC nodes
   - RPC response times
   - Number of obligations and assets
   - Recommend monitoring with real usage

3. **Market01 = 'Market 01 (sUSN)'** naming assumption:
   - Based on QA report hypothesis
   - Real market name is unconfirmed
   - Should verify with Current Finance documentation or team

4. **Health Factor threshold visual changes:**
   - Users may notice color changes (1.5 HF now yellow instead of green)
   - Consider announcing in release notes if this causes confusion

5. **Concurrency limit (5)** for LP position mapping:
   - May need tuning based on production load
   - Set conservatively to prevent event loop starvation

---

## Deployment Checklist

- ✅ No production database changes
- ✅ No production API key changes
- ✅ No secrets in code
- ✅ All changes backwards compatible
- ✅ Tests added for all changes
- ✅ No breaking changes to existing functionality
- ⚠️ Do NOT merge until reviewed and approved
- ⚠️ No production deployment without further testing
- ⚠️ Monitor advisor API performance after deployment
- ⚠️ Verify IDB snapshots match cloud after deployment

---

## Manual Testing Recommendations

Before deploying to production:

1. **Test IDB snapshot parity:**
   - Use small wallet with Current Finance position
   - Compare IDB latest snapshot with Supabase snapshot for same hourBucket
   - Verify totals match within ~1%

2. **Test advisor API performance:**
   - Measure `/api/advisor/state` response time before and after
   - Verify it completes in <20s (ideally <10s)
   - Check error handling when sources fail

3. **Test UI threshold changes:**
   - Open wallet with HF between 1.2-2.0
   - Verify color matches new thresholds (1.8 green, 1.2 yellow)
   - Check tooltip text is updated

4. **Test Market01 label:**
   - Find wallet with Market01 position
   - Verify it displays as "Market 01 (sUSN)" not "Market 01"

5. **Test net worth calculation:**
   - Use wallet with incomplete Bluefin unclaimed (out of range position)
   - Verify net worth shows liquidity value, not $0
   - Compare with wallet that has complete unclaimed

---

## Rollback Plan

If issues discovered after deployment:

1. **IDB snapshot issues:**
   - Revert `usePortfolioHistory.ts` changes
   - Old behavior: missing Current but stable

2. **Performance regression:**
   - Revert parallelization changes
   - Old behavior: slower but predictable

3. **UI confusion:**
   - Revert threshold changes
   - Old behavior: 2.0/1.3 thresholds

Git revert command:
```bash
git revert e0d368a
```

---

## Questions for Review

1. Is "sUSN Market" the correct label for Market01?
2. Should we implement STALE badge (P3) before merging?
3. Should we implement 15% concentration warning (P3) before merging?
4. What is acceptable advisor API response time target?
5. Should we add performance monitoring/logging to advisor API?
