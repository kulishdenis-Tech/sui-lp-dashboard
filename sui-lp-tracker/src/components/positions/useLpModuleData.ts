import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import type { ClosedPosition, OpenPosition } from '@/types'
import {
	enrichCetusLiveFeesFromBot,
	fetchAutopilotOpenDigests,
} from '@/pages/autopilot/enrichCetusLiveFees'
import { expandOpenDigestsWithCascadeCreates } from '@/pages/autopilot/cascadeOpenBindings'

/**
 * Спільні побічні ефекти LP-екрана (десктоп `LpModule` і мобільна LP-сторінка):
 * жива комісія Cetus + open digests через Autopilot-бота, та підвантаження Closed.
 */
export function useLpLiveEnrichment(
	address: string | null,
	open: readonly OpenPosition[],
	isLoading: boolean,
): Map<string, string> {
	const liveFeeKey = useRef('')
	const [openDigestByPosId, setOpenDigestByPosId] = useState<Map<string, string>>(() => new Map())

	useEffect(() => {
		if (!address || open.length === 0 || isLoading) return
		const cetusIds = open
			.filter((p) => p.protocol === 'cetus' && !p.cetusVault)
			.map((p) => p.id)
			.sort()
			.join(',')
		if (!cetusIds) return
		const key = `${address}:${cetusIds}`
		// Only skip after a successful apply for this set (avoid abort-race that never retries).
		if (liveFeeKey.current === key) return
		let cancelled = false
		void (async () => {
			try {
				const snapshot = useAppStore.getState().openPositions
				const [enriched, botDigests] = await Promise.all([
					enrichCetusLiveFeesFromBot(address, snapshot),
					fetchAutopilotOpenDigests(address),
				])
				if (cancelled) return
				// Remap Empty NFTs to their *open* cascade digest (previousTransaction after
				// Withdraw All is the remove tx, so bot digests omit zero-liquidity positions).
				const digests = await expandOpenDigestsWithCascadeCreates(snapshot, botDigests)
				if (cancelled) return
				setOpenDigestByPosId(digests)
				const feeById = new Map(
					enriched.map((p) => [
						p.id,
						{
							unclaimedFeeUSD: p.unclaimedFeeUSD,
							unclaimedFeeA: p.unclaimedFeeA,
							unclaimedFeeB: p.unclaimedFeeB,
						},
					]),
				)
				const prev = useAppStore.getState().openPositions
				let changed = false
				const next = prev.map((p) => {
					const fee = feeById.get(p.id)
					if (!fee) return p
					if (
						fee.unclaimedFeeUSD === p.unclaimedFeeUSD &&
						fee.unclaimedFeeA === p.unclaimedFeeA &&
						fee.unclaimedFeeB === p.unclaimedFeeB
					) {
						return p
					}
					changed = true
					return {
						...p,
						unclaimedFeeUSD: fee.unclaimedFeeUSD,
						unclaimedFeeA: fee.unclaimedFeeA,
						unclaimedFeeB: fee.unclaimedFeeB,
					}
				})
				if (changed) useAppStore.setState({ openPositions: next })
				liveFeeKey.current = key
			} catch {
				/* leave key unset so refresh / next effect can retry */
			}
		})()
		return () => {
			cancelled = true
		}
	}, [address, open, isLoading])

	return openDigestByPosId
}

export function useClosedPositionsLoader(
	active: boolean,
	address: string | null,
	closed: readonly ClosedPosition[],
	isLoadingClosed: boolean,
): void {
	const loadClosedPositions = useAppStore((s) => s.loadClosedPositions)
	const closedReconcileKey = useRef('')
	useEffect(() => {
		if (!active || !address) {
			closedReconcileKey.current = ''
			return
		}
		if (closed.length === 0) {
			if (isLoadingClosed) return
			void loadClosedPositions(address)
			return
		}
		// Once per visit. Refresh also appends closes that landed after the list was built.
		if (closedReconcileKey.current === address) return
		closedReconcileKey.current = address
		void loadClosedPositions(address, { reconcileOnly: true, refreshScan: true })
	}, [active, address, isLoadingClosed, closed.length, loadClosedPositions])
}
