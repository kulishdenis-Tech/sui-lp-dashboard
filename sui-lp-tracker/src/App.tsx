import { Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { MainContent } from '@/components/MainContent'
import { DesignSystemPage } from '@/pages/DesignSystemPage'
import { PositionDetailPage } from '@/pages/PositionDetailPage'

function App() {
	return (
		<Routes>
			<Route path="/" element={<AppLayout />}>
				<Route index element={<MainContent />} />
				<Route path="design-system" element={<DesignSystemPage />} />
				<Route path="lp/position/:positionId" element={<PositionDetailPage />} />
			</Route>
		</Routes>
	)
}

export default App
