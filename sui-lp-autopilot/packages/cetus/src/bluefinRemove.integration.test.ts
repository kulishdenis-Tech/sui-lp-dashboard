import { describe, expect, it } from 'vitest'
import { parseI32Field } from './bluefinPoolFetch.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

describe('Bluefin remove avoids SDK getPositionDetails bits crash', () => {
	it('buildBluefinRemoveTx uses fetchBluefinPosition not QueryChain.getPositionDetails', () => {
		const src = readFileSync(join(here, 'buildBluefinTx.ts'), 'utf8')
		expect(src).toMatch(/fetchBluefinPosition\(/)
		expect(src).not.toMatch(/getPositionDetails\(/)
		expect(src).not.toMatch(/getBluefinQueryChain/)
	})

	it('documents the gRPC vs JSON-RPC tick shape that caused reading bits of undefined', () => {
		// SDK: onChainPosition.lower_tick.fields.bits
		// gRPC: lower_tick.bits  → fields is undefined → crash
		expect(() => {
			const grpc = { bits: 4294896928 }
			// @ts-expect-error intentional bad access matching SDK
			void grpc.fields.bits
		}).toThrow()
		expect(parseI32Field({ bits: 4294896928 })).toBe(-70368)
	})
})
