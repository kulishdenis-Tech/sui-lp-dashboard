import { getMomentumPositions } from '@/services/momentumService';
import { getBluefinSpotPositions } from '@/services/bluefinService';
import { getCetusPositions } from '@/services/cetusService';
import { getCetusDlmmPositions } from '@/services/cetusDlmmService';
import { getCetusVaultPositions } from '@/services/cetusVaultsService';
import { getHaedalVaultPositions } from '@/services/haedalVaultsService';
import { getHaedalLendingVaultPositions } from '@/services/haedalLendingVaultsService';
import { getCurrentMultiplyVaultPositions } from '@/services/currentMultiplyVaultsService';
import { getTurbosPositions } from '@/services/turbosService';
import { getAftermathFarmsPositions } from '@/services/aftermathService';
export const PORTFOLIO_LP_SOURCE_IDS = [
    'momentum',
    'bluefin',
    'cetus-clmm',
    'cetus-dlmm',
    'cetus-vaults',
    'haedal-vaults',
    'haedal-lending-vaults',
    'current-multiply',
    'turbos',
    'aftermath',
];
/** Client-side protocol buckets that map onto registry ids (cetus aggregates CLMM+DLMM+vaults). */
export const CLIENT_LP_PROTOCOL_IDS = [
    'momentum',
    'bluefin',
    'cetus',
    'turbos',
    'aftermath',
];
const LOADERS = {
    momentum: (w) => getMomentumPositions(w),
    bluefin: (w, o) => getBluefinSpotPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
    'cetus-clmm': (w, o) => getCetusPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
    'cetus-dlmm': (w, o) => getCetusDlmmPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
    'cetus-vaults': (w, o) => getCetusVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
    'haedal-vaults': (w, o) => getHaedalVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
    'haedal-lending-vaults': (w, o) => getHaedalLendingVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
    'current-multiply': (w, o) => getCurrentMultiplyVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
    turbos: (w) => getTurbosPositions(w),
    aftermath: (w) => getAftermathFarmsPositions(w),
};
export function portfolioLpSourceIds() {
    return PORTFOLIO_LP_SOURCE_IDS;
}
/** Registry must include DLMM (parity with client loadAll). */
export function registryIncludesDlmm() {
    return PORTFOLIO_LP_SOURCE_IDS.includes('cetus-dlmm');
}
export async function loadPortfolioLpSource(id, wallet, opts) {
    try {
        const positions = await LOADERS[id](wallet, opts);
        return { id, ok: true, positions };
    }
    catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return { id, ok: false, error, positions: [] };
    }
}
export async function loadAllPortfolioLpSources(wallet, opts) {
    const loads = [];
    for (const id of PORTFOLIO_LP_SOURCE_IDS) {
        loads.push(await loadPortfolioLpSource(id, wallet, opts));
    }
    const statuses = loads.map((l) => ({
        id: l.id,
        ok: l.ok,
        error: l.error,
        count: l.ok ? l.positions.length : 0,
    }));
    const incomplete = loads.some((l) => !l.ok);
    const positions = loads.filter((l) => l.ok).flatMap((l) => l.positions);
    return { loads, statuses, positions, incomplete };
}
