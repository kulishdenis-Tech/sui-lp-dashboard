import { describe, expect, it } from 'vitest'
import { fetchActivityDigest } from '@/services/activity/activityGraphql'
import { interpretActivity, signedNetFeeRaw } from '@/services/activity/activityModel'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const DIGEST = '9VGojLKFN2d89eproWWbG5APkAa461n5Cpg3DhX85CC1'

const live = process.env.ACTIVITY_LIVE === '1' ? describe : describe.skip

live('activity graphql digest', () => {
	it('matches the indexed incoming SUI transfer', async () => {
		const raw = await fetchActivityDigest(DIGEST)
		expect(raw).not.toBeNull()
		expect(raw!.status).toBe('success')
		expect(signedNetFeeRaw(raw!.computationCost, raw!.storageCost, raw!.storageRebate)).toBe('1747880')
		const row = interpretActivity(raw!, WALLET)
		expect(row.primaryKind).toBe('received')
		expect(row.feePaidByWallet).toBe(false)
		expect(row.activities[0]?.actionAmounts[0]?.amountRaw).toBe('1000000000')
	}, 30_000)
})
