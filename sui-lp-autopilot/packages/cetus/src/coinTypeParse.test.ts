import { describe, expect, it } from 'vitest'
import { parseMoveCoinType, resolveCoinDecimals } from './coinTypeParse.js'
import { SUI_DECIMALS, USDC_DECIMALS } from './coins.js'

describe('parseMoveCoinType', () => {
	it('parses plain string type tags', () => {
		expect(parseMoveCoinType('0x2::sui::SUI')).toBe('0x2::sui::SUI')
		expect(
			parseMoveCoinType(
				'deeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
			),
		).toMatch(/::deep::DEEP$/i)
	})

	it('parses TypeName { name } wrappers from gRPC', () => {
		expect(
			parseMoveCoinType({
				name: 'deeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
			}),
		).toMatch(/::deep::DEEP$/i)
		expect(
			parseMoveCoinType({
				fields: {
					name: '0x2::sui::SUI',
				},
			}),
		).toBe('0x2::sui::SUI')
	})

	it('returns null for non-types (avoids [object Object])', () => {
		expect(parseMoveCoinType({})).toBeNull()
		expect(parseMoveCoinType(null)).toBeNull()
		expect(parseMoveCoinType(42)).toBeNull()
	})
})

describe('resolveCoinDecimals', () => {
	it('prefers metadata then known then map', () => {
		expect(
			resolveCoinDecimals({
				coinType: '0x2::sui::SUI',
				metaDecimals: 9,
				knownDecimals: () => SUI_DECIMALS,
			}),
		).toBe(9)
		expect(
			resolveCoinDecimals({
				coinType: '0x2::sui::SUI',
				metaDecimals: null,
				knownDecimals: (ct) => (ct.includes('sui') ? SUI_DECIMALS : null),
			}),
		).toBe(SUI_DECIMALS)
		expect(
			resolveCoinDecimals({
				coinType: '0xabc::deep::DEEP',
				metaDecimals: null,
				knownDecimals: () => null,
				byCoinType: { '0xabc::deep::DEEP': 6 },
			}),
		).toBe(6)
		expect(
			resolveCoinDecimals({
				coinType:
					'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
				metaDecimals: null,
				knownDecimals: () => USDC_DECIMALS,
			}),
		).toBe(USDC_DECIMALS)
		expect(
			resolveCoinDecimals({
				coinType: '0xabc::foo::FOO',
				metaDecimals: null,
				knownDecimals: () => null,
			}),
		).toBeNull()
	})
})
