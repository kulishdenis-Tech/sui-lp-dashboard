/**
 * Aftermath Finance farming integration.
 *
 * Fetches staked LP positions (afLP tokens locked in Aftermath Farms) and maps
 * them to the standard OpenPosition shape for display in the LP tab.
 *
 * Unit-scale notes:
 *  • sp.stakedAmount (user) and stakingPool.stakingPool.stakedAmount (pool total) are BOTH
 *    Balance=bigint in the same raw LP units.  fraction = userRaw / poolTotalRaw — no
 *    decimal conversion needed because the units cancel out.
 *  • pool.coins[ct].normalizedBalance / 1e18 = human coin balance.
 *  • For reward amounts: use ACTUAL coin decimals from getCoinMetadata.
 *  • For APR: use actual coin decimals and fixedOneB = 1e18.
 */
import { Aftermath } from 'aftermath-ts-sdk';
import { mapPool } from '@/utils/concurrency';
import { RPC_CONCURRENCY } from '@/utils/constants';
import { getRpcUrl, suiClient } from '@/services/suiClient';
// ── Aftermath SDK singleton ───────────────────────────────────────────────────
let _sdk = null;
let _sdkFailed = false;
let _sdkInflight = null;
async function getAftermathSdk() {
    if (_sdkFailed)
        return null;
    if (_sdk)
        return _sdk;
    if (_sdkInflight)
        return _sdkInflight;
    _sdkInflight = (async () => {
        try {
            // Aftermath SDK still speaks JSON-RPC only (separate from gRPC portfolio path).
            const a = await Aftermath.create({
                network: 'MAINNET',
                fullnodeUrl: getRpcUrl(),
            });
            _sdk = a;
            return a;
        }
        catch (err) {
            console.error('[Aftermath] SDK init failed:', err);
            _sdkFailed = true;
            return null;
        }
        finally {
            _sdkInflight = null;
        }
    })();
    return _sdkInflight;
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function addLeadingZeros(coinType) {
    const sep = coinType.indexOf('::');
    if (sep < 0) {
        if (!coinType.startsWith('0x'))
            return coinType;
        const hex = coinType.slice(2);
        return hex.length >= 64 ? coinType : '0x' + hex.padStart(64, '0');
    }
    const addr = coinType.slice(0, sep);
    if (!addr.startsWith('0x'))
        return coinType;
    const hex = addr.slice(2);
    if (hex.length >= 64)
        return coinType;
    return '0x' + hex.padStart(64, '0') + coinType.slice(sep);
}
function coinSymbolFromType(coinType) {
    const sym = coinType.split('::').pop();
    return sym && sym.length > 0 ? sym : '?';
}
function poolNameFromLpType(lpCoinType) {
    const raw = coinSymbolFromType(lpCoinType).toLowerCase();
    const stripped = raw.replace(/^af_lp_/, '');
    const parts = stripped.split('_').filter(Boolean);
    return parts.map((p) => p.toUpperCase()).join('/') + ' LP';
}
function symbolsFromLpType(lpCoinType) {
    const raw = coinSymbolFromType(lpCoinType).toLowerCase();
    const stripped = raw.replace(/^af_lp_/, '');
    const parts = stripped.split('_').filter(Boolean);
    if (parts.length === 0)
        return ['?', '?'];
    if (parts.length === 1)
        return [parts[0].toUpperCase(), '?'];
    if (parts.length === 2)
        return [parts[0].toUpperCase(), parts[1].toUpperCase()];
    const mid = Math.ceil(parts.length / 2);
    return [parts.slice(0, mid).join('').toUpperCase(), parts.slice(mid).join('').toUpperCase()];
}
function toBigInt(v) {
    if (v == null)
        return 0n;
    if (typeof v === 'bigint')
        return v;
    if (typeof v === 'string') {
        try {
            return BigInt(v);
        }
        catch {
            return 0n;
        }
    }
    if (typeof v === 'number' && Number.isFinite(v))
        return BigInt(Math.round(v));
    return 0n;
}
/**
 * Fetch the actual on-chain decimal places for a set of coin types.
 * Returns a Map keyed by BOTH the original and the leading-zero-padded form.
 */
async function fetchCoinDecimals(coinTypes) {
    const result = new Map();
    await mapPool([...coinTypes], RPC_CONCURRENCY, async (ct) => {
        const fallback = 9;
        try {
            const meta = await suiClient.getCoinMetadata({ coinType: ct });
            const dec = typeof meta?.decimals === 'number' && meta.decimals >= 0
                ? meta.decimals
                : fallback;
            result.set(ct, dec);
            result.set(addLeadingZeros(ct), dec);
        }
        catch {
            result.set(ct, fallback);
            result.set(addLeadingZeros(ct), fallback);
        }
    });
    return result;
}
// ── Main export ───────────────────────────────────────────────────────────────
export async function getAftermathFarmsPositions(walletAddress) {
    const sdk = await getAftermathSdk();
    if (!sdk)
        return [];
    const farmsApi = sdk.Farms();
    const poolsApi = sdk.Pools();
    const pricesApi = sdk.Prices();
    // ── 1. User's staked positions ────────────────────────────────────────────
    const stakedPositions = await farmsApi.getOwnedStakedPositions({ walletAddress });
    console.debug('[Aftermath] stakedPositions:', stakedPositions.length);
    if (!stakedPositions.length)
        return [];
    // ── 2. Staking pools ──────────────────────────────────────────────────────
    const uniqueStakingPoolIds = [
        ...new Set(stakedPositions.map((p) => p.stakedPosition.stakingPoolObjectId)),
    ];
    const stakingPools = await farmsApi.getStakingPools({ objectIds: uniqueStakingPoolIds });
    const stakingPoolById = new Map(stakingPools.map((sp) => [sp.stakingPool.objectId, sp]));
    console.debug('[Aftermath] stakingPools:', stakingPools.length);
    // ── 3. AMM pool data ──────────────────────────────────────────────────────
    const uniqueLpCoinTypes = [
        ...new Set(stakedPositions.map((p) => addLeadingZeros(p.stakedPosition.stakeCoinType))),
    ];
    let poolIdArrays = [];
    try {
        const raw = await poolsApi.getPoolObjectIdsForLpCoinTypes({ lpCoinTypes: uniqueLpCoinTypes });
        poolIdArrays = Array.isArray(raw) ? raw : [];
    }
    catch (e) {
        console.warn('[Aftermath] getPoolObjectIdsForLpCoinTypes failed:', e);
    }
    console.debug('[Aftermath] poolIdArrays:', JSON.stringify(poolIdArrays));
    const lpCoinTypeToPoolId = new Map();
    uniqueLpCoinTypes.forEach((lpType, i) => {
        const entry = poolIdArrays[i];
        if (Array.isArray(entry) && entry.length > 0)
            lpCoinTypeToPoolId.set(lpType, String(entry[0]));
        else if (typeof entry === 'string' && entry.length > 0)
            lpCoinTypeToPoolId.set(lpType, entry);
    });
    const uniquePoolIds = [...new Set([...lpCoinTypeToPoolId.values()])].filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ammPools = uniquePoolIds.length
        ? await poolsApi.getPools({ objectIds: uniquePoolIds }).catch(() => [])
        : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ammPoolById = new Map(ammPools.map((p) => [p.pool.objectId, p]));
    console.debug('[Aftermath] ammPools:', ammPools.length);
    // ── 4. Price lookup ───────────────────────────────────────────────────────
    const rawCoinTypes = new Set();
    for (const pool of ammPools) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const coins = pool.pool?.coins;
        if (coins)
            Object.keys(coins).forEach((ct) => rawCoinTypes.add(ct));
    }
    for (const sp of stakingPools)
        sp.rewardCoinTypes().forEach((ct) => rawCoinTypes.add(ct));
    uniqueLpCoinTypes.forEach((ct) => rawCoinTypes.add(ct));
    const priceInfoRaw = await pricesApi.getCoinsToPriceInfo({
        coins: [...rawCoinTypes].map(addLeadingZeros),
    }).catch(() => ({}));
    const priceMap = new Map();
    for (const [ct, info] of Object.entries(priceInfoRaw)) {
        const price = info.price ?? 0;
        priceMap.set(ct, price);
        priceMap.set(addLeadingZeros(ct), price);
    }
    const getPrice = (ct) => priceMap.get(ct) ?? priceMap.get(addLeadingZeros(ct)) ?? 0;
    // ── 5. Fetch ACTUAL coin decimals from chain metadata ─────────────────────
    const metaTypes = new Set();
    stakedPositions.forEach((p) => metaTypes.add(p.stakedPosition.stakeCoinType));
    for (const sp of stakingPools)
        sp.rewardCoinTypes().forEach((ct) => metaTypes.add(ct));
    for (const pool of ammPools) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const coins = pool.pool?.coins;
        if (coins)
            Object.keys(coins).forEach((ct) => metaTypes.add(ct));
    }
    const actualDecimals = await fetchCoinDecimals(metaTypes);
    const getActualDec = (ct) => actualDecimals.get(ct) ?? actualDecimals.get(addLeadingZeros(ct)) ?? 9;
    console.debug('[Aftermath] actualDecimals:', [...actualDecimals.entries()].slice(0, 6));
    // ── 6. Build OpenPosition[] ───────────────────────────────────────────────
    const result = [];
    for (const pos of stakedPositions) {
        const sp = pos.stakedPosition;
        const normalizedStakeCoinType = addLeadingZeros(sp.stakeCoinType);
        const stakingPool = stakingPoolById.get(sp.stakingPoolObjectId);
        if (!stakingPool) {
            console.warn('[Aftermath] No staking pool for:', sp.stakingPoolObjectId);
            continue;
        }
        const poolId = lpCoinTypeToPoolId.get(normalizedStakeCoinType) ?? '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ammPool = poolId ? ammPoolById.get(poolId) : null;
        console.debug('[Aftermath] pos', sp.objectId, '| poolId:', poolId, '| ammPool:', !!ammPool);
        // ── Farm TVL ─────────────────────────────────────────────────────────
        const farmTvl = await farmsApi.getTVL({ farmIds: [sp.stakingPoolObjectId] }).catch(() => 0);
        console.debug('[Aftermath] farmTvl:', farmTvl);
        // ── Pool coins ────────────────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const poolCoins = ammPool?.pool?.coins ?? {};
        const coinTypeList = Object.keys(poolCoins);
        const AFTERMATH_FIXED_ONE_N = 1e18;
        const poolCoinHumanBals = {};
        let totalPoolUSD = 0;
        for (const [ct, coin] of Object.entries(poolCoins)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const normalizedBal = toBigInt(coin.normalizedBalance ?? coin.balance ?? 0n);
            const humanBal = Number(normalizedBal) / AFTERMATH_FIXED_ONE_N;
            const price = getPrice(ct);
            poolCoinHumanBals[ct] = humanBal;
            totalPoolUSD += humanBal * price;
        }
        // ── LP fraction ───────────────────────────────────────────────────────
        // sp.stakedAmount        = user's raw LP units   (Balance = bigint)
        // stakingPool.stakingPool.stakedAmount = pool total raw LP units (Balance = bigint)
        // Both are in the SAME raw units → fraction = userRaw / poolTotalRaw (no decimals needed).
        // humanStaked is only used for display in the UI.
        const lpCoinDecimals = typeof ammPool?.pool?.lpCoinDecimals === 'number' ? ammPool.pool.lpCoinDecimals : 9;
        const stakedRaw = toBigInt(sp.stakedAmount);
        const humanStaked = Number(stakedRaw) / Math.pow(10, lpCoinDecimals);
        // Primary path: user share of total farm staked — doesn't need ammPool at all.
        const poolTotalStakedRaw = toBigInt(stakingPool.stakingPool.stakedAmount);
        let fraction = poolTotalStakedRaw > 0n
            ? Number(stakedRaw) / Number(poolTotalStakedRaw)
            : 0;
        // Fallback if poolTotalStakedRaw is 0: use ammPool lpCoinSupply.
        // The REST API may return lpCoinSupply as a human-scale float or as a raw bigint.
        // Try raw ratio first; if > 1 it must be human-scale, so switch approaches.
        if (fraction === 0 && ammPool) {
            const lpSupplyRaw = toBigInt(ammPool.pool?.lpCoinSupply);
            if (lpSupplyRaw > 0n) {
                const rawRatio = Number(stakedRaw) / Number(lpSupplyRaw);
                if (rawRatio > 0 && rawRatio <= 1.01) {
                    // lpCoinSupply in same raw units as stakedRaw → ratio is correct
                    fraction = rawRatio;
                }
                else {
                    // lpCoinSupply is human-scaled (float from REST API)
                    const humanLpSupply = Number(lpSupplyRaw);
                    if (humanLpSupply > 0)
                        fraction = humanStaked / humanLpSupply;
                }
            }
        }
        console.debug('[Aftermath] stakedRaw:', stakedRaw, '| poolTotalStakedRaw:', poolTotalStakedRaw, '| humanStaked:', humanStaked, '| fraction:', fraction, '| farmTvl:', farmTvl);
        // ── Token amounts & position value ────────────────────────────────────
        const symbolToPrice = {};
        for (const rct of stakingPool.rewardCoinTypes()) {
            const p = getPrice(rct);
            if (p > 0)
                symbolToPrice[coinSymbolFromType(rct).toUpperCase()] = p;
        }
        const getPriceRobust = (ct) => {
            const direct = getPrice(ct);
            if (direct > 0)
                return direct;
            return symbolToPrice[coinSymbolFromType(ct).toUpperCase()] ?? 0;
        };
        const tokenAmounts = {};
        let currentValueUSD = 0;
        for (const [ct, humanBal] of Object.entries(poolCoinHumanBals)) {
            const userAmt = humanBal * fraction;
            tokenAmounts[ct] = userAmt;
            currentValueUSD += userAmt * getPriceRobust(ct);
        }
        // farmTvl × fraction is Aftermath's authoritative number — prefer it when available.
        if (farmTvl > 0 && fraction > 0)
            currentValueUSD = farmTvl * fraction;
        console.debug('[Aftermath] totalPoolUSD:', totalPoolUSD, '| fraction:', fraction, '| currentValueUSD:', currentValueUSD);
        const [fallbackA, fallbackB] = symbolsFromLpType(sp.stakeCoinType);
        const tokenAType = coinTypeList[0] ?? '';
        const tokenBType = coinTypeList[1] ?? '';
        const tokenAAmount = tokenAmounts[tokenAType] ?? 0;
        const tokenBAmount = tokenAmounts[tokenBType] ?? 0;
        const tokenA = tokenAType ? coinSymbolFromType(tokenAType) : fallbackA;
        const tokenB = tokenBType ? coinSymbolFromType(tokenBType) : fallbackB;
        const pair = coinTypeList.length >= 2 ? `${tokenA}/${tokenB}` : poolNameFromLpType(sp.stakeCoinType);
        // ── Pending rewards ───────────────────────────────────────────────────
        try {
            pos.updatePosition({ stakingPool });
        }
        catch { /* non-critical */ }
        const rewardBalances = pos.rewardCoinsToClaimableBalance({ stakingPool });
        console.debug('[Aftermath] rewardBalances keys:', Object.keys(rewardBalances));
        let unclaimedRewardUSD = 0;
        const rewardBreakdown = [];
        for (const [ct, rawAmt] of Object.entries(rewardBalances)) {
            const dec = getActualDec(ct);
            const humanAmt = Number(rawAmt) / Math.pow(10, dec);
            const price = getPrice(ct);
            const amtUSD = humanAmt * price;
            unclaimedRewardUSD += amtUSD;
            rewardBreakdown.push({ symbol: coinSymbolFromType(ct), coinType: ct, amount: humanAmt, amountUSD: amtUSD });
        }
        console.debug('[Aftermath] rewards:', rewardBreakdown);
        // ── APR ───────────────────────────────────────────────────────────────
        // fixedOneB = 1e18 (NOT 1e9). APR = baseApr × (lockMultiplier / 1e18) × 100.
        const AFTERMATH_FIXED_ONE_B = 1e18;
        let aprEstimatePct = 0;
        try {
            if (farmTvl > 0) {
                const coinsToPrice = {};
                const coinsToDecimals = {};
                for (const ct of stakingPool.rewardCoinTypes()) {
                    coinsToPrice[ct] = getPrice(ct);
                    coinsToDecimals[ct] = getActualDec(ct);
                }
                const baseApr = stakingPool.calcTotalApr({ coinsToPrice, coinsToDecimals, tvlUsd: farmTvl });
                console.debug('[Aftermath] baseApr:', baseApr);
                const userMult = Number(toBigInt(sp.lockMultiplier));
                const effectiveMult = userMult > 0 ? userMult : AFTERMATH_FIXED_ONE_B;
                aprEstimatePct = baseApr * (effectiveMult / AFTERMATH_FIXED_ONE_B) * 100;
            }
        }
        catch (e) {
            console.debug('[Aftermath] APR error:', e);
        }
        // ── Lock info ─────────────────────────────────────────────────────────
        const lockStartMs = sp.lockStartTimestamp ?? 0;
        const openedAt = lockStartMs > 0 ? Math.floor(lockStartMs / 1000) : 0;
        const daysOpen = openedAt > 0 ? (Date.now() / 1000 - openedAt) / 86400 : 0;
        let aftermathLockUnlockMs;
        try {
            if (sp.lockDurationMs > 0) {
                const unlockMs = pos.unlockTimestamp();
                aftermathLockUnlockMs = unlockMs > 0 ? unlockMs : undefined;
            }
        }
        catch { /* non-critical */ }
        result.push({
            id: sp.objectId,
            protocol: 'aftermath',
            poolId,
            pair,
            tokenA,
            tokenB,
            tokenAAddress: tokenAType,
            tokenBAddress: tokenBType,
            tokenAIconUrl: null,
            tokenBIconUrl: null,
            tokenADecimals: getActualDec(tokenAType),
            tokenBDecimals: getActualDec(tokenBType),
            fee: 0,
            tickLower: 0,
            tickUpper: 0,
            currentTick: 0,
            currentSqrtPrice: '0',
            liquidity: '0',
            status: 'in_range',
            tokenAAmount,
            tokenBAmount,
            currentPriceA_USD: getPrice(tokenAType),
            currentPriceB_USD: getPrice(tokenBType),
            currentValueUSD,
            depositedUSD: 0,
            pnlUSD: 0,
            pnlPct: 0,
            unclaimedFeeA: 0,
            unclaimedFeeB: 0,
            unclaimedFeeUSD: 0,
            unclaimedRewardUSD,
            openedAt,
            daysOpen,
            lifetimeEarningsUSD: 0,
            vsHodlDeltaUSD: 0,
            aprEstimatePct,
            aftermathRewardBreakdown: rewardBreakdown.length > 0 ? rewardBreakdown : undefined,
            aftermathLockUnlockMs,
            aftermathLpAmount: humanStaked,
        });
    }
    return result;
}
