import { useLocation, useNavigate } from 'react-router-dom'
import type { AppTab } from '@/store/appStore'
import { useAppStore } from '@/store/appStore'
import {
	appHeaderControlShell,
	appHeaderSegActive,
	appHeaderSegIdle,
} from '@/design/appPrimitives'

/** Balance / LP / Lending live under /home (Overview owns `/` + history). */
export const DASHBOARD_HOME = '/home'

const TABS: { id: AppTab; label: string }[] = [
	{ id: 'balance', label: 'Balance' },
	{ id: 'lp', label: 'LP' },
	{ id: 'lending', label: 'Lending' },
]

const LP_LINKS: { path: string; label: string }[] = [
	{ path: '/lp/build', label: 'Build' },
	{ path: '/lp/markets', label: 'Markets' },
]

function isDashboardHome(pathname: string): boolean {
	return pathname === DASHBOARD_HOME || pathname === '/home/'
}

function isOverviewHome(pathname: string): boolean {
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
			navigate(DASHBOARD_HOME, {
				state: id === 'lp' ? { lpView: 'open' as const } : undefined,
			})
		}
	}

	return (
		<nav
			className={`${appHeaderControlShell} w-max max-w-none`}
			role="tablist"
			aria-label="Dashboard sections"
		>
			<button
				type="button"
				role="tab"
				aria-selected={isOverviewHome(location.pathname)}
				className={
					isOverviewHome(location.pathname) ? appHeaderSegActive : appHeaderSegIdle
				}
				onClick={() => navigate('/')}
			>
				Overview
			</button>
			{TABS.map((t) => {
				const selected = isDashboardHome(location.pathname) && active === t.id
				return (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={selected}
						aria-controls={`tab-panel-${t.id}`}
						id={`tab-${t.id}`}
						className={selected ? appHeaderSegActive : appHeaderSegIdle}
						onClick={() => goToTab(t.id)}
					>
						{t.label}
					</button>
				)
			})}
			<button
				type="button"
				role="tab"
				aria-selected={location.pathname === '/activity'}
				className={location.pathname === '/activity' ? appHeaderSegActive : appHeaderSegIdle}
				onClick={() => navigate('/activity')}
			>
				Activity
			</button>
			{LP_LINKS.map((link) => {
				const selected = location.pathname === link.path
				return (
					<button
						key={link.path}
						type="button"
						role="tab"
						aria-selected={selected}
						className={selected ? appHeaderSegActive : appHeaderSegIdle}
						onClick={() => {
							set('lp')
							navigate(link.path)
						}}
					>
						{link.label}
					</button>
				)
			})}
		</nav>
	)
}
