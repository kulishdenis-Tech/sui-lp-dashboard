import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

let hydrated = false

/** Load `.env` / `.env.local` into `process.env` once per dev server (server-only keys, no VITE_ filter). */
export function hydrateViteServerEnv(mode: string): void {
	if (hydrated) return
	hydrated = true
	const env = loadEnv(mode, root, '')
	for (const [key, value] of Object.entries(env)) {
		if (process.env[key] === undefined) process.env[key] = value
	}
}
