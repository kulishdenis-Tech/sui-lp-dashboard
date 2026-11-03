/**
 * Shared design-system class strings.
 * Design tokens are defined in `src/index.css` (@theme).
 * New screens: prefer AppCard / these constants over raw hex values or ad-hoc classes.
 *
 * Typography roles (text-* + leading-* utility pairs generated from @theme):
 *   text-page-title   / leading-page-title   – 24/32px
 *   text-section      / leading-section      – 18/24px
 *   text-body         / leading-body         – 14/20px
 *   text-label        / leading-label        – 12/16px
 *   text-micro        / leading-micro        – 11/16px
 *   text-summary-value / leading-summary-value – 24/32px mono
 *   text-kpi          / leading-kpi          – 20/28px mono
 *
 * Spacing roles (gap-* utility variants):
 *   gap-gap-xs / gap-gap-sm / gap-gap-md / gap-gap-base / gap-gap-lg / gap-gap-xl
 *   (4 / 8 / 12 / 16 / 24 / 32 px)
 *
 * Radius tokens:
 *   rounded-control (8px) / rounded-overlay (12px)
 *
 * Control heights:
 *   h-control (36px) / h-control-compact (32px)
 *
 * Content widths:
 *   max-w-content (1152px) / max-w-content-wide (1440px, use with ≥1600px breakpoint)
 *
 * Z-index layers:
 *   z-header (40) / z-drawer (60) / z-menu (80) / z-tooltip (100)
 */

// ─── Surfaces ────────────────────────────────────────────────────────────────

/** Scrollable table wrapper: background + border + overflow clip */
export const appTableShell =
	'overflow-x-auto rounded-lg border border-slate-800 bg-app-bg'

/** Card surface: border + card background */
export const appCardSurface =
	'rounded-lg border border-app-border bg-app-card'

/** Floating header: semi-transparent backdrop above content */
export const appHeaderSurface =
	'sticky top-0 z-30 border-b border-app-border bg-app-bg'

// ─── Button primitives ────────────────────────────────────────────────────────
// Use the Button component in src/components/ui/Button.tsx for new surfaces.
// These class strings remain for legacy call-sites (Header actions, etc.).

/** Primary CTA (Connect, Refresh) – sky fill, default 36px height */
export const appBtnPrimary =
	'rounded-control h-control inline-flex items-center bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500'

/** Secondary outline – same rhythm as primary, for Force Rescan / Clear Cache */
export const appBtnSecondary =
	'rounded-control h-control inline-flex items-center border border-slate-600 bg-slate-800/70 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700 hover:text-white'

/** Ghost – no background, for icon-only or low-emphasis actions */
export const appBtnGhost =
	'rounded-control h-control inline-flex items-center px-3 text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200'

/** Danger – destructive actions */
export const appBtnDanger =
	'rounded-control h-control inline-flex items-center bg-red-600/20 border border-red-500/40 px-4 text-sm font-medium text-red-400 transition hover:bg-red-600/30 hover:text-red-300'

/** Compact variant modifier – 32px height for toolbar / table actions */
export const appBtnCompact = 'h-control-compact px-2.5 text-xs'

/** Disabled modifier – apply alongside any button class */
export const appBtnDisabled = 'disabled:cursor-not-allowed disabled:opacity-50'

// ─── Header layout helpers ────────────────────────────────────────────────────

/**
 * Separator between TabNav and action cluster.
 * Mobile: horizontal line; desktop: vertical divider.
 */
export const appHeaderToolbarSep =
	'h-px w-full shrink-0 bg-slate-700/80 sm:h-7 sm:w-px sm:self-center'

/** Row of portfolio action buttons next to tabs */
export const appHeaderActionCluster = 'flex flex-nowrap items-center gap-1.5'

/**
 * Shared header control chrome — one height (32px), radius, type for tabs, actions, chips.
 * Keeps TabNav, Refresh cluster, price pill, and wallet chips visually aligned.
 */
export const appHeaderControlShell =
	'inline-flex h-control-compact items-center gap-0.5 rounded-control border border-app-border bg-app-card/40 p-0.5'

export const appHeaderSegIdle =
	'inline-flex h-full items-center justify-center rounded-[6px] px-2.5 text-xs font-medium text-slate-400 transition hover:bg-slate-800/80 hover:text-slate-200'

export const appHeaderSegActive =
	'inline-flex h-full items-center justify-center rounded-[6px] bg-sky-600 px-2.5 text-xs font-medium text-white transition'

export const appHeaderSegAction =
	'inline-flex h-full items-center justify-center rounded-[6px] px-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

/** Standalone compact chip (price / status) — same outer height as control shell */
export const appHeaderChip =
	'inline-flex h-control-compact shrink-0 items-center gap-1.5 rounded-control border border-app-border bg-app-card/40 px-2.5 text-xs font-medium text-slate-200'

export const appHeaderChipStatus =
	'inline-flex h-control-compact shrink-0 items-center rounded-control border border-violet-500/40 bg-violet-950/50 px-2.5 text-xs font-medium text-violet-200'

