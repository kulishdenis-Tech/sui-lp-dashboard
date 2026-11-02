import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const bundle = readFileSync(
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../api/_lib/cron-bundle.mjs'),
	'utf8',
)

describe('cron snapshot bundle', () => {
	it('uses the live Cetus tick and the raw in-range check', () => {
		expect(bundle).toContain('function livePoolTick')
		expect(bundle).toContain('function cetusTickInRange')
		expect(bundle).toContain('rawInRange')
		expect(bundle).not.toContain('fetchSuietList')
		expect(bundle).not.toContain('VITE_SUIET_COIN_LIST_URL')
	})
})
