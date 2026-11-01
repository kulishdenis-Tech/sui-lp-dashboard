import { suiClient } from '@/services/suiClient';
import { currentMarketListMeta, fetchAllMarketRows, readClaimableMining, readMiningRewardApr, } from '@/services/currentService';
import { extFetchUrl } from '@/utils/externalFetchUrl';
import { currentMultiplyAppUrl, humanFromRawBigint, mergeMultiplyCompleteness, multiplyEquityUsd, multiplyMultiplier, multiplyNetAprBreakdown, multiplyRiskFromSpot, parseRawIntegerAmount, } from '@/utils/currentMultiplyVault';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
const API = 'https://api.current.finance';
/** Official SDK `NetworkConfig.protocolPackageId` (mainnet). */
const PROTOCOL_PKG = '0x45bae0425e9098ce5cba3d3fa2836220ad24c9f88aa0dffffb5a52b49319fc70';
const DECIMAL_SCALE = 10n ** 18n;
/** Official SDK market object ids (mainnet). */
const MARKET_OBJECT_BY_TYPE = {
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EmberMarket': '0x8e85c433f791685c65fa66923110b8385e13f955daf8792ef805ce2d47139bbc',
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::AltCoinMarket': '0x6f5230c346e27132b8d4d92cb3f4f9c7f4e736d5c32b8f0a2b063c97e67d78f7',
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EthenaMarket': '0xeeef7e9abe201e16c3ca6417b91fa49bec28edcb077eb2fd4a1f126c251e6899',
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MatrixGoldMarket': '0xafe28c816d322a56bdab27b90d4b5e882a0a34ee2d9f02c6a07402a2b69be900',
};
const decimalSchema = bcs.struct('Decimal', { value: bcs.u256() });
const overviewSchema = bcs.struct('ObligationDetail', {
    emode_group_id: bcs.u8(),
    borrows: bcs.vector(bcs.struct('ObligationBorrow', {
        asset: bcs.string(),
        borrow_index: decimalSchema,
        debt: decimalSchema,
    })),
    deposits: bcs.vector(bcs.struct('ObligationDeposit', {
        asset: bcs.string(),
        ctoken_amount: bcs.u64(),
    })),
});
function with0x(t) {
    const s = t.trim();
    return s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`;
}
function typeKey(t) {
    return t.trim().replace(/^0x/i, '').toLowerCase();
}
function marketTypeKey(t) {
    return typeKey(t);
}
async function getJson(path) {
    const res = await fetch(extFetchUrl(`${API}${path}`), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok)
        throw new Error(`Current Multiply API ${res.status} ${path}`);
    const json = (await res.json());
    if (json.code != null && json.code !== 0) {
        throw new Error(`Current Multiply API ${json.message ?? json.code} ${path}`);
    }
    return json.data;
}
let multiplyListCache = null;
let multiplyReadGen = 0;
async function fetchMultiplyList() {
    const now = Date.now();
    if (!multiplyListCache || now - multiplyListCache.ts >= 60_000) {
        const rows = await getJson('/multiply/getMultiplyList');
        multiplyListCache = { ts: now, rows: rows ?? [] };
    }
    return {
        rows: multiplyListCache.rows,
        receivedAtMs: multiplyListCache.ts,
        cacheAgeMs: now - multiplyListCache.ts,
    };
}
function matchVault(list, marketType, emode, collateral, debt) {
    const marketName = (marketTypeKey(marketType).split('::').pop() ?? '').toLowerCase();
    const cKey = typeKey(collateral);
    const dKey = typeKey(debt);
    return list.find((v) => {
        if ((v.emodeGroup ?? -1) !== emode)
            return false;
        if (typeKey(v.strategy ?? '') !== cKey || typeKey(v.borrower ?? '') !== dKey)
            return false;
        const from = (v.fromMarket ?? '').toLowerCase();
        if (from && marketName && from !== marketName)
            return false;
        return true;
    });
}
function coinRaw(scaled, scale = DECIMAL_SCALE) {
    if (scale === 0n)
        return 0n;
    return scaled / scale;
}
async function inspectOverview(marketType, marketId, obligationId, sender) {
    const tx = new Transaction();
    tx.moveCall({
        target: `${PROTOCOL_PKG}::obligation_query::get_obligation_overview`,
        typeArguments: [with0x(marketType)],
        arguments: [tx.object(marketId), tx.pure.id(obligationId)],
    });
    const res = await suiClient.devInspectTransactionBlock({ sender, transactionBlock: tx });
    if (res.error)
        throw new Error(`Current Multiply overview: ${res.error}`);
    const raw = res.results?.[0]?.returnValues?.[0]?.[0];
    if (!raw)
        throw new Error('Current Multiply overview: empty return');
    return overviewSchema.parse(Uint8Array.from(raw));
}
async function inspectRates(marketType, marketId, assets, sender) {
    const out = new Map();
    if (assets.length === 0)
        return out;
    const tx = new Transaction();
    for (const asset of assets) {
        tx.moveCall({
            target: `${PROTOCOL_PKG}::market_query::get_asset_market_rates`,
            typeArguments: [with0x(marketType)],
            arguments: [tx.object(marketId), tx.pure.string(asset.replace(/^0x/i, '')), tx.object('0x6')],
        });
    }
    const res = await suiClient.devInspectTransactionBlock({ sender, transactionBlock: tx });
    if (res.error)
        throw new Error(`Current Multiply rates: ${res.error}`);
    const vec = bcs.vector(decimalSchema);
    for (let i = 0; i < assets.length; i++) {
        const raw = res.results?.[i]?.returnValues?.[0]?.[0];
        if (!raw)
            continue;
        const parsed = vec.parse(Uint8Array.from(raw));
        out.set(typeKey(assets[i]), {
            exchange: BigInt(parsed[0]?.value ?? 0),
            borrowIndex: BigInt(parsed[1]?.value ?? 0),
        });
    }
    return out;
}
async function resolveMarketObjectId(marketType, obligationId) {
    const key = marketTypeKey(marketType);
    for (const [k, id] of Object.entries(MARKET_OBJECT_BY_TYPE)) {
        if (marketTypeKey(k) === key)
            return id;
    }
    const obj = await suiClient.getObject({ id: obligationId, options: { showContent: true } });
    const content = obj.data?.content;
    const id = content?.fields?.lending_market_id;
    return typeof id === 'string' && id.startsWith('0x') ? id : null;
}
function readDecimals(info) {
    if (info?.decimals == null || info.decimals === '')
        return null;
    const d = Number(info.decimals);
    return Number.isFinite(d) && d >= 0 && d <= 18 ? d : null;
}
function readPrice(info) {
    if (info?.price == null || info.price === '')
        return null;
    const p = Number(info.price);
    return Number.isFinite(p) && p > 0 ? p : null;
}
function finiteOrNull(n) {
    return n != null && Number.isFinite(n) ? n : null;
}
/**
 * Live Multiply positions for Vaults.
 * Equity = collateral USD − debt USD. Rewards tracked separately (added only via unclaimedRewardUSD).
 */
export async function getCurrentMultiplyVaultPositions(walletAddress, _opts) {
    const gen = ++multiplyReadGen;
    const owner = walletAddress.toLowerCase();
    const rows = await getJson(`/multiply/getLeverageObligationByAddress/${walletAddress}`);
    if (gen !== multiplyReadGen || owner !== walletAddress.toLowerCase()) {
        throw new Error('Stale Current Multiply read');
    }
    const apiReceivedAtMs = Date.now();
    const active = (rows ?? []).filter((r) => r.lendingObligationId && r.collateralToken && r.debtToken && r.positionState !== false);
    if (active.length === 0)
        return [];
    const vaultMeta = await fetchMultiplyList().catch(() => ({
        rows: [],
        receivedAtMs: Date.now(),
        cacheAgeMs: 0,
    }));
    const vaultList = vaultMeta.rows;
    const marketRows = await fetchAllMarketRows().catch(() => []);
    const marketMeta = currentMarketListMeta();
    const out = [];
    for (const row of active) {
        const obligationId = row.lendingObligationId;
        const marketType = with0x(row.market ?? '');
        const collateralType = with0x(row.collateralToken);
        const debtType = with0x(row.debtToken);
        const emode = Number(row.emodeGroup ?? 0);
        const vault = matchVault(vaultList, marketType, emode, collateralType, debtType);
        const supplyMeta = vault?.tokenInfo0;
        const borrowMeta = vault?.tokenInfo1;
        const supplyDec = readDecimals(supplyMeta);
        const borrowDec = readDecimals(borrowMeta);
        const pxSupply = readPrice(supplyMeta);
        const pxBorrow = readPrice(borrowMeta);
        const apiCollRaw = parseRawIntegerAmount(row.collateralAmount);
        const apiDebtRaw = parseRawIntegerAmount(row.debtAmount);
        let supplyRaw = apiCollRaw;
        let borrowRaw = apiDebtRaw;
        let depositExchange = DECIMAL_SCALE;
        let source = 'api_amounts';
        let chainAmountsReadAtMs = null;
        let rewardsReadAtMs = null;
        const completenessFlags = [];
        const marketId = await resolveMarketObjectId(marketType, obligationId).catch(() => null);
        if (marketId) {
            try {
                const overview = await inspectOverview(marketType, marketId, obligationId, walletAddress);
                const assets = [
                    ...overview.deposits.map((d) => d.asset),
                    ...overview.borrows.map((b) => b.asset),
                ];
                const rates = await inspectRates(marketType, marketId, assets, walletAddress);
                const dep = overview.deposits.find((d) => typeKey(d.asset) === typeKey(collateralType));
                const bor = overview.borrows.find((b) => typeKey(b.asset) === typeKey(debtType));
                if (dep) {
                    depositExchange = rates.get(typeKey(dep.asset))?.exchange ?? DECIMAL_SCALE;
                    supplyRaw = coinRaw(BigInt(dep.ctoken_amount) * depositExchange);
                }
                if (bor) {
                    const borrowMarketIndex = rates.get(typeKey(bor.asset))?.borrowIndex ?? DECIMAL_SCALE;
                    const stored = BigInt(bor.borrow_index.value);
                    const debt = BigInt(bor.debt.value);
                    const scaled = stored > 0n ? (debt * borrowMarketIndex) / stored : debt;
                    borrowRaw = coinRaw(scaled);
                }
                source = apiCollRaw != null || apiDebtRaw != null ? 'mixed' : 'on_chain_overview';
                chainAmountsReadAtMs = Date.now();
            }
            catch (err) {
                console.warn('[current-multiply] on-chain overview fallback to API amounts', obligationId, err);
                completenessFlags.push('partial_api_fallback');
                source = 'api_amounts';
            }
        }
        else {
            completenessFlags.push('partial_api_fallback');
        }
        if (supplyDec == null)
            completenessFlags.push('partial_missing_decimals');
        if (borrowDec == null)
            completenessFlags.push('partial_missing_decimals');
        if (pxSupply == null || pxBorrow == null)
            completenessFlags.push('partial_missing_prices');
        const supplyHuman = supplyRaw != null && supplyDec != null ? humanFromRawBigint(supplyRaw, supplyDec) : null;
        const borrowHuman = borrowRaw != null && borrowDec != null ? humanFromRawBigint(borrowRaw, borrowDec) : null;
        const supplyUsd = supplyHuman != null && pxSupply != null ? supplyHuman * pxSupply : null;
        const borrowUsd = borrowHuman != null && pxBorrow != null ? borrowHuman * pxBorrow : null;
        const equityUsd = multiplyEquityUsd(supplyUsd, borrowUsd);
        const multiplier = multiplyMultiplier(supplyUsd, equityUsd);
        const baseSupplyApr = finiteOrNull(vault?.supplyAPR ?? null);
        const baseBorrowApr = finiteOrNull(vault?.borrowAPR ?? null);
        if (baseSupplyApr == null || baseBorrowApr == null)
            completenessFlags.push('partial_missing_rates');
        let depositRewardApr = null;
        let borrowRewardApr = null;
        let claimableRewards = [];
        let claimableRewardsUsd = null;
        let rewardsStatus = 'unavailable';
        let pendingStakeRewards;
        if (marketId && supplyDec != null && borrowDec != null && pxSupply != null && pxBorrow != null) {
            const [depMining, borMining, mined] = await Promise.all([
                readMiningRewardApr(marketId, 'deposit', collateralType, depositExchange, supplyDec, pxSupply, marketRows),
                readMiningRewardApr(marketId, 'borrow', debtType, DECIMAL_SCALE, borrowDec, pxBorrow, marketRows),
                readClaimableMining(marketId, obligationId, [collateralType], [debtType], marketRows),
            ]);
            rewardsReadAtMs = Math.max(depMining.readAtMs, borMining.readAtMs, mined.readAtMs);
            const knownApr = (read) => read.status === 'complete' || read.status === 'empty' ? (read.apr ?? 0) : null;
            depositRewardApr = knownApr(depMining);
            borrowRewardApr = knownApr(borMining);
            if (depositRewardApr == null || borrowRewardApr == null)
                completenessFlags.push('partial_missing_rewards');
            rewardsStatus = mined.status;
            claimableRewards = mined.rows.map((r) => ({
                symbol: r.symbol,
                coinType: r.coinType,
                amountRaw: r.amountRaw,
                decimals: r.decimals,
                amount: r.amount,
                amountUsd: r.valueUSD,
            }));
            if (mined.status === 'empty')
                claimableRewardsUsd = 0;
            else if ((mined.status === 'complete' || mined.status === 'partial') && claimableRewards.every((r) => r.amountUsd != null) && claimableRewards.length > 0) {
                claimableRewardsUsd = claimableRewards.reduce((s, r) => s + (r.amountUsd ?? 0), 0);
            }
            else if (mined.status === 'complete' && claimableRewards.length === 0) {
                rewardsStatus = 'empty';
                claimableRewardsUsd = 0;
            }
            else {
                claimableRewardsUsd = null;
            }
            if (mined.status === 'partial' || mined.status === 'unavailable') {
                completenessFlags.push('partial_missing_rewards');
            }
            pendingStakeRewards = claimableRewards
                .filter((r) => r.amount != null && r.amountUsd != null)
                .map((r) => ({
                symbol: r.symbol,
                coinType: r.coinType,
                amount: r.amount ?? 0,
                amountUSD: r.amountUsd ?? 0,
            }));
        }
        else {
            completenessFlags.push('partial_missing_rewards');
        }
        const apr = multiplyNetAprBreakdown({
            collateralUsd: supplyUsd,
            debtUsd: borrowUsd,
            equityUsd,
            baseSupplyApr,
            baseBorrowApr,
            depositIncentiveApr: depositRewardApr,
            borrowIncentiveApr: borrowRewardApr,
            ratesSource: baseSupplyApr != null && baseBorrowApr != null ? 'multiply_list' : 'unavailable',
        });
        const liqLtv = finiteOrNull(vault?.liqLTV ?? null);
        const maxLtv = finiteOrNull(vault?.maxLTV ?? null);
        const risk = multiplyRiskFromSpot({
            collateralAmount: supplyHuman,
            debtAmount: borrowHuman,
            collateralUsd: supplyUsd,
            debtUsd: borrowUsd,
            liquidationLtv: liqLtv,
            maxLtv,
        });
        const tokenA = supplyMeta?.symbol ?? collateralType.split('::').pop() ?? 'SUPPLY';
        const tokenB = borrowMeta?.symbol ?? debtType.split('::').pop() ?? 'DEBT';
        const fromMarket = row.fromMarket ?? vault?.fromMarket ?? null;
        const initialNet = finiteOrNull(row.initialNetValue != null ? Number(row.initialNetValue) : null);
        const lastUpdate = row.updateTime != null && Number.isFinite(row.updateTime) && row.updateTime > 0
            ? row.updateTime
            : null;
        if (apr.coverage !== 'complete')
            completenessFlags.push('partial');
        const completeness = mergeMultiplyCompleteness(completenessFlags);
        const requestFinishedAtMs = Date.now();
        const currentMultiply = {
            kind: 'current_multiply',
            obligationId,
            leverageOwnerCapId: row.leverageOwnerCap ?? null,
            marketType,
            marketObjectId: marketId,
            emodeGroup: Number.isFinite(emode) ? emode : null,
            fromMarket,
            collateral: {
                coinType: collateralType,
                symbol: tokenA,
                amountRaw: supplyRaw != null ? supplyRaw.toString() : '',
                decimals: supplyDec,
                amount: supplyHuman,
                priceUsd: pxSupply,
                valueUsd: supplyUsd,
                iconUrl: supplyMeta?.icon ?? null,
                priceSource: pxSupply != null ? 'multiply_list' : 'unavailable',
            },
            debt: {
                coinType: debtType,
                symbol: tokenB,
                amountRaw: borrowRaw != null ? borrowRaw.toString() : '',
                decimals: borrowDec,
                amount: borrowHuman,
                priceUsd: pxBorrow,
                valueUsd: borrowUsd,
                iconUrl: borrowMeta?.icon ?? null,
                priceSource: pxBorrow != null ? 'multiply_list' : 'unavailable',
            },
            equityUsd,
            multiplier,
            apr,
            risk,
            claimableRewards,
            claimableRewardsUsd,
            rewardsStatus,
            initialNetValueUsd: initialNet,
            lastUpdateTimeMs: lastUpdate,
            observedAtMs: requestFinishedAtMs,
            freshness: {
                requestFinishedAtMs,
                chainAmountsReadAtMs,
                apiReceivedAtMs,
                apiPositionUpdateTimeMs: lastUpdate,
                ratesCacheAgeMs: vaultMeta.cacheAgeMs,
                rewardsReadAtMs,
                marketListPartial: marketMeta.partial,
            },
            source,
            completeness,
            appUrl: currentMultiplyAppUrl({
                fromMarket,
                collateralCoinType: collateralType,
                debtCoinType: debtType,
            }),
        };
        const equityKnown = equityUsd != null && Number.isFinite(equityUsd);
        const rewardUsdKnown = claimableRewardsUsd != null && Number.isFinite(claimableRewardsUsd);
        const unclaimedRewardUSD = rewardUsdKnown ? claimableRewardsUsd : Number.NaN;
        out.push({
            id: obligationId,
            protocol: 'cetus',
            poolId: row.leverageOwnerCap ?? obligationId,
            pair: `${tokenA}/${tokenB}`,
            tokenA,
            tokenB,
            tokenAAddress: collateralType,
            tokenBAddress: debtType,
            tokenAIconUrl: supplyMeta?.icon ?? undefined,
            tokenBIconUrl: borrowMeta?.icon ?? undefined,
            tokenADecimals: supplyDec ?? Number.NaN,
            tokenBDecimals: borrowDec ?? Number.NaN,
            fee: 0,
            tickLower: 0,
            tickUpper: 0,
            currentTick: 0,
            currentSqrtPrice: '0',
            // Non-zero sentinel so isEmptyLpPosition is false; not CLMM liquidity.
            liquidity: supplyRaw != null && supplyRaw > 0n ? supplyRaw.toString() : '1',
            lifecycleStatus: 'active',
            // Not a CLMM range — Vaults filter excludes via cetusVault; keep out_of_range so
            // accidental CLMM aggregators never count Multiply as In Range.
            status: 'out_of_range',
            tokenAAmount: supplyHuman ?? Number.NaN,
            // Debt stays on the position for detail UI; exposure aggregators must not treat it as a long asset.
            tokenBAmount: borrowHuman ?? Number.NaN,
            currentPriceA_USD: pxSupply ?? Number.NaN,
            currentPriceB_USD: pxBorrow ?? Number.NaN,
            // Equity only. Unknown equity stays NaN so Net Worth does not book $0.
            currentValueUSD: equityKnown ? equityUsd : Number.NaN,
            depositedUSD: 0,
            pnlUSD: 0,
            pnlPct: 0,
            unclaimedFeeA: 0,
            unclaimedFeeB: 0,
            unclaimedFeeUSD: 0,
            unclaimedRewardUSD,
            openedAt: 0,
            daysOpen: 0,
            lifetimeEarningsUSD: Number.NaN,
            vsHodlDeltaUSD: 0,
            aprEstimatePct: apr.netAprPct ?? Number.NaN,
            currentMultiply,
            cetusVault: {
                vaultId: obligationId,
                lpTokenType: 'current-multiply',
                lpTokenRaw: String(row.leverageOwnerCap ?? obligationId),
                // Compatibility shell only — never store multiplier here (was Share 4% / 4 LP bug).
                lpTokenAmount: 0,
                feeLabel: 'Multiply',
                provider: 'Current',
                quoteCoinType: debtType,
                vaultAprPct: apr.coverage === 'complete' ? (apr.netAprPct ?? undefined) : undefined,
                rewardAprPct: undefined,
                pendingStakeRewards,
            },
        });
    }
    if (gen !== multiplyReadGen)
        throw new Error('Stale Current Multiply read');
    return out;
}
