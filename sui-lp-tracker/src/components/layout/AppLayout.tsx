import { Outlet } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { PortfolioDataLoader } from '@/components/PortfolioDataLoader'
import { ToastHost } from '@/components/ui/ToastHost'
import { PriceSpikeWatcher } from '@/components/PriceSpikeWatcher'

export function AppLayout() {
	return (
		<div className="min-h-screen bg-app-bg">
			<Header />
			<PortfolioDataLoader />
			<PriceSpikeWatcher />
			<ToastHost />
			<Outlet />
		</div>
	)
}
