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

describe('advisor state SWR degraded', () => {
	it('refreshes on every call while the cached state is deadline-degraded', async () => {
		_resetAdvisorStateSwrForTests()
		build.mockReset()
		build
			.mockResolvedValueOnce({ wallet: '0x3', errors: ['advisor: deadline 28000ms exceeded'] })
			.mockResolvedValue({ wallet: '0x3', errors: [] })
		await getAdvisorStateSwr('0x3')
		const second = await getAdvisorStateSwr('0x3')
		expect(second.errors?.length).toBe(1)
		await new Promise((r) => setTimeout(r, 5))
		const third = await getAdvisorStateSwr('0x3')
		expect(third.errors).toEqual([])
		expect(build).toHaveBeenCalledTimes(2)
	})
})
