import { normalizeSuiAddress } from '@mysten/sui/utils';
import { LP_LIFECYCLE_PARSER_VERSION } from '@/types/lpLifecycle';
import { readBluefinPoolIdFromEventJson } from '@/services/eventParser';
import { readMomentumPoolIdFromEventJson, readMomentumPositionId, readMomentumRewardCoinFullType, } from '@/services/momentumLpEvents';
function structTail(typeStr) {
    const p = typeStr.split('::');
    return p[p.length - 1] ?? '';
}
function readBluefinPositionIdJson(pj) {
    const pid = pj['position_id'];
    if (typeof pid === 'string' && pid.startsWith('0x'))
        return pid.trim();
    return null;
}
const BF_STRUCT_LP = {
    PositionOpened: 'OPEN_POSITION',
    LiquidityProvided: 'ADD_LIQUIDITY',
    LiquidityRemoved: 'REMOVE_LIQUIDITY',
    UserFeeCollected: 'COLLECT_FEES',
    UserRewardCollected: 'COLLECT_REWARD',
    PositionClosed: 'CLOSE_POSITION',
};
const MT_STRUCT_LP = {
    OpenPositionEvent: 'OPEN_POSITION',
    ClosePositionEvent: 'CLOSE_POSITION',
    AddLiquidityEvent: 'ADD_LIQUIDITY',
    RemoveLiquidityEvent: 'REMOVE_LIQUIDITY',
    FeeCollectedEvent: 'COLLECT_FEES',
    CollectPoolRewardEvent: 'COLLECT_REWARD',
};
function readSeq(e) {
    const seq = e.id?.eventSeq;
    return seq != null ? String(seq) : undefined;
}
function digestHasExplicitFeeRewardForPid(rowsSameDigestAllPositions, positionNorm) {
    for (const r of rowsSameDigestAllPositions) {
        const pj = r.event.parsedJson;
        if (!pj || typeof pj !== 'object')
            continue;
        const p = pj;
        const tail = structTail(r.event.type);
        if (tail !== 'UserFeeCollected' && tail !== 'UserRewardCollected')
            continue;
        const raw = String(p['position_id'] ?? '');
        if (!raw.startsWith('0x'))
            continue;
        try {
            if (normalizeSuiAddress(raw) === positionNorm)
                return true;
        }
        catch {
            continue;
        }
    }
    return false;
}
/**
 * Bluefin гаманця → `LpAction[]`; `implicitClaimFeesRewards`, якщо remove/close у tx без явного collect для цієї позиції.
 */
export function bluefinRowsToLpActions(walletNormalized, rowsSorted) {
    const byDigest = new Map();
    for (const r of rowsSorted) {
        const arr = byDigest.get(r.digest) ?? [];
        arr.push(r);
        byDigest.set(r.digest, arr);
    }
    const out = [];
    for (const r of rowsSorted) {
        const pj = r.event.parsedJson;
        if (!pj || typeof pj !== 'object')
            continue;
        const p = pj;
        const pid = readBluefinPositionIdJson(p);
        if (!pid)
            continue;
        let positionNorm;
        let poolId;
        try {
            positionNorm = normalizeSuiAddress(pid);
            poolId = readBluefinPoolIdFromEventJson(p);
            if (poolId)
                poolId = normalizeSuiAddress(poolId);
        }
        catch {
            continue;
        }
        const tail = structTail(r.event.type);
        const at = BF_STRUCT_LP[tail];
        if (!at)
            continue;
        const sameDigest = byDigest.get(r.digest) ?? [];
        const liquidityClose = tail === 'LiquidityRemoved' || tail === 'PositionClosed';
        const implicitClaim = liquidityClose && !digestHasExplicitFeeRewardForPid(sameDigest, positionNorm);
        const tsMs = Number.isFinite(r.tsSec) && r.tsSec > 0 ? Math.floor(r.tsSec * 1000) : 0;
        out.push({
            dex: 'bluefin',
            walletAddress: walletNormalized,
            positionId: positionNorm,
            poolId,
            txDigest: r.digest,
            eventSeq: readSeq(r.event),
            timestampMs: tsMs,
            actionType: at,
            balanceChangesRaw: null,
            eventsRaw: r.event,
            parserVersion: LP_LIFECYCLE_PARSER_VERSION,
            implicitClaimFeesRewards: implicitClaim || undefined,
        });
    }
    return out;
}
export function momentumRowsToLpActions(walletNormalized, rowsSorted) {
    const out = [];
    for (const r of rowsSorted) {
        const pj = r.event.parsedJson;
        if (!pj || typeof pj !== 'object')
            continue;
        const p = pj;
        const pos = readMomentumPositionId(p);
        if (!pos)
            continue;
        let positionNorm;
        let poolId;
        try {
            positionNorm = normalizeSuiAddress(pos);
            poolId = readMomentumPoolIdFromEventJson(p);
            if (poolId)
                poolId = normalizeSuiAddress(poolId);
        }
        catch {
            continue;
        }
        const tail = structTail(r.event.type);
        const at = MT_STRUCT_LP[tail];
        if (!at)
            continue;
        let rewardCoinType;
        if (tail === 'CollectPoolRewardEvent') {
            const ct = readMomentumRewardCoinFullType(p);
            if (ct)
                rewardCoinType = ct;
        }
        const tsMs = Number.isFinite(r.tsSec) && r.tsSec > 0 ? Math.floor(r.tsSec * 1000) : 0;
        out.push({
            dex: 'momentum',
            walletAddress: walletNormalized,
            positionId: positionNorm,
            poolId,
            txDigest: r.digest,
            eventSeq: readSeq(r.event),
            timestampMs: tsMs,
            actionType: at,
            rewardCoinType,
            balanceChangesRaw: null,
            eventsRaw: r.event,
            parserVersion: LP_LIFECYCLE_PARSER_VERSION,
        });
    }
    return out;
}
/** Прив’язує `balanceChangesJson` із сирих блоків до відповідних `txDigest`. */
export function hydrateLpActionsBalanceFromHarvest(actions, harvestByDigest) {
    for (const a of actions) {
        const raw = harvestByDigest.get(a.txDigest);
        if (!raw)
            continue;
        a.balanceChangesRaw = raw.balanceChangesJson;
    }
}
