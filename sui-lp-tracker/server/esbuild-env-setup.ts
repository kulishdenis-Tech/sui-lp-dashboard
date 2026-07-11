/**
 * Patch import.meta.env for Node/esbuild bundle (Vercel cron).
 * Must be imported before any @/ service that reads Vite env.
 */
import process from 'node:process'

const envProxy = new Proxy(process.env as Record<string, string | undefined>, {
	get(target, prop: string) {
		if (prop === 'DEV') return 'false'
		if (prop === 'PROD') return 'true'
		if (prop === 'MODE') return 'production'
		if (prop === 'SSR') return 'true'
		if (typeof prop === 'string' && prop in target) return target[prop]
		return undefined
	},
})

Object.defineProperty(import.meta, 'env', {
	value: envProxy,
	writable: false,
	enumerable: true,
	configurable: true,
})

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
if (!globalThis.Buffer) {
	globalThis.Buffer = require('buffer').Buffer
}
