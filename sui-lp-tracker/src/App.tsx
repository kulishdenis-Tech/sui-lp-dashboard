import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useIsMobile } from '@/mobile/useIsMobile'

const lz = <T extends Record<string, React.ComponentType>>(load: () => Promise<T>, name: keyof T) =>
	lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })))

const AppLayout = lz(() => import('@/components/layout/AppLayout'), 'AppLayout')
const MainContent = lz(() => import('@/components/MainContent'), 'MainContent')
const DesignSystemPage = lz(() => import('@/pages/DesignSystemPage'), 'DesignSystemPage')
const PositionDetailPage = lz(() => import('@/pages/PositionDetailPage'), 'PositionDetailPage')
const BuildPage = lz(() => import('@/pages/autopilot/BuildPage'), 'BuildPage')
const MarketsRoutePage = lz(() => import('@/pages/autopilot/MarketsRoutePage'), 'MarketsRoutePage')
const OverviewLabPage = lz(() => import('@/pages/overviewLab/OverviewLabPage'), 'OverviewLabPage')
const ActivityPage = lz(() => import('@/pages/activity/ActivityPage'), 'ActivityPage')
const SettingsPage = lz(() => import('@/pages/settings/SettingsPage'), 'SettingsPage')
const MobileApp = lz(() => import('@/mobile/MobileApp'), 'MobileApp')

function App() {
	const isMobile = useIsMobile()
	if (isMobile) {
		return (
			<Suspense fallback={null}>
				<MobileApp />
			</Suspense>
		)
	}
	return (
		<Suspense fallback={null}>
		<Routes>
			<Route path="/" element={<AppLayout />}>
				<Route index element={<OverviewLabPage />} />
				<Route path="home" element={<MainContent />} />
				<Route path="design-system" element={<DesignSystemPage />} />
				{/* Legacy paths — Overview is home; Analytics merged into Overview */}
				<Route path="overview-lab" element={<Navigate to="/" replace />} />
				<Route path="analytics" element={<Navigate to="/" replace />} />
				<Route path="home/analytics" element={<Navigate to="/" replace />} />
				<Route path="lp/position/:positionId" element={<PositionDetailPage />} />
				<Route path="lp/build" element={<BuildPage />} />
				<Route path="lp/markets" element={<MarketsRoutePage />} />
				<Route path="activity" element={<ActivityPage />} />
				<Route path="settings" element={<SettingsPage />} />
				{/* Unknown URL (e.g. /lp): go home instead of a blank screen */}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Route>
		</Routes>
		</Suspense>
	)
}

export default App
