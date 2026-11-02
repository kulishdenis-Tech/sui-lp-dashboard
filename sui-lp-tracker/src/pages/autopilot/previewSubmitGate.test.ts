import { describe, expect, it } from 'vitest'
import { assertPreviewPostWalletSubmitAllowed } from './previewSubmitGate'

const base = {
	drawerStillOpen: true,
	buildGenerationAtSignRequest: 3,
	buildGenerationNow: 3,
	accountAtSignRequest: '0xOwner',
	connectedAddressNow: '0xowner',
	owner: '0xOWNER',
	networkAtSignRequest: 'mainnet',
	networkNow: 'mainnet',
	previewStillFresh: true,
	batchAborted: false,
}

describe('assertPreviewPostWalletSubmitAllowed', () => {
	it('allows matching live context', () => {
		expect(assertPreviewPostWalletSubmitAllowed(base).ok).toBe(true)
	})

	it('blocks when drawer closed during wallet await', () => {
		const r = assertPreviewPostWalletSubmitAllowed({ ...base, drawerStillOpen: false })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.code).toBe('DRAWER_CLOSED')
	})

	it('blocks superseded build generation', () => {
		const r = assertPreviewPostWalletSubmitAllowed({ ...base, buildGenerationNow: 4 })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.code).toBe('PREVIEW_SUPERSEDED')
	})

	it('blocks account change after wallet await', () => {
		const r = assertPreviewPostWalletSubmitAllowed({
			...base,
			connectedAddressNow: '0xother',
		})
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.code).toBe('ACCOUNT_CHANGED')
	})

	it('blocks network change', () => {
		const r = assertPreviewPostWalletSubmitAllowed({
			...base,
			networkNow: 'testnet',
		})
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.code).toBe('NETWORK_CHANGED')
	})

	it('blocks expired preview', () => {
		const r = assertPreviewPostWalletSubmitAllowed({ ...base, previewStillFresh: false })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.code).toBe('PREVIEW_EXPIRED')
	})

	it('blocks aborted cascade batch', () => {
		const r = assertPreviewPostWalletSubmitAllowed({ ...base, batchAborted: true })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.code).toBe('BATCH_ABORTED')
	})
})
