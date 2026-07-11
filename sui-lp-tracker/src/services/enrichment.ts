/**
 * Shared position enrichment — USD pricing, HODL basket, PnL.
 *
 * Працює для всіх DEX (Bluefin, Momentum, Cetus).
 * Файл `bluefinEnrichment.ts` залишається як backward-compat shim.
 * Нові імпорти мають використовувати цей файл.
 */
export {
	enrichBluefinOpenPositionWithEvents,
	enrichAllBluefinOpenPositions,
	enrichAllBluefinClosedPositions,
} from '@/services/bluefinEnrichment'
