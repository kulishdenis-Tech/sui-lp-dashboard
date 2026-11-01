/**
 * Haedal Liquidity v2 vault lifecycle events (shown on Cetus Earn).
 *
 * Official package events (`haedal-vault-sdk` / on-chain `vault` module):
 * - `DepositEvent` — user deposit → LP mint (`amount_a`/`amount_b`/`lp_amount`/`vault_id`)
 * - `WithdrawClmmEvent` / `WithdrawDlmmEvent` — leg withdrawals
 * - Lending `vault_events::Deposited` / `Withdrawn` — single-asset amount keyed by `pool_id`
 * - Incentive `0xd5b301…::core::HarvestEvent` — claimed farm rewards
 *
 * Prefer `queryEvents({ Sender })` (cheap per wallet) over global MoveEventType scans.
 */
import Decimal from 'decimal.js';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { suiClient } from '@/services/suiClient';
import { HAEDAL_VAULTS_V2_PACKAGE, HAEDAL_VAULTS_V2_PUBLISHED_AT, VAULT_LP_INCENTIVE_PACKAGE, } from '@/utils/haedalVault';
import { HAEDAL_LENDING_VAULT_PACKAGE } from '@/utils/haedalLendingVault';
import { withRpcBackoff } from '@/utils/rpcBackoff';
const MAX_SENDER_PAGES = 20;
const PAGE = 50;
function normAddr(id) {
    try {
        return normalizeSuiAddress(id);
    }
    catch {
        return null;
    }
}
function readU64(v) {
    if (typeof v === 'string' && /^\d+$/.test(v))
        return v;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0)
        return String(Math.floor(v));
    return '0';
}
function rawToHuman(raw, decimals) {
    if (!/^\d+$/.test(raw) || decimals < 0)
        return 0;
    try {
        return new Decimal(raw).div(new Decimal(10).pow(decimals)).toNumber();
    }
    catch {
        return 0;
    }
}
function readVaultId(pj) {
    const v = pj.vault_id;
    if (typeof v === 'string' && v.startsWith('0x'))
        return normAddr(v);
    if (v && typeof v === 'object' && 'id' in v && typeof v.id === 'string') {
        return normAddr(String(v.id));
    }
    return null;
}
/**
 * Haedal Lending Vault (`vault_events::Deposited` / `Withdrawn`).
 * Single-asset: `amount` / `amount_received` are the underlying coin, keyed by `pool_id`.
 */
function isLendingVaultDepositType(type) {
    return type === `${HAEDAL_LENDING_VAULT_PACKAGE}::vault_events::Deposited`;
}
function isLendingVaultWithdrawType(type) {
    return type === `${HAEDAL_LENDING_VAULT_PACKAGE}::vault_events::Withdrawn`;
}
function readPoolId(pj) {
    const v = pj.pool_id;
    if (typeof v === 'string' && v.startsWith('0x'))
        return normAddr(v);
    return null;
}
function isHaedalVaultDepositType(type) {
    return (type === `${HAEDAL_VAULTS_V2_PACKAGE}::vault::DepositEvent` ||
        type === `${HAEDAL_VAULTS_V2_PUBLISHED_AT}::vault::DepositEvent`);
}
function isHaedalVaultWithdrawType(type) {
    const isWithdraw = type.endsWith('::vault::WithdrawClmmEvent') || type.endsWith('::vault::WithdrawDlmmEvent');
    if (!isWithdraw)
        return false;
    return (type.startsWith(HAEDAL_VAULTS_V2_PACKAGE) || type.startsWith(HAEDAL_VAULTS_V2_PUBLISHED_AT));
}
function isIncentiveHarvestType(type) {
    return type.startsWith(`${VAULT_LP_INCENTIVE_PACKAGE}::core::HarvestEvent`);
}
/** Extract `HarvestEvent<LP>` type argument (vault LP coin type). */
function harvestLpTypeFromEventType(type) {
    const open = type.indexOf('<');
    const close = type.lastIndexOf('>');
    if (open < 0 || close <= open)
        return null;
    const inner = type.slice(open + 1, close).trim();
    if (!inner)
        return null;
    const top = inner.includes(',') ? inner.slice(0, inner.indexOf(',')).trim() : inner;
    return normCoinType(top);
}
function normCoinType(raw) {
    const t = raw.trim();
    if (!t || !t.includes('::'))
        return null;
    const with0x = t.startsWith('0x') ? t : `0x${t}`;
    try {
        const [addr, ...rest] = with0x.split('::');
        return `${normalizeSuiAddress(addr)}::${rest.join('::')}`;
    }
    catch {
        return with0x.toLowerCase();
    }
}
function harvestLpMatches(eventType, vaultLpType) {
    if (!vaultLpType)
        return false;
    const want = normCoinType(vaultLpType);
    if (!want)
        return false;
    const got = harvestLpTypeFromEventType(eventType);
    if (got && got === want)
        return true;
    return eventType.toLowerCase().includes(want.toLowerCase());
}
function emptyEvent(partial) {
    return {
        ...partial,
        feeAmountA: 0,
        feeAmountB: 0,
        rewardAmount: 0,
        rewardToken: '',
        priceA_USD: null,
        priceB_USD: null,
        valueUsdA: null,
        valueUsdB: null,
        valueUsdReward: null,
        totalValueUSD: null,
        priceUnavailable: true,
        priceAtTxApproximate: false,
        priceSource: null,
    };
}
/**
 * Scan Haedal vault deposit/withdraw (+ incentive harvest) for one vault.
 * Returns events plus optional on-chain `user_tvl` (quote-token raw) per deposit digest.
 */
