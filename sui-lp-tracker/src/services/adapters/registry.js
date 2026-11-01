import { bluefinAdapter } from './bluefinAdapter';
import { momentumAdapter } from './momentumAdapter';
import { cetusAdapter } from './cetusAdapter';
import { turbosAdapter } from './turbosAdapter';
import { invalidateLpWalletScanSession } from '@/services/lpScanSession';
export const DEX_ADAPTERS = [
    bluefinAdapter,
    momentumAdapter,
    cetusAdapter,
    turbosAdapter,
];
/** Знайти адаптер за протоколом (або undefined якщо ще не зареєстрований). */
export function getAdapterByProtocol(protocol) {
    return DEX_ADAPTERS.find((a) => a.protocol === protocol);
}
/** Скинути кеші всіх адаптерів для гаманця. */
export function invalidateAllAdapterCaches(wallet) {
    invalidateLpWalletScanSession(wallet);
    for (const adapter of DEX_ADAPTERS) {
        try {
            adapter.invalidateCache(wallet);
        }
        catch {
            // non-fatal
        }
    }
}
