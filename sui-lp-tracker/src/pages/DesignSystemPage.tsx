import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PROTOCOL_COLORS } from '@/utils/constants'
import { connectBtnClass } from '@/components/auth/WalletConnect'
import { AppCard } from '@/components/ui/AppCard'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { DataTableHeadCell } from '@/components/ui/DataTableHeadCell'
import {
	appCardSurface,
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
	{ href: '#colors', label: 'Кольори' },
	{ href: '#spacing', label: 'Spacing' },
	{ href: '#buttons', label: 'Кнопки' },
	{ href: '#inputs', label: 'Inputs' },
	{ href: '#cards', label: 'Cards' },
	{ href: '#tables', label: 'Таблиці' },
	{ href: '#states', label: 'Стани' },
	{ href: '#icons', label: 'Іконки' },
]

/** Окремий оглядовий екран без привʼязки до табів дашборду */
export function DesignSystemPage() {
	return (
		<main className="mx-auto min-h-0 max-w-6xl px-4 py-10 pb-20">
			<header className="mb-10 flex flex-col gap-4 border-b border-slate-700/70 pb-8 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-slate-100">Design System</h1>
					<p className="mt-2 max-w-xl text-sm text-slate-400">
						Style guide для інтерфейсу Sui LP &amp; Lending: токени, типографіка, повторні патерни
						компонентів та правила застосування.
					</p>
				</div>
				<Link
					to="/"
					className="shrink-0 text-sm font-medium text-sky-400/95 hover:text-sky-300"
				>
					← На головну
				</Link>
			</header>

			<nav
				className="-mx-4 mb-10 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin"
				aria-label="На сторінці"
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
					lead="Основний текст і заголовки — Syne через `font-sans` (підключено в index.html з Google Fonts). Числові суми й адреси: клас `font-mono` збігається з токеном `--font-mono` (JetBrains Mono + резерв)."
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
									Стандартний абзац: читабельний контраст на тлі `--color-app-bg`, міжрядяння relaxed для довших
									tooltip і підказок.
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
					title="Colours & семантика"
					lead="Частина кольорів у @theme (`index.css`): --color-app-* (фон/картка/PnL) та `--color-chart-*` для графіків. Також палітра Tailwind slate/sky для дрібних акцентів."
				>
					<div className="grid gap-6 lg:grid-cols-2">
						<div>
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Токени програми</h3>
							<div className="overflow-hidden rounded-lg border border-slate-800">
								<table className="w-full text-left text-xs">
									<tbody>
										<TokenRow
											name="App background"
											varName="--color-app-bg"
											sample={<span className="inline-block h-7 w-full max-w-[6rem] rounded border border-slate-700" style={{ background: 'var(--color-app-bg)' }} />}
											desc="Фон екранів і таблиць (наприклад базовий колір комірок)."
										/>
										<TokenRow
											name="Card surface"
											varName="--color-app-card"
											sample={<span className="inline-block h-7 w-full max-w-[6rem] rounded border border-slate-700" style={{ background: 'var(--color-app-card)' }} />}
											desc="Картки та панелі сабсекцій (`bg-app-card`)."
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
											desc="Рамки карток, розділювачі; у Tailwind утиліта `border-app-border`."
										/>
										<TokenRow
											name="Accent"
											varName="--color-app-accent"
											sample={<span className="font-mono text-sky-400" style={{ color: 'var(--color-app-accent)' }}>#0ea5e9</span>}
											desc="Акцент посилань та primary‑кнопок (sky)."
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
											desc="P&amp;L; для класів використовуй `text-app-profit` / `text-app-loss` / `text-app-warn`."
										/>
									</tbody>
								</table>
							</div>
						</div>
						<div>
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Протоколи (Badge)</h3>
							<ul className="flex flex-wrap gap-2">
								{Object.entries(PROTOCOL_COLORS).map(([k, hex]) => (
									<li key={k}>
										<Badge color={hex}>{k}</Badge>
									</li>
								))}
							</ul>
							<p className="mt-3 text-xs text-slate-500">
								<code className="text-slate-400">Badge</code> — напівпрозорий фон + бордер кольором протоколу
								(див. компонент).
							</p>
						</div>
					</div>
				</Section>

				<Section
					id="spacing"
					title="Spacing & контейнер"
					lead="Джерело — Tailwind spacing scale (4px базова сітка). Контент сторінок у межах max-w-6xl, горизонтальні відступи px-4 у хедері та основній колонці."
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
						Vертикальні блоки між секціями: зазвичай <code className="text-slate-400">py-10</code>,{' '}
						<code className="text-slate-400">gap-3</code> у сітках карток,{' '}
						<code className="text-slate-400">mb-6</code> між зведенням та таблицями.
					</p>
				</Section>

				<Section
					id="buttons"
					title="Buttons"
					lead="Primary CTA — sky; вторинні текстові лінки — underline slate. Перемикачі табів — окремий патерн (pill + active sky)."
				>
					<div className="flex flex-wrap gap-4">
						<button type="button" className={connectBtnClass}>
							Primary (connectBtnClass)
						</button>
						<button
							type="button"
							className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
						>
							Secondary outline
						</button>
						<button type="button" className="text-xs text-slate-500 underline hover:text-slate-300">
							Ghost link
						</button>
						<button type="button" disabled className={connectBtnClass + ' cursor-not-allowed opacity-45'}>
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
				</Section>

				<Section
					id="inputs"
					title="Inputs & форми"
					lead="Інлайн адреси: моноширинний текст, темний філд, фокус — sky ring/border як у форми Paste address."
				>
					<div className="max-w-md rounded-lg border border-slate-800 bg-slate-950/70 p-4">
						<label className="text-xs text-slate-500" htmlFor="ds-demo-input">
							Мітка поля
						</label>
						<input
							id="ds-demo-input"
							type="text"
							readOnly
							placeholder="0x…"
							defaultValue="0xdaa462…"
							className="mt-2 w-full rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
						/>
						<p className="mt-2 text-xs text-red-400">Приклад повідомлення про помилку</p>
					</div>
				</Section>

				<Section
					id="cards"
					title="Cards"
					lead="Стандарт: `AppCard` (`src/components/ui/AppCard.tsx`) або клас `appCardSurface` з `design/appPrimitives`. Внутрішні плашки: `bg-slate-950/50`, мітки `uppercase text-slate-500`."
				>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						<DemoCardShell title="Summary card" subtitle={<span className="font-mono text-xl tabular-money text-slate-100">$1,234.56</span>} />
						<DemoCardShell
							title="With tooltip icon"
							extra={
								<p className="mt-1 flex flex-wrap items-center gap-1 font-mono text-lg text-slate-100">
									Value
									<TooltipIconButton tip="Підказка до метрики" aria-label="Info" />
								</p>
							}
						/>
						<AppCard density="compact" className="opacity-95">
							<span className="text-[10px] uppercase text-slate-500">Sub-card / nested</span>
							<p className="mt-2 rounded-md border border-slate-800/90 bg-slate-950/50 p-3 text-xs text-slate-400">
								Inner block (rounded-xl інколи окремо для великих панелей)
							</p>
						</AppCard>
					</div>
				</Section>

				<Section
					id="tables"
					title="Tables"
					lead="Контент: `DataTableHeadCell` + `appTableHeadLabel`; сортовані колонки LP — кнопка `SortableColumnHead` у `OpenPositionsTable` (фіксований слот `w-[1em]` під стрілку, коли не активна — transparent `↓`). Логіка ключів сортування: `openPositionsTableSort.ts` (цикл desc → asc → скинути). На `<tr>` у thead — лише `appTableHeadRow`. Далі: `appTableShell`; тіло: `bg-app-bg`, `group-hover:bg-app-row-hover`; sticky Pool — `appTablePoolStickyTh` / `appTablePoolStickyTd`."
				>
					<div className={appTableShell}>
						<table className="min-w-[28rem] w-full border-collapse text-left text-xs sm:text-sm">
							<thead>
								<tr className={appTableHeadRow}>
									<DataTableHeadCell thClassName={appTablePoolStickyTh + ' py-2 pl-3 pr-2'} tip="Демо: перша колонка (sticky)." tipAriaLabel="About Asset">
										<span className={appTableHeadLabel}>Asset</span>
									</DataTableHeadCell>
									<DataTableHeadCell thClassName={appTableHeadCellDefault} tip="Кількість токена." tipAriaLabel="About Qty">
										<span className={appTableHeadLabel}>Qty</span>
									</DataTableHeadCell>
									<DataTableHeadCell thClassName={appTableHeadCellDefault} tip="Ціна в USD." tipAriaLabel="About USD">
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
						Подвійні іконки токена в Pool: використовуй <code className="rounded bg-slate-900 px-1 font-mono text-[10px] text-slate-400">appTableTokenOverlapRing</code> із{' '}
						<code className="rounded bg-slate-900 px-1 font-mono text-[10px] text-slate-400">appPrimitives.ts</code>.
					</p>
				</Section>

				<Section
					id="states"
					title="States"
					lead="Завантаження — Spinner (обертання border sky). Відключено — opacity та cursor-not-allowed. Tooltip — fixed panel через portal (див. Tooltip.tsx)."
				>
					<div className="flex flex-wrap items-center gap-6">
						<div className="flex items-center gap-2 text-sm text-slate-400">
							<Spinner className="h-4 w-4" /> Loading…
						</div>
						<button type="button" className={`${connectBtnClass} cursor-wait opacity-70`}>
							busy...
						</button>
						<button type="button" className={connectBtnClass + ' opacity-35'} disabled>
							unavailable
						</button>
					</div>
				</Section>

				<Section
					id="icons"
					title="Icons"
					lead="Іконки протоколів — SVG у ProtocolIcon за slug токена; для адрес токена — окремий TokenIcon pipeline. Колір задається з брендових кольорів протоколу."
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
				Правило: нові патерни спочатку — токени в{' '}
				<code className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-400">src/index.css</code> або класи в{' '}
				<code className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-400">src/design/appPrimitives.ts</code>, потім компонент або екран;
				гайд оновлюй у тій самій задачі.
			</footer>
		</main>
	)
}
