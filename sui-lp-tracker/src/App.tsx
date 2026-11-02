import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { MainContent } from '@/components/MainContent'
import { DesignSystemPage } from '@/pages/DesignSystemPage'
import { PositionDetailPage } from '@/pages/PositionDetailPage'
import { BuildPage } from '@/pages/autopilot/BuildPage'
import { MarketsRoutePage } from '@/pages/autopilot/MarketsRoutePage'
import { OverviewLabPage } from '@/pages/overviewLab/OverviewLabPage'
import { ActivityPage } from '@/pages/activity/ActivityPage'

function App() {
	return (
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
			</Route>
		</Routes>
	)
}

export default App
