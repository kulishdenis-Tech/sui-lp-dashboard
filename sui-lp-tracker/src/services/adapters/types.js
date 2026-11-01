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
export {};
