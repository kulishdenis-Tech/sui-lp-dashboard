/**
 * DexAdapter — спільний контракт для всіх DEX.
 *
 * Кожен DEX реалізує цей інтерфейс у своєму адаптері.
 * Додавання нового DEX = один рядок у registry.ts.
 *
 * Правила:
 *  - getOpenPositions / getClosedPositions ніколи не кидають — повертають []
 *  - scanPositionEvents ніколи не кидає — повертає []
 *  - invalidateCache — синхронна, non-fatal
 */

import type { ClosedPosition, LpProtocol, OpenPosition, PositionEvent } from '@/types'

export interface DexAdapter {
	/** Ідентифікатор протоколу (відповідає LpProtocol). */
	readonly protocol: LpProtocol

	/**
	 * Відкриті позиції (NFT з ненульовою ліквідністю у гаманці).
	 * Не кидає — внутрішні помилки → [].
	 */
	getOpenPositions(wallet: string): Promise<OpenPosition[]>

	/**
	 * Закриті позиції (нульова ліквідність або сканування подій).
	 * Не кидає — внутрішні помилки → [].
	 */
	getClosedPositions(wallet: string): Promise<ClosedPosition[]>

	/**
	 * Всі LP-події для конкретної позиції.
	 * Використовується при enrichment відкритих позицій.
	 * Не кидає — внутрішні помилки → [].
	 */
	scanPositionEvents(
		wallet: string,
		positionId: string,
		tokenADecimals: number,
		tokenBDecimals: number,
	): Promise<PositionEvent[]>

	/**
	 * Скинути всі кеші (in-memory + IDB) для гаманця.
	 * Викликається при ручному Refresh.
	 */
	invalidateCache(wallet: string): void
}
