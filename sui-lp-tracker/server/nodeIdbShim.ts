/**
 * Node has no IndexedDB. Mark memory backend for `lpEventIdbCache` so wallet /
 * closed-TX caches work within a single GHA / vite-node process (warm delta).
 */
export function installNodeIdbShim(): void {
	;(globalThis as { __SUI_LP_MEMORY_IDB__?: boolean }).__SUI_LP_MEMORY_IDB__ = true
}
