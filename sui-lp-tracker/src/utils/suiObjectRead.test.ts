import { describe, expect, it } from 'vitest'
import { classifySuiObjectRead } from '@/utils/suiObjectRead'

describe('classifySuiObjectRead', () => {
	it('treats dynamicFieldNotFound as confirmed absence', () => {
		expect(
			classifySuiObjectRead({ error: { code: 'dynamicFieldNotFound', message: 'Dynamic field not found' } }).kind,
		).toBe('not_found')
	})

	it('treats other top-level RPC errors as unavailable', () => {
		expect(classifySuiObjectRead({ error: { code: 'notExists', message: 'Object not found' } }).kind).toBe(
			'unavailable',
		)
	})

	it('treats thrown errors as unavailable unless not-found', () => {
		expect(classifySuiObjectRead(null, new Error('429 rate limit')).kind).toBe('unavailable')
		expect(classifySuiObjectRead(null, new Error('dynamicFieldNotFound')).kind).toBe('not_found')
	})

	it('treats missing data without an error as malformed', () => {
		expect(classifySuiObjectRead({ data: null }).kind).toBe('unavailable')
		expect(classifySuiObjectRead({ data: { objectId: '0x1' } }).kind).toBe('ok')
	})
})
