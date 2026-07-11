import { Outlet } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { PortfolioDataLoader } from '@/components/PortfolioDataLoader'

export function AppLayout() {
	return (
		<div className="min-h-screen bg-app-bg">
			<Header />
			<PortfolioDataLoader />
			<Outlet />
		</div>
	)
}
