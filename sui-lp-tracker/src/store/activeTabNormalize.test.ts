import { describe, expect, it, beforeEach } from 'vitest'
import { useAppStore } from '@/store/appStore'

describe('activeTab analytics legacy normalize', () => {
	beforeEach(() => {
		useAppStore.setState({ activeTab: 'balance' })
	})

	it('setActiveTab(analytics) becomes balance (Overview owns history)', () => {
		useAppStore.getState().setActiveTab('analytics' as never)
		expect(useAppStore.getState().activeTab).toBe('balance')
	})

	it('normal tabs still work', () => {
		useAppStore.getState().setActiveTab('lp')
		expect(useAppStore.getState().activeTab).toBe('lp')
		useAppStore.getState().setActiveTab('lending')
		expect(useAppStore.getState().activeTab).toBe('lending')
	})
})
