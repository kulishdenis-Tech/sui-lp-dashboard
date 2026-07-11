/**
 * Node has no IndexedDB — stub so LP scanners fall through to cold RPC
 * (try/catch in lpEventIdbCache) instead of crashing on `indexedDB`.
 */
export function installNodeIdbShim(): void {
	if (typeof globalThis.indexedDB !== 'undefined') return

	const failReq = () => {
		const req: {
			result: null
			error: Error
			onsuccess: ((ev: Event) => void) | null
			onerror: ((ev: Event) => void) | null
			onupgradeneeded: ((ev: Event) => void) | null
			onblocked: ((ev: Event) => void) | null
		} = {
			result: null,
			error: new Error('IndexedDB unavailable in Node'),
			onsuccess: null,
			onerror: null,
			onupgradeneeded: null,
			onblocked: null,
		}
		queueMicrotask(() => {
			req.onerror?.(new Event('error'))
		})
		return req
	}

	Object.defineProperty(globalThis, 'indexedDB', {
		value: { open: failReq, deleteDatabase: failReq, cmp: () => 0 },
		configurable: true,
	})
}
