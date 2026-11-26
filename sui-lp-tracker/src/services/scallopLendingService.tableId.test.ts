import { describe, expect, it } from 'vitest'
import { scallopTableIdFromWitTable } from './scallopLendingService'

describe('scallop WitTable tableId', () => {
	it('reads nested fields.table.id (legacy Move fields shape)', () => {
		const wrapper = {
			fields: {
				id: { id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
				table: {
					fields: {
						id: { id: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
						size: '2',
					},
				},
				keys: { fields: { id: { id: '0xcc' }, size: '2' } },
			},
		}
		expect(scallopTableIdFromWitTable(wrapper)).toBe(
			'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		)
	})

	it('reads flat gRPC json table.id string', () => {
		const wrapper = {
			id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			table: {
				id: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
				size: '1',
			},
		}
		expect(scallopTableIdFromWitTable(wrapper)).toBe(
			'0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
		)
	})

	it('does not return the WitTable wrapper id when table is missing', () => {
		const wrapper = {
			fields: {
				id: { id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
			},
		}
		// Without inner table, unwrap falls through — must not prefer wrapper as DF parent.
		const id = scallopTableIdFromWitTable(wrapper)
		expect(id).not.toBe(
			'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		)
	})
})
