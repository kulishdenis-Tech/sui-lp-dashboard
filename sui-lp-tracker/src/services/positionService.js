import { DEX_ADAPTERS } from '@/services/adapters';
import { enrichAllBluefinClosedPositions } from '@/services/enrichment';
import { augmentClosedPositionsIndexerFields } from '@/services/lpIndexerAugmentClosed';
import { isLpLifecycleIndexerEnabled } from '@/services/lpFeatureFlags';
import { getLpWalletScanSession } from '@/services/lpScanSession';
/** Adapter-only closed list (no USD enrich). */
export async function fetchClosedFromAdapters(walletAddress) {
    const results = await Promise.allSettled(DEX_ADAPTERS.map((adapter) => adapter.getClosedPositions(walletAddress)));
    return results
        .flatMap((r, i) => {
        if (r.status === 'rejected') {
            console.error(`[positionService] ${DEX_ADAPTERS[i]?.protocol} getClosedPositions failed`, r.reason);
            return [];
        }
        return r.value;
    })
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
}
async function enrichClosedList(merged, walletAddress) {
    if (merged.length === 0)
        return [];
    try {
        const session = getLpWalletScanSession();
        let out = await enrichAllBluefinClosedPositions(merged, walletAddress, { session });
        if (isLpLifecycleIndexerEnabled()) {
            out = await augmentClosedPositionsIndexerFields(walletAddress, out);
        }
        return out;
    }
    catch (e) {
        console.error('getClosedPositions enrich/augment failed — returning merged without full enrichment', e);
        return merged;
    }
}
/**
 * Збирає закриті позиції від усіх зареєстрованих DEX-адаптерів.
 *
 * Кожен адаптер вже обгортає помилки всередині — повертає [] замість throw.
 * Promise.allSettled додає ще один рівень захисту: падіння одного не блокує інші.
 * Якщо падає лише enrichment / indexer augment — повертаємо злитий список без USD.
 *
 * Додати новий DEX = один рядок у services/adapters/registry.ts.
 */
export async function getClosedPositions(walletAddress, options) {
    let merged = options?.prefetched ?? (await fetchClosedFromAdapters(walletAddress));
    if (options?.onlyIds) {
        const only = new Set([...options.onlyIds].map((id) => id.toLowerCase()));
        merged = merged.filter((c) => only.has(c.id.toLowerCase()));
    }
    return enrichClosedList(merged, walletAddress);
}
