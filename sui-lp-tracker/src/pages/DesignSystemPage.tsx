import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PROTOCOL_COLORS } from '@/utils/constants'
import { AppCard } from '@/components/ui/AppCard'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingState } from '@/components/ui/LoadingState'
import { PageShell } from '@/components/ui/PageShell'
import { Spinner } from '@/components/ui/Spinner'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { MetricValueWithPartial } from '@/components/ui/PartialDataMark'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { DataTableHeadCell } from '@/components/ui/DataTableHeadCell'
import {
	appBtnPrimary,
	appBtnSecondary,
	appBtnSecondaryCompact,
	appCardSurface,
	appHeaderActionCluster,
	appTableHeadCellDefault,
	appTableHeadLabel,
	appTableHeadLabelSort,
	appTableHeadRow,
	appTablePoolStickyTd,
	appTablePoolStickyTh,
	appTableShell,
	appTableTd,
} from '@/design/appPrimitives'

/** Розділ з якорем для навігації всередині сторінки */
function Section({
	id,
	title,
	lead,
	children,
}: {
	id: string
	title: string
	lead?: string
	children: ReactNode
}) {
	return (
		<section id={id} className="scroll-mt-24 border-t border-slate-800 pt-10 first:border-t-0 first:pt-0">
			<h2 className="text-lg font-semibold tracking-tight text-slate-100">{title}</h2>
			{lead ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">{lead}</p> : null}
			<div className="mt-6">{children}</div>
		</section>
	)
}

function TokenRow({
	name,
	varName,
	sample,
	desc,
}: {
	name: string
	varName: string
	sample?: ReactNode
	desc: string
}) {
	return (
		<tr className="border-b border-slate-800/80">
			<td className="py-3 align-top">
				<div className="font-mono text-xs text-slate-200">{varName}</div>
				<div className="mt-1 text-[11px] text-slate-500">{name}</div>
			</td>
			<td className="hidden py-3 align-middle sm:table-cell">{sample ?? '—'}</td>
			<td className="py-3 text-xs text-slate-400">{desc}</td>
		</tr>
	)
}

/** Візуальний патерн картки, як у summary / LP summary strip */
function DemoCardShell({ title, subtitle, extra }: { title: string; subtitle?: ReactNode; extra?: ReactNode }) {
	return (
		<div className={`${appCardSurface} p-4 transition-colors`}>
			<p className="flex flex-wrap items-center text-[10px] font-medium uppercase tracking-wider text-slate-500">
				{title}
			</p>
			{subtitle ?
				<div className="mt-1">{subtitle}</div>
			:	null}
			{extra}
		</div>
	)
}

const navAnchors = [
	{ href: '#typography', label: 'Typography' },
	{ href: '#colors', label: 'Colours' },
	{ href: '#spacing', label: 'Spacing' },
	{ href: '#buttons', label: 'Buttons' },
	{ href: '#inputs', label: 'Inputs' },
	{ href: '#cards', label: 'Cards' },
	{ href: '#tables', label: 'Tables' },
	{ href: '#states', label: 'States' },
	{ href: '#experimental-overview', label: 'Overview' },
	{ href: '#icons', label: 'Icons' },
]

/** Окремий оглядовий екран без привʼязки до табів дашборду */
export function DesignSystemPage() {
	return (
		<main className="mx-auto min-h-0 max-w-6xl px-4 py-10 pb-20">
			<header className="mb-10 flex flex-col gap-4 border-b border-slate-700/70 pb-8 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-slate-100">Design System</h1>
					<p className="mt-2 max-w-xl text-sm text-slate-400">
						Style guide for the Sui LP &amp; Lending interface: design tokens, typography, reusable
						component patterns, and application rules.
					</p>
				</div>
				<Link
					to="/"
					className="shrink-0 text-sm font-medium text-sky-400/95 hover:text-sky-300"
				>
					← Back to home
				</Link>
			</header>

			<nav
				className="-mx-4 mb-10 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin"
				aria-label="On this page"
			>
				{navAnchors.map(({ href, label }) => (
					<a
						key={href}
						href={href}
						className="shrink-0 rounded-md border border-slate-700/80 bg-slate-900/70 px-2.5 py-1 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
					>
						{label}
					</a>
				))}
			</nav>

			<div className="space-y-14">
				<Section
					id="typography"
					title="Typography"
					lead="Main text and headings: Syne via `font-sans` (loaded from Google Fonts in index.html). Numbers and addresses: `font-mono` maps to the `--font-mono` token (JetBrains Mono + fallback stack)."
				>
					<div className="rounded-lg border border-slate-800 bg-slate-950/60 p-5">
						<div className="space-y-4">
							<div>
								<span className="text-[10px] uppercase tracking-wider text-slate-600">display / h1</span>
								<p className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">Sui LP &amp; Lending</p>
							</div>
							<div>
								<span className="text-[10px] uppercase tracking-wider text-slate-600">section / h2</span>
								<p className="mt-1 text-lg font-semibold tracking-tight text-slate-100">Section title</p>
							</div>
							<div>
								<span className="text-[10px] uppercase tracking-wider text-slate-600">body · text-sm</span>
								<p className="mt-1 text-sm leading-relaxed text-slate-300">
									Standard paragraph: legible contrast on `--color-app-bg`, relaxed line-height for longer
									tooltips and hints.
								</p>
							</div>
							<div>
								<span className="text-[10px] uppercase tracking-wider text-slate-600">label uppercase</span>
								<p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">Column label</p>
							</div>
							<div>
								<span className="text-[10px] uppercase tracking-wider text-slate-600">tabular mono</span>
								<p className="mt-1 font-mono text-xl tabular-money text-slate-100">
									$24,778.9100
								</p>
							</div>
							<div>
								<span className="text-[10px] uppercase tracking-wider text-slate-600">semantic · profit / loss</span>
								<p className="mt-1 text-sm font-mono">
									<span className="text-app-profit">+$222.59</span>
									{' · '}
									<span className="text-app-loss">−$124.11</span>
								</p>
							</div>
						</div>
					</div>
				</Section>

				<Section
					id="colors"
					title="Colours & Semantics"
					lead="Colour tokens live in @theme (`index.css`): --color-app-* (background / card / PnL) and `--color-chart-*` for charts. Tailwind slate/sky palette for small accents."
				>
					<div className="grid gap-6 lg:grid-cols-2">
						<div>
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">App tokens</h3>
							<div className="overflow-hidden rounded-lg border border-slate-800">
								<table className="w-full text-left text-xs">
									<tbody>
										<TokenRow
											name="App background"
											varName="--color-app-bg"
											sample={<span className="inline-block h-7 w-full max-w-[6rem] rounded border border-slate-700" style={{ background: 'var(--color-app-bg)' }} />}
											desc="Screen and table background (base cell colour)."
										/>
										<TokenRow
											name="Card surface"
											varName="--color-app-card"
											sample={<span className="inline-block h-7 w-full max-w-[6rem] rounded border border-slate-700" style={{ background: 'var(--color-app-card)' }} />}
											desc="Cards and sub-section panels (`bg-app-card`)."
										/>
										<TokenRow
											name="Border"
											varName="--color-app-border"
											sample={
												<span
													className="inline-block h-7 w-full max-w-[6rem] rounded border border-slate-700 bg-app-card"
													style={{ outline: '3px solid var(--color-app-border)', outlineOffset: '1px' }}
												/>
											}
											desc="Card borders and dividers; Tailwind utility `border-app-border`."
										/>
										<TokenRow
											name="Accent"
											varName="--color-app-accent"
											sample={<span className="font-mono text-sky-400" style={{ color: 'var(--color-app-accent)' }}>#0ea5e9</span>}
											desc="Link and primary-button accent (sky)."
										/>
										<TokenRow
											name="Profit / Loss / Warn"
											varName="--color-app-*"
											sample={
												<span className="font-mono">
													<span style={{ color: 'var(--color-app-profit)' }}>Δ+</span>
													{' '}
													<span style={{ color: 'var(--color-app-loss)' }}>Δ−</span>
													{' '}
													<span style={{ color: 'var(--color-app-warn)' }}>!</span>
												</span>
											}
											desc="P&amp;L colours; use `text-app-profit` / `text-app-loss` / `text-app-warn`."
										/>
									</tbody>
								</table>
							</div>
						</div>
						<div>
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Protocol colours (Badge)</h3>
							<ul className="flex flex-wrap gap-2">
								{Object.entries(PROTOCOL_COLORS).map(([k, hex]) => (
									<li key={k}>
										<Badge color={hex}>{k}</Badge>
									</li>
								))}
							</ul>
							<p className="mt-3 text-xs text-slate-500">
								<code className="text-slate-400">Badge</code> — semi-transparent background + border in the
								protocol brand colour (see component).
							</p>
							<h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">StatusBadge — semantic states</h3>
							<div className="flex flex-wrap gap-2">
								{(['in-range', 'out-of-range', 'warn', 'neutral', 'active', 'info'] as const).map((v) => (
									<StatusBadge key={v} variant={v}>{v}</StatusBadge>
								))}
							</div>
							<p className="mt-3 text-xs text-slate-500">
								<code className="text-slate-400">StatusBadge</code> maps semantic roles to design-token colours.
								Use instead of <code className="text-slate-400">Badge</code> for LP / balance / lending states.
							</p>
						</div>
					</div>
				</Section>

				<Section
					id="spacing"
					title="Spacing & Container"
					lead="Source — Tailwind spacing scale (4px base grid). Page content sits inside PageShell (max-w-content 1152px default, max-w-content-wide 1440px at ≥1600px viewport). Header gutters: px-4. Semantic gap tokens: gap-xs … gap-xl."
				>
					<div className="flex flex-wrap items-end gap-3">
						{[1, 2, 3, 4, 6, 8].map((s) => (
							<div key={s} className="text-center text-[10px] text-slate-500">
								<div
									className="mx-auto rounded-sm bg-sky-500/70"
									style={{ width: s * 4, height: s * 4 }}
								/>
								<div className="mt-1 font-mono">{s}</div>
							</div>
						))}
					</div>
					<p className="mt-4 text-xs text-slate-500">
						Vertical section spacing: <code className="text-slate-400">py-10</code>,{' '}
						<code className="text-slate-400">gap-3</code> in card grids,{' '}
						<code className="text-slate-400">mb-6</code> between summary strip and tables.
					</p>
					<div className="mt-5 rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-3">
						<p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">PageShell</p>
						<PageShell className="border border-slate-700/60 rounded py-2 text-center text-xs text-slate-400">
							<code className="text-slate-300">PageShell variant="default"</code> — max-w-content, px-4 md:px-6
						</PageShell>
					</div>
				</Section>

				<Section
					id="buttons"
					title="Buttons"
					lead="Two layers: low-level class strings from appPrimitives (legacy inline usage) and the Button component (preferred for new code). Both share the same control height / radius tokens. TabNav is a separate segmented control."
				>
					<p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Button component — variants &amp; sizes</p>
					<div className="flex flex-wrap gap-3">
						<Button variant="primary">Primary</Button>
						<Button variant="secondary">Secondary</Button>
						<Button variant="ghost">Ghost</Button>
						<Button variant="danger">Danger</Button>
						<Button variant="primary" size="compact">Compact</Button>
						<Button variant="secondary" disabled>Disabled</Button>
					</div>
					<p className="mt-3 text-xs text-slate-500">
						<code className="rounded bg-slate-800 px-1 text-slate-400">Button</code> accepts{' '}
						<code className="text-slate-400">variant</code> (primary | secondary | ghost | danger) and{' '}
						<code className="text-slate-400">size</code> (default 36px | compact 32px). All standard{' '}
						<code className="text-slate-400">button</code> HTML attributes pass through.
					</p>
					<p className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">appPrimitives class strings (legacy)</p>
					<div className="flex flex-wrap gap-4">
						<button type="button" className={appBtnPrimary}>
							appBtnPrimary
						</button>
						<button type="button" className={appBtnSecondary}>
							appBtnSecondary
						</button>
						<button type="button" className="text-xs text-slate-500 underline hover:text-slate-300">
							Ghost link
						</button>
						<button type="button" disabled className={appBtnPrimary + ' cursor-not-allowed opacity-45'}>
							Disabled
						</button>
					</div>
					<p className="mt-5 text-xs text-slate-500">
						Tabs (<code className="rounded bg-slate-800 px-1 text-slate-400">TabNav</code>):{' '}
						<span className="rounded-md border border-app-border bg-app-card/40 px-4 py-1.5 text-sm">
							Inactive
						</span>{' '}
						<span className="rounded-md bg-sky-600 px-4 py-1.5 text-sm text-white">Active</span>
					</p>
					<div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-3">
						<span className="rounded-lg border border-app-border bg-app-card/35 p-1 text-xs text-slate-400">
							<span className="rounded-md bg-sky-600 px-3 py-1 text-white">LP</span>
							<span className="px-3 py-1">Balance</span>
						</span>
						<div className={appHeaderActionCluster}>
							<button type="button" className={appBtnSecondaryCompact}>
								Refresh Data
							</button>
							<button type="button" className={appBtnSecondaryCompact}>
								Reload History
							</button>
							<button type="button" className={appBtnSecondaryCompact}>
								Clear Local Cache
							</button>
						</div>
						<span className="ml-auto text-xs text-slate-500">wallet →</span>
					</div>
					<p className="mt-2 text-xs text-slate-500">
						Header layout (wraps on narrow screens): title block → SUI/USDC quote → TabNav → action cluster → wallet.
					</p>
				</Section>

				<Section
					id="inputs"
					title="Inputs & Forms"
					lead="Inline addresses: monospace text, dark field, focus — sky ring/border (same as the Paste address form)."
				>
					<div className="max-w-md rounded-lg border border-slate-800 bg-slate-950/70 p-4">
						<label className="text-xs text-slate-500" htmlFor="ds-demo-input">
							Input label
						</label>
						<input
							id="ds-demo-input"
							type="text"
							readOnly
							placeholder="0x…"
							defaultValue="0xdaa462…"
							className="mt-2 w-full rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
						/>
						<p className="mt-2 text-xs text-red-400">Example error message</p>
					</div>
				</Section>

				<Section
					id="cards"
					title="Cards"
					lead="Standard: `AppCard` (`src/components/ui/AppCard.tsx`) or the `appCardSurface` class from `design/appPrimitives`. Inner panels: `bg-slate-950/50`, labels `uppercase text-slate-500`."
				>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						<DemoCardShell title="Summary card" subtitle={<span className="font-mono text-xl tabular-money text-slate-100">$1,234.56</span>} />
						<DemoCardShell
							title="With tooltip icon"
							extra={
								<p className="mt-1 flex flex-wrap items-center gap-1 font-mono text-lg text-slate-100">
									Value
									<TooltipIconButton tip="Metric tooltip hint" aria-label="Info" />
								</p>
							}
						/>
						<AppCard density="compact" className="opacity-95">
							<span className="text-[10px] uppercase text-slate-500">Sub-card / nested</span>
							<p className="mt-2 rounded-md border border-slate-800/90 bg-slate-950/50 p-3 text-xs text-slate-400">
								Inner block (rounded-xl separately for larger panels)
							</p>
						</AppCard>
					</div>
				</Section>

				<Section
					id="tables"
					title="Tables"
					lead="Head cells: `DataTableHeadCell` + `appTableHeadLabel`; sortable LP columns use `SortableColumnHead` in OpenPositionsTable (fixed `w-[1em]` arrow slot — transparent ↓ when inactive). Sort-key cycle: `openPositionsTableSort.ts` (desc → asc → reset). thead `<tr>` uses `appTableHeadRow` only. Wrapper: `appTableShell`; body: `bg-app-bg`, `group-hover:bg-app-row-hover`; sticky Pool column: `appTablePoolStickyTh` / `appTablePoolStickyTd`."
				>
					<div className={appTableShell}>
						<table className="min-w-[28rem] w-full border-collapse text-left text-xs sm:text-sm">
							<thead>
								<tr className={appTableHeadRow}>
									<DataTableHeadCell thClassName={appTablePoolStickyTh + ' py-2 pl-3 pr-2'} tip="Demo: first sticky column." tipAriaLabel="About Asset">
										<span className={appTableHeadLabel}>Asset</span>
									</DataTableHeadCell>
									<DataTableHeadCell thClassName={appTableHeadCellDefault} tip="Token quantity." tipAriaLabel="About Qty">
										<span className={appTableHeadLabel}>Qty</span>
									</DataTableHeadCell>
									<DataTableHeadCell thClassName={appTableHeadCellDefault} tip="Price in USD." tipAriaLabel="About USD">
										<button type="button" className={appTableHeadLabelSort} onClick={() => undefined}>
											Usd
										</button>
									</DataTableHeadCell>
								</tr>
							</thead>
							<tbody>
								<tr className="group cursor-pointer border-b border-slate-800/80">
									<td className={appTablePoolStickyTd + ' px-3 py-2'}>SUI</td>
									<td className={appTableTd + ' px-3 py-2 text-center font-mono'}>1.25</td>
									<td className={appTableTd + ' px-3 py-2 text-center font-mono'}>$3.20</td>
								</tr>
								<tr className="group cursor-pointer border-b border-slate-800/80">
									<td className={appTablePoolStickyTd + ' px-3 py-2'}>USDC</td>
									<td className={appTableTd + ' px-3 py-2 text-center font-mono'}>450</td>
									<td className={appTableTd + ' px-3 py-2 text-center font-mono'}>450.00</td>
								</tr>
							</tbody>
						</table>
					</div>
					<p className="mt-4 text-xs text-slate-500">
						Overlapping token icon pair in Pool column: use{' '}
						<code className="rounded bg-slate-900 px-1 font-mono text-[10px] text-slate-400">appTableTokenOverlapRing</code> from{' '}
						<code className="rounded bg-slate-900 px-1 font-mono text-[10px] text-slate-400">appPrimitives.ts</code>.
					</p>
				</Section>

				<Section
					id="states"
					title="States"
					lead="Loading: Spinner (rotating sky border). Disabled: opacity + cursor-not-allowed. Tooltip: fixed portal panel (see Tooltip.tsx). Full-section states: EmptyState / ErrorState / LoadingState components."
				>
					<div className="flex flex-wrap items-center gap-6">
						<div className="flex items-center gap-2 text-sm text-slate-400">
							<Spinner className="h-4 w-4" /> Loading…
						</div>
						<button type="button" className={`${appBtnPrimary} cursor-wait opacity-70`}>
							busy...
						</button>
						<button type="button" className={appBtnPrimary + ' opacity-35'} disabled>
							unavailable
						</button>
					</div>

					<p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">
						EmptyState, ErrorState, LoadingState
					</p>
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="rounded-lg border border-slate-800 bg-slate-950/60">
							<EmptyState
								title="No open positions"
								description="Connect a wallet and add liquidity to see your LP positions here."
							/>
						</div>
						<div className="rounded-lg border border-slate-800 bg-slate-950/60">
							<ErrorState
								title="Failed to load positions"
								detail="Network error: request timed out."
								onRetry={() => undefined}
							/>
						</div>
						<div className="rounded-lg border border-slate-800 bg-slate-950/60">
							<LoadingState message="Loading positions…" />
						</div>
					</div>
					<p className="mt-3 text-xs text-slate-500">
						Use these components for full-section states — not ad-hoc inline spinners or text.{' '}
						<code className="text-slate-400">ErrorState</code> with <code className="text-slate-400">onRetry</code>{' '}
						renders a "Try Again" button. <code className="text-slate-400">EmptyState</code> accepts an optional{' '}
						<code className="text-slate-400">action</code> slot for a CTA.
					</p>

					<p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">
						LP lifecycle · Empty position
					</p>
					<div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-semibold text-slate-100">SUI/USDC</span>
							<span
								className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/95"
								title="Position NFT still owned; principal liquidity is zero."
							>
								Empty
							</span>
							<span className="rounded-md bg-slate-700/95 px-1.5 py-0.5 text-[10px] font-medium text-white/95">
								0.25%
							</span>
						</div>
						<p className="mt-2 text-xs leading-relaxed text-slate-400">
							<strong className="font-medium text-slate-300">Active</strong> — liquidity &gt; 0.{' '}
							<strong className="font-medium text-amber-200/90">Empty</strong> — owned NFT, confirmed raw
							liquidity = 0; fees/rewards may remain; Manage still offers Add / Collect / Close. APR is not
							shown on Empty.{' '}
							<strong className="font-medium text-slate-300">Unknown</strong> — missing or malformed
							liquidity / mark / history (never coerced to $0 or Empty).{' '}
							<strong className="font-medium text-sky-200/90">Partial</strong> — incomplete aggregate or
							valuation shows a muted superscript * beside the amount (not in the label). Hover, focus,
							or tap the mark for the tip. Fully unknown totals use — (never $0).{' '}
							<strong className="font-medium text-slate-300">Closed</strong> — object burned (confirmed
							close event only). Missing RPC data never implies Closed. Empty rows stay on the open
							Positions list — never duplicated under Closed. Cascade Watching shows coverage (e.g.{' '}
							<code className="text-slate-400">Watching 2/4</code>), not the first member alone.
						</p>
						<div className="mt-3 flex flex-wrap items-baseline gap-6 font-mono text-sm text-slate-100">
							<span>
								<span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
									Complete
								</span>
								$1,234.56
							</span>
							<span>
								<span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
									Partial
								</span>
								<MetricValueWithPartial
									value="$1,234.56"
									partial
									coverage={{ covered: 3, eligible: 4 }}
								/>
							</span>
							<span>
								<span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
									Unknown
								</span>
								—
							</span>
						</div>
						<ul className="mt-3 space-y-1 text-xs text-slate-500">
							<li>Withdraw All Liquidity → position stays open and empty. Close → permanently closed.</li>
							<li>Add Liquidity deposits into the same position; range unchanged.</li>
							<li>
								Bluefin Spot matches Cetus CLMM manage: Add, Withdraw Partial/All (principal-only),
								Collect Fees &amp; Rewards, Close — Active and Empty. Cascade Manage uses the shared
								batch drawer.
							</li>
						</ul>
					</div>

					<p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">
						Protocol capability · Manage
					</p>
					<div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
						<table className="w-full min-w-[32rem] border-collapse text-left">
							<thead>
								<tr className="border-b border-slate-700 text-slate-300">
									<th className="py-1.5 pr-3 font-medium">Action</th>
									<th className="py-1.5 pr-3 font-medium">Cetus CLMM</th>
									<th className="py-1.5 font-medium">Bluefin Spot</th>
								</tr>
							</thead>
							<tbody className="align-top">
								<tr className="border-b border-slate-800/80">
									<td className="py-1.5 pr-3 text-slate-200">Add Liquidity</td>
									<td className="py-1.5 pr-3">Existing NFT · range unchanged</td>
									<td className="py-1.5">Same · gateway provide_liquidity_with_fixed_amount</td>
								</tr>
								<tr className="border-b border-slate-800/80">
									<td className="py-1.5 pr-3 text-slate-200">Withdraw Partial / All</td>
									<td className="py-1.5 pr-3">Principal-only · fees until Collect</td>
									<td className="py-1.5">
										Principal-only · direct gateway::remove_liquidity (not SDK remove helper)
									</td>
								</tr>
								<tr className="border-b border-slate-800/80">
									<td className="py-1.5 pr-3 text-slate-200">Collect Fees &amp; Rewards</td>
									<td className="py-1.5 pr-3">Active + Empty</td>
									<td className="py-1.5">Active + Empty · collect_fee + collect_reward</td>
								</tr>
								<tr className="border-b border-slate-800/80">
									<td className="py-1.5 pr-3 text-slate-200">Close Position</td>
									<td className="py-1.5 pr-3">Liquidity + fees/rewards + burn</td>
									<td className="py-1.5">Same · rewards then gateway::close_position</td>
								</tr>
								<tr>
									<td className="py-1.5 pr-3 text-slate-200">Auto Withdraw</td>
									<td className="py-1.5 pr-3">Watching · Review · wallet Accept</td>
									<td className="py-1.5">Same principal-only path · no unattended execution</td>
								</tr>
							</tbody>
						</table>
					</div>

					<p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">
						Build · Constructor
					</p>
					<div className="grid max-w-3xl gap-3 sm:grid-cols-2">
						<div className="rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-xs text-slate-300">
							<p className="font-medium text-slate-100">Field states</p>
							<ul className="mt-2 space-y-1">
								<li>
									<span className="text-sky-400">Ready</span> — Preview Transactions enabled
								</li>
								<li>
									<span className="text-amber-400">Draft</span> — editable; one short field-error + reason
									beside the primary button
								</li>
								<li>
									<span className="text-rose-400">Error / not enough</span> — no duplicate amber stacks;
									no HARD_MAX / one-sided jargon
								</li>
								<li>
									<span className="text-slate-400">Stale / Update failed</span> — never show an old
									timestamp as live price
								</li>
							</ul>
						</div>
						<div className="rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-xs text-slate-300">
							<p className="font-medium text-slate-100">Layout &amp; chart</p>
							<ul className="mt-2 space-y-1">
								<li>Compact top: Protocol · Direction · Position type · Pool (pair/protocol/fee)</li>
								<li>Params left · chart right; Single chart ~240–300px; Cascade scales with LP count</li>
								<li>Min/Max price side-by-side; Spot/Limit leader lines when labels are close</li>
								<li>Summary: Deposit · Estimated after full conversion · Average; LP/overlap only for Cascade</li>
								<li>Numbers: unambiguous decimals (0,895 → 0.895; reject bare 1,500)</li>
							</ul>
						</div>
					</div>
					<p className="mt-2 max-w-xl text-xs text-slate-500">
						Production Build: navy/slate/sky + Syne. Advanced holds geometry, tick/bin counts, DLMM shape.
						Pool APR / TVL / volume live in Details or tooltip — not the selector label.
					</p>

					<p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">
						Action panel · Preview
					</p>
					<div className="max-w-sm rounded-lg border border-slate-700 bg-slate-950/80 p-3">
						<div className="flex items-center justify-between gap-2">
							<h3 className="text-sm font-semibold text-slate-100">Add Liquidity</h3>
							<span className="text-[11px] text-slate-500">Close Panel</span>
						</div>
						<p className="mt-1 text-xs text-slate-400">SUI/USDC · Cetus · 0x6ddd…a382</p>
						<p className="mt-2 text-xs text-slate-300">Enter amount in: SUI / USDC</p>
						<p className="mt-2 text-[11px] font-medium text-slate-200">You Deposit</p>
						<ul className="mt-1 space-y-0.5 text-sm text-slate-100">
							<li className="flex justify-between font-mono">
								<span className="font-sans text-slate-300">SUI</span>
								<span>−12.5</span>
							</li>
							<li className="flex justify-between font-mono">
								<span className="font-sans text-slate-300">USDC</span>
								<span>−18.2</span>
							</li>
						</ul>
						<p className="mt-2 text-[11px] font-medium text-slate-200">Estimated Network Fee</p>
						<p className="font-mono text-sm text-slate-100">≈ 0.0042 SUI</p>
						<p className="mt-2 text-xs text-slate-400">Range stays unchanged. Fees stay until Collect.</p>
						<p className="mt-3 rounded-md bg-sky-600/90 px-2 py-1.5 text-center text-xs font-medium text-white">
							Review Add Liquidity
						</p>
					</div>
					<p className="mt-2 max-w-xl text-xs text-slate-500">
						Production drawer: real token symbols (not Token A/B), Expected to Receive / Remaining /
						Network Fee, short consequence, Details collapsed. AW Accept: one wallet tip, no vault copy.
					</p>

					<p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">
						Manage · Cascade
					</p>
					<div className="max-w-xs rounded-lg border border-slate-700 bg-slate-950/80 p-2">
						<p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
							SUI/USDC · Cetus · Cascade · 4
						</p>
						<p className="px-2 pb-2 text-xs text-slate-300">Applies to all 4 positions in this cascade.</p>
						<ul className="space-y-0 text-sm font-medium text-slate-100">
							<li className="rounded px-2 py-2 hover:bg-slate-800">Withdraw All Liquidity</li>
							<li className="rounded px-2 py-2 hover:bg-slate-800">Collect Fees &amp; Rewards</li>
							<li className="rounded px-2 py-2 hover:bg-slate-800">Close Position</li>
						</ul>
					</div>
					<p className="mt-2 max-w-xl text-xs text-slate-500">
						Cascade header Manage uses confirmed group members (digest / positionIds). Review runs one
						transaction per eligible LP (sequential signatures). Skips: Already empty, Close unavailable.
						No Add / Partial / Watching in the group menu.
					</p>

					<p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">
						Manage · Watching
					</p>
					<div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
						<div className="flex max-w-xs flex-col gap-1.5 rounded-lg border border-slate-700 bg-slate-950/80 p-2">
							<div className="flex items-center justify-between gap-2">
								<span className="inline-flex items-center gap-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
									Watching
									<TooltipIconButton
										tip="Monitoring only. You approve each withdrawal in your wallet; submission follows automatically. After withdrawal the position stays open and empty."
										aria-label="About Watching"
									/>
								</span>
								<span
									className="inline-block h-4 w-7 rounded-full bg-sky-600"
									aria-hidden
									title="Switch on"
								/>
							</div>
							<p className="text-xs text-slate-300">Below range → SUI</p>
							<p className="text-[11px] font-medium text-sky-200/90">
								Watching · <span className="font-normal text-slate-500">Checked 14:32</span>
							</p>
						</div>
						<div className="mt-3 flex flex-wrap items-center gap-2">
							{(
								[
									'Waiting for First Check',
									'Watching',
									'Ready for Approval',
									'Check Failed',
									'Paused · Direction Required',
									'Completed',
									'Not synced · Monitoring inactive',
								] as const
							).map((label) => (
								<span
									key={label}
									className="rounded-md border border-sky-500/35 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-sky-200/95"
									title={label}
								>
									{label}
								</span>
							))}
						</div>
						<p className="mt-3 text-xs leading-relaxed text-slate-400">
							Manage actions show short labels only; details live in{' '}
							<code className="text-slate-400">TooltipIconButton</code>. Watching is compact: switch,
							direction, one status + check time, Review when relevant. Service Unavailable appears only
							when the bot is down. Trigger radios appear only when direction must be chosen.
						</p>
						<ul className="mt-3 space-y-1 text-xs text-slate-500">
							<li>Manage ▾ → action titles + (i) tips; Watching switch + direction line.</li>
							<li>Ambiguous history → Trigger: Below range → SUI / Above range → USDC.</li>
							<li>Already met → “Condition already met.” → Enable Watching.</li>
							<li>Close-locked Cetus → visible “Close unavailable”; full reason in tooltip.</li>
						</ul>
					</div>
				</Section>

				<Section
					id="experimental-overview"
					title="Overview"
					lead="App home (/) under .overview-lab: live Net Worth + PortfolioChart history, KPI column with 24h/7d/30d Value Change and Range Status. Aurora stays experimental. Analytics tab removed — /analytics redirects here. Shared math: analyzeValueChangeForRange / snapshotCompleteness."
				>
					<div className="space-y-4 text-sm text-slate-400">
						<p>
							Link:{' '}
							<Link to="/" className="font-medium text-sky-400 hover:text-sky-300">
								/
							</Link>{' '}
							· sync status in app header · Hide amounts on Overview · Refresh Data in header.
							Balance/LP/Lending under <code className="text-slate-300">/home</code>.
						</p>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							<div className={`${appCardSurface} space-y-2 p-4`}>
								<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
									Layout
								</p>
								<ul className="list-disc space-y-1 pl-4 text-xs">
									<li>
										<code className="text-slate-300">.overview-lab__hero-row</code> — Net Worth +
										chart left; KPI → Value Change → Range right (stretch tops/bottoms)
									</li>
									<li>
										<code className="text-slate-300">PortfolioChart</code> — Total / Components,
										Reset View, latest freshness, Limited history ≠ stale
									</li>
									<li>Value Change cards independent of chart range</li>
									<li>Live allocation bar ≠ snapshot breakdown</li>
								</ul>
							</div>
							<div className={`${appCardSurface} space-y-2 p-4`}>
								<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
									Colours / chart
								</p>
								<ul className="list-disc space-y-1 pl-4 text-xs">
									<li>
										Total / LP <span className="text-sky-400">sky-400</span> · Wallet{' '}
										<span className="text-orange-400">orange-400</span> · Net Lending{' '}
										<span className="text-emerald-400">emerald-400</span>
									</li>
									<li>Value Change — never Profit / Return</li>
									<li>Legacy endpoints surface as unverified</li>
									<li>Hide amounts covers axis, crosshair, tooltip, cards</li>
								</ul>
							</div>
							<div className={`${appCardSurface} space-y-2 p-4`}>
								<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
									History policy
								</p>
								<ul className="list-disc space-y-1 pl-4 text-xs">
									<li>
										One reader: <code className="text-slate-300">usePortfolioHistory</code> on
										Overview; writer once in AppLayout
									</li>
									<li>
										<code className="text-slate-300">incomplete</code> flag; complete bucket never
										overwritten by partial
									</li>
									<li>Unknown ≠ zero; legacy usable for continuity</li>
									<li>Legacy activeTab=analytics → Overview redirect</li>
								</ul>
							</div>
						</div>
					</div>
				</Section>

				<Section
					id="icons"
					title="Icons"
					lead="Protocol icons: SVG via ProtocolIcon by protocol slug. Token address icons: separate TokenIconOkx / TokenIcon pipeline. Colour follows the protocol brand colour."
				>
					<ul className="flex flex-wrap items-center gap-4">
						{(['bluefin', 'cetus', 'momentum'] as const).map((p) => (
							<li key={p} className="flex items-center gap-2 text-xs text-slate-400">
								<ProtocolIcon protocol={p} size={22} /> {p}
							</li>
						))}
					</ul>
				</Section>
			</div>

			<footer className="mt-16 border-t border-slate-800 pt-6 text-center text-xs text-slate-600">
				Rule: new patterns start as tokens in{' '}
				<code className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-400">src/index.css</code> or class strings in{' '}
				<code className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-400">src/design/appPrimitives.ts</code>, then a component or screen;
				update this guide in the same task.
			</footer>
		</main>
	)
}
