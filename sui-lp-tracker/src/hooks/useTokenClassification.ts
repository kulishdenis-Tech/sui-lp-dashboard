import { useEffect, useMemo, useState } from 'react'
import type { ClassifiedTokenBalance, TokenBalance } from '@/types'
import { getVerifiedCoinList } from '@/services/verifiedTokenList'
import { classifyAllBalances, sortClassifiedTokenBalances } from '@/services/tokenClassifier'
import type { ClassifiedBucket } from '@/services/tokenClassifier'

const depsKey = (balances: TokenBalance[]) =>
	balances.map((b) => `${b.coinType}:${b.humanBalance}:${b.priceUSD ?? 'x'}`).join('|')

export function useTokenClassification(tokenBalances: TokenBalance[]) {
	const [bucket, setBucket] = useState<ClassifiedBucket | null>(null)
	const [isClassifying, setIsClassifying] = useState(false)
	const [classifyError, setClassifyError] = useState<string | null>(null)
	const [whitelistSize, setWhitelistSize] = useState(0)

	const dkey = useMemo(() => depsKey(tokenBalances), [tokenBalances])

	useEffect(() => {
		if (tokenBalances.length === 0) {
			setIsClassifying(false)
			setWhitelistSize(0)
			setBucket({
				mainVerified: [],
				otherUnverifiedPriced: [],
				hidden: [],
			})
			return
		}
		setIsClassifying(true)
		setClassifyError(null)
		const ac = new AbortController()
		;(async () => {
			try {
				const list = await getVerifiedCoinList()
				if (ac.signal.aborted) return
				setWhitelistSize(list.size)
				const bucket = await classifyAllBalances(tokenBalances)
				if (ac.signal.aborted) return
				setBucket(bucket)
			} catch (e) {
				if (!ac.signal.aborted) {
					setClassifyError(e instanceof Error ? e.message : 'Classification failed')
					const nonZero = tokenBalances.filter((b) => b.humanBalance > 0)
					const withClass: ClassifiedTokenBalance[] = nonZero.map((t) => ({
						...t,
						classification: {
							coinType: t.coinType,
							status: 'unverified' as const,
						},
					}))
					setBucket(sortClassifiedTokenBalances(withClass))
				}
			} finally {
				if (!ac.signal.aborted) setIsClassifying(false)
			}
		})()
		return () => ac.abort()
		// dkey is derived from tokenBalances; do not also depend on the array
		// reference — a new ref with the same data would re-run the effect and
		// setState in a loop ("Maximum update depth exceeded").
	}, [dkey])

	return { bucket, isClassifying, classifyError, whitelistSize }
}
