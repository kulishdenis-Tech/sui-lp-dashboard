import { useAppStore } from '@/store/appStore'
import { BalanceDashboard } from '@/components/balance/BalanceDashboard'
import { LendingPage } from '@/mobile/pages/LendingPage'
import { LpPage } from '@/mobile/pages/LpPage'

/** `/home` у мобільній версії: вкладка визначається нижньою навігацією (activeTab). */
export function DashboardTabs() {
	const tab = useAppStore((s) => s.activeTab)
	if (tab === 'lp') return <LpPage />
	if (tab === 'lending') return <LendingPage />
	return (
		<main className="px-4 pb-6 pt-4">
			<BalanceDashboard />
		</main>
	)
}
