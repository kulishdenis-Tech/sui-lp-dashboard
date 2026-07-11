import { useLocation, useNavigate } from 'react-router-dom'
import type { AppTab } from '@/store/appStore'
import { useAppStore } from '@/store/appStore'

const TABS: { id: AppTab; label: string }[] = [
	{ id: 'balance', label: 'Balance' },
	{ id: 'lp', label: 'LP' },
	{ id: 'lending', label: 'Lending' },
	{ id: 'analytics', label: 'Analytics' },
]

function isDashboardHome(pathname: string): boolean {
	return pathname === '/' || pathname === ''
}

export function TabNav() {
	const active = useAppStore((s) => s.activeTab)
	const set = useAppStore((s) => s.setActiveTab)
	const navigate = useNavigate()
	const location = useLocation()

	const goToTab = (id: AppTab) => {
		set(id)
		if (!isDashboardHome(location.pathname)) {
			navigate('/', { state: id === 'lp' ? { lpView: 'open' as const } : undefined })
		}
	}

	return (
		<nav
			className="flex gap-1 rounded-lg border border-app-border bg-app-card/35 p-1"
			role="tablist"
			aria-label="Dashboard sections"
		>
			{TABS.map((t) => (
				<button
					key={t.id}
					type="button"
					role="tab"
					aria-selected={active === t.id}
					aria-controls={`tab-panel-${t.id}`}
					id={`tab-${t.id}`}
					className={
						'rounded-md px-4 py-1.5 text-sm font-medium transition ' +
						(active === t.id
							? 'bg-sky-600 text-white'
							: 'text-slate-400 hover:bg-slate-800 hover:text-slate-200')
					}
					onClick={() => goToTab(t.id)}
				>
					{t.label}
				</button>
			))}
		</nav>
	)
}
