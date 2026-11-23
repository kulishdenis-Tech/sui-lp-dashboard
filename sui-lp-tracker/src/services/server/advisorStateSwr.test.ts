import { beforeEach, describe, expect, it, vi } from 'vitest'

const build = vi.fn()
vi.mock('@/services/server/advisorState', () => ({ buildAdvisorState: (o: unknown) => build(o) }))

import { _resetAdvisorStateSwrForTests, getAdvisorStateSwr } from '@/services/server/advisorStateSwr'

describe('advisor state SWR', () => {
	beforeEach(() => {
		_resetAdvisorStateSwrForTests()
		build.mockReset()
	})
	it('serves cached state without rebuilding while fresh, dedupes concurrent builds', async () => {
		build.mockResolvedValue({ wallet: '0x1', n: 1 })
		const [a, b] = await Promise.all([getAdvisorStateSwr('0x1'), getAdvisorStateSwr('0x1')])
		expect(a).toBe(b)
		expect(build).toHaveBeenCalledTimes(1)
		await getAdvisorStateSwr('0x1')
		expect(build).toHaveBeenCalledTimes(1)
	})
	it('does not cache failures', async () => {
		build.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ wallet: '0x2' })
		await expect(getAdvisorStateSwr('0x2')).rejects.toThrow('x')
		await expect(getAdvisorStateSwr('0x2')).resolves.toEqual({ wallet: '0x2' })
	})
})
