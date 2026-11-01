/**
 * Read-only advisor bot portfolio facts for local Vite GET /api/advisor/state.
 * Never signs txs; never touches wallet keys; never logs secrets.
 */
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { getCurrentPositions, EMPTY_CURRENT_SNAP } from '@/services/currentService';
import { loadAllPortfolioLpSources } from '@/services/portfolioLpSources';
import { getUsdPerTokenAtTimestamp } from '@/services/priceService';
import { coingeckoIdForSymbol, coingeckoSimpleBatch } from '@/services/spotPrice/coingecko24hBatch';
import { clmmRangeFromOpenPosition } from '@/utils/tickPriceRange';
import { NATIVE_SUI_COIN_TYPE, normalizeCoinTypeForMatch } from '@/utils/suiCoinType';
/** Hardcoded advisor wallet (read-only). */
const ADVISOR_WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9';
/** DeepBook DEEP mainnet coin type (see `hardcodedVerifiedCoins` / tokenDecimalsAudit). */
const DEEP_COIN_TYPE = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP';
function errMsg(e) {
    return e instanceof Error ? e.message : String(e);
}
function isSuiAsset(s) {
    if (s.asset.toUpperCase() === 'SUI')
        return true;
    try {
        return normalizeCoinTypeForMatch(s.coinType) === NATIVE_SUI_COIN_TYPE;
    }
    catch {
        return false;
    }
}
function isUsdcBorrow(b) {
    return b.asset.toUpperCase() === 'USDC' || /::usdc::/i.test(b.coinType);
}
function mapSupply(s) {
    const row = {
        asset: s.asset,
        coinType: s.coinType,
        currentAmount: s.currentAmount,
        currentValueUSD: s.currentValueUSD,
        supplyAPR: s.supplyAPR,
    };
    if (s.supplyRewardAPR != null)
        row.supplyRewardAPR = s.supplyRewardAPR;
    return row;
}
function mapBorrow(b) {
    const row = {
        asset: b.asset,
        coinType: b.coinType,
        currentDebt: b.currentDebt,
        currentDebtUSD: b.currentDebtUSD,
        borrowAPR: b.borrowAPR,
    };
    if (b.borrowRewardAPR != null)
        row.borrowRewardAPR = b.borrowRewardAPR;
    if (Number.isFinite(b.healthFactor))
        row.healthFactor = b.healthFactor;
    return row;
}
function groupMarkets(snap) {
    const markets = {};
    const venueOf = (v) => (v && v.trim() ? v.trim() : 'Unknown');
    for (const s of snap.supplies) {
        const key = venueOf(s.venue);
        if (!markets[key])
            markets[key] = { supplies: [], borrows: [] };
        markets[key].supplies.push(mapSupply(s));
    }
    for (const b of snap.borrows) {
        const key = venueOf(b.venue);
        if (!markets[key])
            markets[key] = { supplies: [], borrows: [] };
        markets[key].borrows.push(mapBorrow(b));
    }
    return markets;
}
function usdcDebtFrom(snap) {
    const usdc = snap.borrows.filter(isUsdcBorrow);
    const rows = usdc.length > 0 ? usdc : snap.borrows;
    return rows.reduce((sum, b) => sum + (Number.isFinite(b.currentDebtUSD) ? b.currentDebtUSD : 0), 0);
}
function suiLiquidationPrice(snap) {
    const prices = snap.supplies
        .filter(isSuiAsset)
        .map((s) => s.liquidationPriceUSD)
        .filter((p) => p != null && Number.isFinite(p) && p > 0);
    if (prices.length === 0)
        return null;
    return Math.min(...prices);
}
function mapLpPosition(p) {
    const range = clmmRangeFromOpenPosition({
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        currentTick: p.currentTick,
        currentSqrtPrice: p.currentSqrtPrice,
        tokenA: p.tokenA,
        tokenB: p.tokenB,
        tokenADecimals: p.tokenADecimals,
        tokenBDecimals: p.tokenBDecimals,
        status: p.status,
        priceCurrentOverride: p.priceCurrentOverride,
        priceRangeOverride: p.priceRangeOverride,
    });
    return {
        protocol: p.protocol,
        poolId: p.poolId,
        pair: p.pair,
        rangeLower: range ? range.priceMin : p.tickLower,
        rangeUpper: range ? range.priceMax : p.tickUpper,
        inRange: p.status === 'in_range',
        tokenAAmount: p.tokenAAmount,
        tokenBAmount: p.tokenBAmount,
        tokenA: p.tokenA,
        tokenB: p.tokenB,
        currentValueUSD: p.currentValueUSD,
    };
}
async function softUsdPriceCgFallback(symbol) {
    const id = coingeckoIdForSymbol(symbol);
    if (!id)
        return null;
    const batch = await coingeckoSimpleBatch([id]);
    const usd = batch[id]?.usd;
    return usd != null && Number.isFinite(usd) && usd > 0 ? usd : null;
}
async function softUsdPrice(symbol, coinType, timestampSec, errors) {
    try {
        const q = await getUsdPerTokenAtTimestamp(symbol, coinType, timestampSec);
        const px = q.usdPerToken;
        if (px != null && Number.isFinite(px) && px > 0)
            return px;
    }
    catch {
        /* fall through to CoinGecko spot */
    }
    try {
        const cg = await softUsdPriceCgFallback(symbol);
        if (cg != null)
            return cg;
    }
    catch (e) {
        errors.push(`price:${symbol}: ${errMsg(e)}`);
        return null;
    }
    errors.push(`price:${symbol}: unavailable`);
    return null;
}
export async function buildAdvisorState() {
    const wallet = normalizeSuiAddress(ADVISOR_WALLET).toLowerCase();
    const errors = [];
    const nowSec = Math.floor(Date.now() / 1000);
    let currentSnap = EMPTY_CURRENT_SNAP;
    try {
        currentSnap = await getCurrentPositions(wallet);
    }
    catch (e) {
        errors.push(`current: ${errMsg(e)}`);
    }
    let lpPositions = [];
    try {
        const lp = await loadAllPortfolioLpSources(wallet);
        for (const st of lp.statuses) {
            if (!st.ok)
                errors.push(`lp:${st.id}: ${st.error ?? 'unavailable'}`);
        }
        lpPositions = lp.positions.map(mapLpPosition);
    }
    catch (e) {
        errors.push(`lp: ${errMsg(e)}`);
    }
    const [suiPx, deepPx] = await Promise.all([
        softUsdPrice('SUI', NATIVE_SUI_COIN_TYPE, nowSec, errors),
        softUsdPrice('DEEP', DEEP_COIN_TYPE, nowSec, errors),
    ]);
    const state = {
        timestamp: new Date().toISOString(),
        wallet,
        current: {
            healthFactor: currentSnap.healthFactor,
            usdcDebt: usdcDebtFrom(currentSnap),
            liquidationPrice: suiLiquidationPrice(currentSnap),
            markets: groupMarkets(currentSnap),
            totalSuppliedUSD: currentSnap.totalSuppliedUSD,
            totalBorrowedUSD: currentSnap.totalBorrowedUSD,
            netValueUSD: currentSnap.netValueUSD,
        },
        lpPositions,
        prices: { SUI: suiPx, DEEP: deepPx },
    };
    if (errors.length > 0)
        state.errors = errors;
    return state;
}