export async function scanHaedalVaultEvents(walletAddress, vaultId, decimalsA, decimalsB, lpTokenType) {
    const { events } = await scanHaedalVaultEventsDetailed(walletAddress, vaultId, decimalsA, decimalsB, lpTokenType);
    return events;
}
export async function scanHaedalVaultEventsDetailed(walletAddress, vaultId, decimalsA, decimalsB, lpTokenType) {
    const wallet = normAddr(walletAddress);
    const vault = normAddr(vaultId);
    if (!wallet || !vault)
        return { events: [], userTvlRawByDigest: new Map() };
    const rewardMetaCache = new Map();
    async function rewardMeta(coinType) {
        const hit = rewardMetaCache.get(coinType);
        if (hit)
            return hit;
        try {
            const m = await suiClient.getCoinMetadata({ coinType });
            const row = {
                symbol: m?.symbol ?? coinType.split('::').pop() ?? 'REWARD',
                decimals: typeof m?.decimals === 'number' ? m.decimals : 9,
            };
            rewardMetaCache.set(coinType, row);
            return row;
        }
        catch {
            const row = { symbol: coinType.split('::').pop() ?? 'REWARD', decimals: 9 };
            rewardMetaCache.set(coinType, row);
            return row;
        }
    }
    const seen = new Set();
    const out = [];
    const userTvlRawByDigest = new Map();
    let cursor;
    let pages = 0;
    do {
        const page = await withRpcBackoff(() => suiClient.queryEvents({
            query: { Sender: wallet },
            cursor: cursor ?? undefined,
            limit: PAGE,
            order: 'descending',
        }), { label: 'haedal-vault-sender', retries: 3, baseMs: 700 });
        for (const e of page.data ?? []) {
            const type = e.type ?? '';
            const digest = e.id.txDigest;
            const seq = e.id.eventSeq;
            const ts = e.timestampMs ? Math.floor(Number(e.timestampMs) / 1000) : 0;
            const pj = (e.parsedJson ?? {});
            if (isLendingVaultDepositType(type)) {
                if (readPoolId(pj) !== vault)
                    continue;
                const id = `${digest}:${seq}:lending-deposit`;
                if (seen.has(id))
                    continue;
                seen.add(id);
                const amountRaw = readU64(pj.amount);
                if (amountRaw !== '0')
                    userTvlRawByDigest.set(digest, amountRaw);
                out.push(emptyEvent({
                    id,
                    txDigest: digest,
                    type: 'add_liquidity',
                    timestamp: ts,
                    positionId: vault,
                    protocol: 'cetus',
                    tokenAAmount: rawToHuman(amountRaw, decimalsA),
                    tokenBAmount: 0,
                    liquidityDelta: (() => {
                        const lp = readU64(pj.shares_minted);
                        const n = Number(lp);
                        return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? n : 0;
                    })(),
                }));
                continue;
            }
            if (isLendingVaultWithdrawType(type)) {
                if (readPoolId(pj) !== vault)
                    continue;
                const id = `${digest}:${seq}:lending-withdraw`;
                if (seen.has(id))
                    continue;
                seen.add(id);
                out.push(emptyEvent({
                    id,
                    txDigest: digest,
                    type: 'remove_liquidity',
                    timestamp: ts,
                    positionId: vault,
                    protocol: 'cetus',
                    tokenAAmount: rawToHuman(readU64(pj.amount_received), decimalsA),
                    tokenBAmount: 0,
                    liquidityDelta: 0,
                }));
                continue;
            }
            if (isHaedalVaultDepositType(type)) {
                if (readVaultId(pj) !== vault)
                    continue;
                const id = `${digest}:${seq}:haedal-deposit`;
                if (seen.has(id))
                    continue;
                seen.add(id);
                const userTvl = readU64(pj.user_tvl);
                if (userTvl !== '0')
                    userTvlRawByDigest.set(digest, userTvl);
                out.push(emptyEvent({
                    id,
                    txDigest: digest,
                    type: 'add_liquidity',
                    timestamp: ts,
                    positionId: vault,
                    protocol: 'cetus',
                    tokenAAmount: rawToHuman(readU64(pj.amount_a), decimalsA),
                    tokenBAmount: rawToHuman(readU64(pj.amount_b), decimalsB),
                    liquidityDelta: (() => {
                        const lp = readU64(pj.lp_amount);
                        const n = Number(lp);
                        return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? n : 0;
                    })(),
                }));
                continue;
            }
            if (isHaedalVaultWithdrawType(type)) {
                if (readVaultId(pj) !== vault)
                    continue;
                const id = `${digest}:${seq}:haedal-withdraw`;
                if (seen.has(id))
                    continue;
                seen.add(id);
                out.push(emptyEvent({
                    id,
                    txDigest: digest,
                    type: 'remove_liquidity',
                    timestamp: ts,
                    positionId: vault,
                    protocol: 'cetus',
                    tokenAAmount: rawToHuman(readU64(pj.amount_a), decimalsA),
                    tokenBAmount: rawToHuman(readU64(pj.amount_b), decimalsB),
                    liquidityDelta: 0,
                }));
                continue;
            }
            if (isIncentiveHarvestType(type)) {
                if (!harvestLpMatches(type, lpTokenType))
                    continue;
                const amountRaw = readU64(pj.amount);
                if (amountRaw === '0')
                    continue;
                const id = `${digest}:${seq}:haedal-harvest`;
                if (seen.has(id))
                    continue;
                seen.add(id);
                const rewardType = typeof pj.reward_type === 'string'
                    ? pj.reward_type
                    : typeof pj.reward_type?.name === 'string'
                        ? String(pj.reward_type.name)
                        : '';
                const coinType = rewardType
                    ? normCoinType(rewardType.startsWith('0x') ? rewardType : `0x${rewardType}`)
                    : null;
                const meta = coinType
                    ? await rewardMeta(coinType)
                    : { symbol: 'REWARD', decimals: 9 };
                const rewardAmount = rawToHuman(amountRaw, meta.decimals);
                out.push({
                    ...emptyEvent({
                        id,
                        txDigest: digest,
                        type: 'collect_reward',
                        timestamp: ts,
                        positionId: vault,
                        protocol: 'cetus',
                        tokenAAmount: 0,
                        tokenBAmount: 0,
                        liquidityDelta: 0,
                    }),
                    rewardToken: meta.symbol,
                    rewardAmount,
                    rewardCoinType: coinType,
                    rewardRawAmount: amountRaw,
                });
            }
        }
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
        pages++;
        // Early exit once we already have a deposit and scanned enough recent history.
        if (out.some((e) => e.type === 'add_liquidity') && pages >= 6)
            break;
    } while (cursor && pages < MAX_SENDER_PAGES);
    return {
        events: out.sort((a, b) => a.timestamp - b.timestamp),
        userTvlRawByDigest,
    };
}
