/**
 * DEX Registry — єдина точка реєстрації всіх адаптерів.
 *
 * Додати новий DEX = 2 рядки:
 *   import { turbosAdapter } from './turbosAdapter'
 *   // + додати turbosAdapter до DEX_ADAPTERS
 *
 * Порядок визначає порядок у merged-списку позицій.
 */
import type { DexAdapter } from './types'
import type { LpProtocol } from '@/types'
import { bluefinAdapter } from './bluefinAdapter'
import { momentumAdapter } from './momentumAdapter'
import { cetusAdapter } from './cetusAdapter'
import { turbosAdapter } from './turbosAdapter'
import { invalidateLpWalletScanSession } from '@/services/lpScanSession'

export const DEX_ADAPTERS: readonly DexAdapter[] = [
	bluefinAdapter,
	momentumAdapter,
	cetusAdapter,
	turbosAdapter,
]

/** Знайти адаптер за протоколом (або undefined якщо ще не зареєстрований). */
export function getAdapterByProtocol(protocol: LpProtocol): DexAdapter | undefined {
	return DEX_ADAPTERS.find((a) => a.protocol === protocol)
}

/** Скинути кеші всіх адаптерів для гаманця. */
export function invalidateAllAdapterCaches(wallet: string): void {
	invalidateLpWalletScanSession(wallet)
	for (const adapter of DEX_ADAPTERS) {
		try {
			adapter.invalidateCache(wallet)
		} catch {
			// non-fatal
		}
	}
}
