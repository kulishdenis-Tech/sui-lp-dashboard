import { useSyncExternalStore } from 'react'
import {
	getAutoWithdrawRulesVersion,
	subscribeAutoWithdrawRules,
} from './autoWithdrawStore'

/** Re-render when Auto Withdraw rules change in local cache (Watching badge, Accept queue). */
export function useAutoWithdrawRulesVersion(): number {
	return useSyncExternalStore(
		subscribeAutoWithdrawRules,
		getAutoWithdrawRulesVersion,
		getAutoWithdrawRulesVersion,
	)
}
