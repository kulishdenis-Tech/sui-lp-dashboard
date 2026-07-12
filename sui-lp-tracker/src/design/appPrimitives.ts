/**
 * Спільні класи дизайн-системи. Токени визначені в `src/index.css` (`@theme`).
 * Нові екрани: пріоритет `AppCard` / ці константи замість сирих hex.
 */

/** Обгортка прокрутної таблиці */
export const appTableShell =
	'overflow-x-auto rounded-lg border border-slate-800 bg-app-bg'

/** Карткова поверхня: border + фон карти */
export const appCardSurface =
	'rounded-lg border border-app-border bg-app-card'

/** Плаваючий хедер: напівпрозорий фон поверх контенту */
export const appHeaderSurface = 'border-b border-app-border bg-app-header-bg'

/** Primary CTA (Connect, Refresh) */
export const appBtnPrimary =
	'rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500'

/** Secondary outline — той самий ритм що primary, для Force rescan / Clear cache */
export const appBtnSecondary =
	'rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700 hover:text-white'

/** Disabled overlay для header action-кнопок (колір hover лишає кожна кнопка) */
export const appBtnDisabled = 'disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Роздільник між TabNav (навігація) і action-кластером (Refresh…).
 * Мобайл — горизонтальна лінія; desktop — вертикальний sep.
 */
export const appHeaderToolbarSep =
	'h-px w-full shrink-0 bg-slate-700/80 sm:h-7 sm:w-px sm:self-center'

/** Ряд кнопок портфеля поруч із вкладками */
export const appHeaderActionCluster = 'flex flex-nowrap items-center gap-1.5'

/** Компактні secondary у хедері (щоб вкластись в 1 рядок з TabNav + wallet) */
export const appBtnSecondaryCompact =
	'rounded-lg border border-slate-600 bg-slate-800/70 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700 hover:text-white'

/**
 * Ліва «Pool» колонка (sticky): заголовок і комірка з тим самим фоном.
 */
export const appTablePoolStickyTh =
	'sticky left-0 z-10 min-w-0 max-w-[10.5rem] align-middle bg-app-bg py-2 pr-1.5 text-center'

export const appTablePoolStickyTd =
	'sticky left-0 z-10 min-w-0 max-w-[10.5rem] align-middle bg-app-bg py-2 pr-1.5 transition-colors group-hover:bg-app-row-hover'

/**
 * Комірка тіла таблиці: фон сцени + підсвітка рядка при group-hover (без sticky).
 */
export const appTableTd =
	'bg-app-bg py-2 pr-1.5 align-middle transition-colors group-hover:bg-app-row-hover'

export const appTableTdRightMono =
	`${appTableTd} text-right font-mono text-slate-100`.trim()

export const appTableTdWideUnclaimed =
	'max-w-[7.25rem] whitespace-nowrap bg-app-bg py-2 pr-1 text-right align-middle font-mono text-slate-200 transition-colors group-hover:bg-app-row-hover'

export const appTableTdRangeCell =
	'min-w-[10.25rem] max-w-none bg-app-bg py-2 pl-1 pr-0.5 align-middle transition-colors group-hover:bg-app-row-hover sm:min-w-[11rem]'

/** Подвійна іконка в рядку: ring під колір фону таблиці + hover як у комірках */
export const appTableTokenOverlapRing =
	'rounded-full ring-2 ring-app-bg group-hover:ring-app-row-hover'

/*
 * ─── Заголовки колонок data-table (єдиний візуальний патерн, як колонка Unclaimed) ───
 * Текст + gap-0.5 + TooltipIconButton. Не став `uppercase` на `<tr>` — лише на label (`appTableHeadLabel`).
 */

/** Напис заголовка (UPPERCASE через CSS для консистентності) */
export const appTableHeadLabel =
	'text-xs font-normal uppercase tracking-wide text-slate-500'

/** Інтерактивний заголовок (сортування): ті самі метрики тексту + hover без «кнопкового» вигляду */
export const appTableHeadLabelSort =
	`${appTableHeadLabel} cursor-pointer border-0 bg-transparent p-0 hover:text-slate-300`

/** Внутрішній контейнер: підпис поруч із (i); вирівнювання задає батьківський flex */
export const appTableHeadCellInner =
	'inline-flex items-center gap-0.5'

/** Рядок thead: лише divider; типографіка тільки в `appTableHeadLabel*` */
export const appTableHeadRow = 'border-b border-slate-700'

/** Стандартний padding для неклейної колонки thead */
export const appTableHeadCellDefault =
	'whitespace-nowrap py-2 pr-1.5 align-middle'

/** Колонка Unclaimed трохи вужча по padding */
export const appTableHeadCellUnclaimed = 'whitespace-nowrap py-2 pr-1 align-middle'

/** Мінімальна ширина колонки діапазону ціни */
export const appTableHeadCellPriceRange =
	'min-w-[10.25rem] max-w-none whitespace-nowrap py-2 px-1 align-middle sm:min-w-[11rem]'
