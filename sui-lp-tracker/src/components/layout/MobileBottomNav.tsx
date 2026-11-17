import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore, type AppTab } from '@/store/appStore'
import { DASHBOARD_HOME } from '@/components/layout/TabNav'

/**
 * Нижня навігація для вузьких екранів (<md). На десктопі лишається TabNav у шапці.
 * Логіка переходів дзеркалить TabNav: Balance/LP/Lending живуть під /home.
 */

type IconProps = { children: ReactNode }

function Icon({ children }: IconProps) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	)
}

const ICONS = {
	overview: (
		<Icon>
			<rect x="3" y="3" width="7" height="9" rx="1" />
			<rect x="14" y="3" width="7" height="5" rx="1" />
			<rect x="14" y="12" width="7" height="9" rx="1" />
			<rect x="3" y="16" width="7" height="5" rx="1" />
		</Icon>
	),
	balance: (
		<Icon>
			<path d="M3 7h18v12H3z" />
			<path d="M3 7l2-3h14l2 3" />
			<path d="M16 13h2" />
		</Icon>
	),
	lp: (
		<Icon>
			<path d="M3 17l5-6 4 4 5-8 4 5" />
			<path d="M3 21h18" />
		</Icon>
	),
	lending: (
		<Icon>
			<path d="M12 2v20" />
			<path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
		</Icon>
	),
	activity: (
		<Icon>
			<path d="M22 12h-4l-3 9L9 3l-3 9H2" />
		</Icon>
	),
	more: (
		<Icon>
			<circle cx="5" cy="12" r="1" />
			<circle cx="12" cy="12" r="1" />
			<circle cx="19" cy="12" r="1" />
		</Icon>
	),
}

const itemBase =
	'flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors'
const itemIdle = `${itemBase} text-slate-400 active:text-slate-200`
const itemActive = `${itemBase} text-sky-400`

export function MobileBottomNav() {
	const active = useAppStore((s) => s.activeTab)
	const setActive = useAppStore((s) => s.setActiveTab)
	const navigate = useNavigate()
	const { pathname } = useLocation()
	const [moreOpen, setMoreOpen] = useState(false)

	const onHome = pathname === DASHBOARD_HOME || pathname === `${DASHBOARD_HOME}/`
	const onOverview = pathname === '/' || pathname === ''
	const onActivity = pathname === '/activity'
	const onMoreRoute =
		pathname === '/lp/build' || pathname === '/lp/markets' || pathname === '/settings'

	const goTab = (id: AppTab) => {
		setActive(id)
		if (!onHome) {
			navigate(DASHBOARD_HOME, {
				state: id === 'lp' ? { lpView: 'open' as const } : undefined,
			})
		}
		window.scrollTo({ top: 0 })
	}

	const go = (path: string, tab?: AppTab) => {
		if (tab) setActive(tab)
		setMoreOpen(false)
		navigate(path)
		window.scrollTo({ top: 0 })
	}

	const tabItem = (id: AppTab, label: string, icon: ReactNode) => {
		const selected = onHome && active === id
		return (
			<button
				key={id}
				type="button"
				className={selected ? itemActive : itemIdle}
				aria-current={selected ? 'page' : undefined}
				onClick={() => goTab(id)}
			>
				{icon}
				{label}
			</button>
		)
	}

	return (
		<>
			{moreOpen ? (
				<div
					className="fixed inset-0 z-[70] md:hidden"
					role="dialog"
					aria-modal="true"
					aria-label="More"
				>
					<button
						type="button"
						aria-label="Close"
						className="absolute inset-0 bg-slate-950/70"
						onClick={() => setMoreOpen(false)}
					/>
					<div className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-xl border-t border-app-border bg-slate-900 p-2 pb-[calc(4.25rem+env(safe-area-inset-bottom))]">
						{[
							{ path: '/lp/build', label: 'LP Build', tab: 'lp' as AppTab },
							{ path: '/lp/markets', label: 'LP Markets', tab: 'lp' as AppTab },
							{ path: '/settings', label: 'Settings', tab: undefined },
						].map((row) => (
							<button
								key={row.path}
								type="button"
								className={`flex min-h-12 w-full items-center rounded-lg px-3 text-left text-sm ${
									pathname === row.path
										? 'bg-sky-600/20 text-sky-300'
										: 'text-slate-200 active:bg-slate-800'
								}`}
								onClick={() => go(row.path, row.tab)}
							>
								{row.label}
							</button>
						))}
					</div>
				</div>
			) : null}
			<nav
				aria-label="Main navigation"
				className="safe-bottom safe-x fixed inset-x-0 bottom-0 z-[75] border-t border-app-border bg-app-bg/95 backdrop-blur md:hidden"
			>
				<div className="mx-auto flex max-w-xl items-stretch">
					<button
						type="button"
						className={onOverview ? itemActive : itemIdle}
						aria-current={onOverview ? 'page' : undefined}
						onClick={() => go('/')}
					>
						{ICONS.overview}
						Overview
					</button>
					{tabItem('balance', 'Balance', ICONS.balance)}
					{tabItem('lp', 'LP', ICONS.lp)}
					{tabItem('lending', 'Lending', ICONS.lending)}
					<button
						type="button"
						className={onActivity ? itemActive : itemIdle}
						aria-current={onActivity ? 'page' : undefined}
						onClick={() => go('/activity')}
					>
						{ICONS.activity}
						Activity
					</button>
					<button
						type="button"
						className={onMoreRoute || moreOpen ? itemActive : itemIdle}
						aria-haspopup="dialog"
						aria-expanded={moreOpen}
						onClick={() => setMoreOpen((v) => !v)}
					>
						{ICONS.more}
						More
					</button>
				</div>
			</nav>
		</>
	)
}
