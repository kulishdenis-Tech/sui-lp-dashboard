import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('Bluefin seal simulation contract', () => {
	it('simulates rebuilt BCS bytes with Mysten include.effects + balanceChanges', () => {
		const src = readFileSync(join(here, 'buildBluefinTx.ts'), 'utf8')
		expect(src).toMatch(/Transaction\.from\(txBytesBase64\)/)
		expect(src).toMatch(/include:\s*\{\s*\.\.\.SIMULATE_INCLUDE\s*\}/)
		expect(src).toMatch(/SIMULATE_INCLUDE/)
		expect(src).toMatch(/logSimDiagnostics/)
		// Close path uses SDK closePosition (rewards + fees + liquidity + burn).
		expect(src).toMatch(/oc\.closePosition\(/)
		expect(src).toMatch(/collectFeeAndRewards/)
		// Principal-only remove must not use SDK removeLiquidity (forced collect).
		expect(src).toMatch(/gateway::remove_liquidity/)
		expect(src).not.toMatch(/oc\.removeLiquidity\(/)
		expect(src).toMatch(/provideLiquidityWithFixedAmount/)
	})
})
