import { Navigate, Route, Routes } from 'react-router-dom'
import { MobileLayout } from '@/mobile/MobileLayout'
import { HomePage } from '@/mobile/pages/HomePage'
import { DashboardTabs } from '@/mobile/pages/DashboardTabs'
import { PositionDetailPage } from '@/pages/PositionDetailPage'
import { BuildPage } from '@/pages/autopilot/BuildPage'
import { MarketsRoutePage } from '@/pages/autopilot/MarketsRoutePage'
import { ActivityPage } from '@/pages/activity/ActivityPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'

/**
 * Мобільна оболонка. Екрани переносяться поетапно: Головна вже нова,
 * решта тимчасово використовує адаптовані десктопні сторінки (над тим самим ядром).
 */
export function MobileApp() {
	return (
		<Routes>
			<Route path="/" element={<MobileLayout />}>
				<Route index element={<HomePage />} />
				<Route path="home" element={<DashboardTabs />} />
				<Route path="overview-lab" element={<Navigate to="/" replace />} />
				<Route path="analytics" element={<Navigate to="/" replace />} />
				<Route path="home/analytics" element={<Navigate to="/" replace />} />
				<Route path="lp/position/:positionId" element={<PositionDetailPage />} />
				<Route path="lp/build" element={<BuildPage />} />
				<Route path="lp/markets" element={<MarketsRoutePage />} />
				<Route path="activity" element={<ActivityPage />} />
				<Route path="settings" element={<SettingsPage />} />
			</Route>
		</Routes>
	)
}
