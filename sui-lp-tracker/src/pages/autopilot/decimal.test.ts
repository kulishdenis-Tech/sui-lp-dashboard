import { describe, expect, it } from 'vitest'
import { parseLocaleNumber } from './decimal'

describe('parseLocaleNumber', () => {
	it('parses en-US thousands with decimal', () => {
		expect(parseLocaleNumber('1,500.00')).toBe(1500)
		expect(parseLocaleNumber('12,345.67')).toBe(12345.67)
	})

	it('parses decimal comma without thousands', () => {
		expect(parseLocaleNumber('1,5')).toBe(1.5)
		expect(parseLocaleNumber('0,25')).toBe(0.25)
	})

	it('keeps price-scale decimals with three digits after comma', () => {
		expect(parseLocaleNumber('0,895')).toBeCloseTo(0.895, 10)
		expect(parseLocaleNumber('0,001')).toBeCloseTo(0.001, 10)
		expect(parseLocaleNumber('0,89582')).toBeCloseTo(0.89582, 10)
	})

	it('parses plain and dotted decimals', () => {
		expect(parseLocaleNumber('1500')).toBe(1500)
		expect(parseLocaleNumber('1.5')).toBe(1.5)
		expect(parseLocaleNumber('0.895')).toBeCloseTo(0.895, 10)
	})

	it('parses multi-group thousands with commas only', () => {
		expect(parseLocaleNumber('1,500,000')).toBe(1_500_000)
	})

	it('rejects ambiguous single-comma thousands and garbage', () => {
		expect(parseLocaleNumber('1,500')).toBeNull()
		expect(parseLocaleNumber('')).toBeNull()
		expect(parseLocaleNumber('abc')).toBeNull()
		expect(parseLocaleNumber('1.500.00')).toBeNull()
	})
})
