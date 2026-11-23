import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { MobileLayout } from '@/mobile/MobileLayout'
import { HomePage } from '@/mobile/pages/HomePage'
import { DashboardTabs } from '@/mobile/pages/DashboardTabs'

const lz = <T extends Record<string, React.ComponentType>>(load: () => Promise<T>, name: keyof T) =>
	lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })))

const PositionDetailPage = lz(() => import('@/mobile/pages/PositionDetailPage'), 'PositionDetailPage')
const BuildPage = lz(() => import('@/pages/autopilot/BuildPage'), 'BuildPage')
const MarketsPage = lz(() => import('@/mobile/pages/MarketsPage'), 'MarketsPage')
const ActivityPage = lz(() => import('@/pages/activity/ActivityPage'), 'ActivityPage')
const SettingsPage = lz(() => import('@/pages/settings/SettingsPage'), 'SettingsPage')

/**
 * Мобільна оболонка. Екрани переносяться поетапно: Головна вже нова,
 * решта тимчасово використовує адаптовані десктопні сторінки (над тим самим ядром).
 */
export function MobileApp() {
	return (
		<Suspense fallback={null}>
		<Routes>
			<Route path="/" element={<MobileLayout />}>
				<Route index element={<HomePage />} />
				<Route path="home" element={<DashboardTabs />} />
				<Route path="overview-lab" element={<Navigate to="/" replace />} />
				<Route path="analytics" element={<Navigate to="/" replace />} />
				<Route path="home/analytics" element={<Navigate to="/" replace />} />
				<Route path="lp/position/:positionId" element={<PositionDetailPage />} />
				<Route path="lp/build" element={<BuildPage />} />
				<Route path="lp/markets" element={<MarketsPage />} />
				<Route path="activity" element={<ActivityPage />} />
				<Route path="settings" element={<SettingsPage />} />
			</Route>
		</Routes>
		</Suspense>
	)
}