export const appHeaderChipGhost =
	'inline-flex h-control-compact shrink-0 items-center rounded-control px-2 text-xs font-medium text-slate-400 transition hover:bg-slate-800/80 hover:text-slate-200'

/** Compact secondary variant for header – fits in a single line with TabNav + wallet */
export const appBtnSecondaryCompact =
	'rounded-control h-control-compact inline-flex items-center border border-app-border bg-app-card/40 px-2.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800/80 hover:text-white'

// ─── Typography role helpers ──────────────────────────────────────────────────

/** Page title – 24/32px, Syne */
export const appTextPageTitle =
	'text-page-title leading-page-title font-semibold text-slate-100'

/** Section / drawer title – 18/24px */
export const appTextSection =
	'text-section leading-section font-semibold text-slate-100'

/** Body text – 14/20px (default for prose, descriptions, buttons) */
export const appTextBody = 'text-body leading-body text-app-fg'

/** Muted body text – for secondary descriptions */
export const appTextBodyMuted = 'text-body leading-body text-slate-400'

/**
 * Label / table heading / required field label – 12/16px.
 * Contrast raised from slate-500 to slate-400 (≥4.5:1 on app-card background).
 */
export const appTextLabel =
	'text-label leading-label font-medium uppercase tracking-wide text-slate-400'

/**
 * Required / primary label – same size, higher contrast for essential field labels.
 * Use when the label denotes a mandatory input or primary categorisation.
 */
export const appTextLabelRequired =
	'text-label leading-label font-medium uppercase tracking-wide text-slate-300'

/** Micro badge / non-critical context – 11/16px */
export const appTextMicro = 'text-micro leading-micro text-slate-400'

/** Large summary value – 24/32px mono tabular (portfolio total, large KPIs) */
export const appTextSummaryValue =
	'text-summary-value leading-summary-value font-mono tabular-money text-slate-100'

/** Section KPI value – 20/28px mono (LP / Lending / Analytics) */
export const appTextKpi =
	'text-kpi leading-kpi font-mono tabular-money text-slate-100'

// ─── Table primitives ─────────────────────────────────────────────────────────

/**
 * Left "Pool" column (sticky): heading and cell share the same background.
 */
export const appTablePoolStickyTh =
	'sticky left-0 z-10 min-w-[12.5rem] max-w-[13.5rem] w-[13.5rem] align-middle bg-app-bg py-2 pr-2 text-left'

export const appTablePoolStickyTd =
	'sticky left-0 z-10 min-w-[12.5rem] max-w-[13.5rem] w-[13.5rem] align-middle bg-app-bg py-2 pr-2 transition-colors group-hover:bg-app-row-hover'

/** Standard body cell: scene background + row highlight on group-hover (non-sticky) */
export const appTableTd =
	'bg-app-bg py-2 pr-1.5 align-middle transition-colors group-hover:bg-app-row-hover'

export const appTableTdRightMono =
	`${appTableTd} text-right font-mono text-slate-100`.trim()

export const appTableTdWideUnclaimed =
	'max-w-[7.25rem] whitespace-nowrap bg-app-bg py-2 pr-1 text-right align-middle font-mono text-slate-200 transition-colors group-hover:bg-app-row-hover'

export const appTableTdRangeCell =
	'min-w-[10.25rem] max-w-none bg-app-bg py-2 pl-1 pr-0.5 align-middle transition-colors group-hover:bg-app-row-hover sm:min-w-[11rem]'

/** Overlapping token icons: ring matches table background; adapts on row hover */
export const appTableTokenOverlapRing =
	'rounded-full ring-2 ring-app-bg group-hover:ring-app-row-hover'

// ─── Table column heading primitives ─────────────────────────────────────────
// Text + gap-0.5 + TooltipIconButton.
// Do NOT apply text-xs / colour to <tr> — those live in appTableHeadLabel on the label span.

/**
 * Column heading label – matches Balance token table: text-xs, no uppercase, slate-500.
 * Use inside a th (wrapped by appTableHeadCellInner / DataTableHeadCell).
 */
export const appTableHeadLabel =
	'text-xs font-normal text-slate-500'

/** Sortable column heading: same text metrics + hover without button chrome */
export const appTableHeadLabelSort =
	`${appTableHeadLabel} cursor-pointer border-0 bg-transparent p-0 hover:text-slate-300`

/** Inner container: label beside (i) icon; alignment set by parent flex */
export const appTableHeadCellInner =
	'inline-flex items-center gap-0.5'

/** thead row: only a bottom divider; typography lives in appTableHeadLabel* */
export const appTableHeadRow = 'border-b border-slate-700'

/** Default padding for non-sticky thead cells */
export const appTableHeadCellDefault =
	'whitespace-nowrap py-2 pr-1.5 align-middle'

/** Unclaimed column has slightly tighter right padding */
export const appTableHeadCellUnclaimed = 'whitespace-nowrap py-2 pr-1 align-middle'

/** Price range column minimum width */
export const appTableHeadCellPriceRange =
	'min-w-[10.25rem] max-w-none whitespace-nowrap py-2 px-1 align-middle sm:min-w-[11rem]'
