import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { TypeTagSerializer } from '@mysten/sui/bcs'
import { describe, expect, it, vi } from 'vitest'
import { encodeLegacyDfName } from './encodeDfName'
import { createJsonRpcCompatClient } from './jsonRpcCompat'

const PARENT = '0x' + 'ab'.repeat(32)
const idA = '0x' + '11'.repeat(32)
const idB = '0x' + '22'.repeat(32)

function fieldObject(objectId: string) {
	return { object: { objectId, version: '1', digest: 'd', type: '0x2::dynamic_field::Field<K,V>', json: { value: {} } } }
}

describe('derived dynamic-field ids', () => {
	it('after one verified lookup a parent is read with a single getObject (hit or miss)', async () => {
		const nameA = encodeLegacyDfName({ type: '0x2::object::ID', value: idA })
		const fieldIdA = deriveDynamicFieldID(PARENT, TypeTagSerializer.parseFromStr(nameA.type), nameA.bcs)
		const getDynamicObjectField = vi.fn().mockRejectedValue(new Error('not an object field'))
		const getDynamicField = vi.fn().mockResolvedValue({ dynamicField: { fieldId: fieldIdA } })
		const getObject = vi.fn(async ({ objectId }: { objectId: string }) => {
			if (objectId === fieldIdA) return fieldObject(fieldIdA)
			throw new Error('not found')
		})
		const client = createJsonRpcCompatClient({ getDynamicObjectField, getDynamicField, getObject } as never)

		const first = await client.getDynamicFieldObject({ parentId: PARENT, name: { type: '0x2::object::ID', value: idA } })
		expect((first as { data: unknown }).data).toBeTruthy()
		expect(getDynamicField).toHaveBeenCalledTimes(1)

		getDynamicObjectField.mockClear()
		getDynamicField.mockClear()
		getObject.mockClear()
		const miss = await client.getDynamicFieldObject({ parentId: PARENT, name: { type: '0x2::object::ID', value: idB } })
		expect((miss as { data: unknown }).data).toBeNull()
		expect(getObject).toHaveBeenCalledTimes(1)
		expect(getDynamicObjectField).not.toHaveBeenCalled()
		expect(getDynamicField).not.toHaveBeenCalled()
	})
})
