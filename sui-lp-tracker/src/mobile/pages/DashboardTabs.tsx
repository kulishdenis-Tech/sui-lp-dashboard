import { useAppStore } from '@/store/appStore'
import { BalancePage } from '@/mobile/pages/BalancePage'
import { LendingPage } from '@/mobile/pages/LendingPage'
import { LpPage } from '@/mobile/pages/LpPage'

/** `/home` у мобільній версії: вкладка визначається нижньою навігацією (activeTab). */
export function DashboardTabs() {
	const tab = useAppStore((s) => s.activeTab)
	if (tab === 'lp') return <LpPage />
	if (tab === 'lending') return <LendingPage />
	return <BalancePage />
}
