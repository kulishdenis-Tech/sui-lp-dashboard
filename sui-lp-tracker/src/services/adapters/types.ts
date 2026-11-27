/**
 * DexAdapter — спільний контракт для всіх DEX.
 *
 * Кожен DEX реалізує цей інтерфейс у своєму адаптері.
 * Додавання нового DEX = один рядок у registry.ts.
 *
 * Правила:
 *  - getOpenPositions ніколи не кидає — повертає []
 *  - getClosedPositions ніколи не кидає — повертає ClosedPositionsResult
 *    (incomplete=true при timeout/page_cap/error; не маскувати збій як порожній успіх)
 *  - scanPositionEvents ніколи не кидає — повертає []
 *  - invalidateCache — синхронна, non-fatal
 */

import type { ClosedPosition, LpProtocol, OpenPosition, PositionEvent } from '@/types'

/** Closed list + scan completeness (never equate incomplete empty to a proven zero). */
export type ClosedPositionsResult = {
	positions: ClosedPosition[]
	incomplete: boolean
	reason?: string
}

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
	 * Не кидає — timeout / page_cap / catch → incomplete=true (positions may be partial).
	 */
	getClosedPositions(wallet: string): Promise<ClosedPositionsResult>

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
