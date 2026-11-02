import fs from 'node:fs'

const map = [
	[
		'CUSTOM: змінено лише ${id}. Перекриття з сусідами перераховано; інші діапазони/budgetи без змін.',
		'CUSTOM: only ${id} edited. Neighbor overlap recalculated; other ranges/budgets unchanged.',
	],
	[
		'CUSTOM: змінено лише ${id}. Other LPs were not shifted.',
		'CUSTOM: only ${id} edited. Other LPs were not shifted.',
	],
	[
		'Сортування за TVL. У списку: fee · TVL · Vol · APR · ціна; іконки монет = rewards.',
		'Sorted by TVL. List shows: fee · TVL · Vol · APR · price; coin icons = rewards.',
	],
	[
		'Fees 24h як % від TVL (денна «оборотність» fees). Не APR.',
		'Fees 24h as % of TVL (daily fee turnover). Not APR.',
	],
	['Геометрія', 'Geometry'],
	[
		'«Від цінового діапазону» рахує ticks. «From count ticks» рахує другу межу.',
		'“From price range” computes ticks. “From count ticks” computes the other bound.',
	],
	[
		'«Від цінового діапазону» рахує bins. «From count bins» рахує другу межу.',
		'“From price range” computes bins. “From count bins” computes the other bound.',
	],
	['Від цінового діапазону', 'From price range'],
	['Ticks per LP (результат)', 'Ticks per LP (result)'],
	['Bins per LP (результат)', 'Bins per LP (result)'],
	['Кількість ticks', 'Tick count'],
	['Кількість bins', 'Bin count'],
	['Ticks (результат)', 'Ticks (result)'],
	['Bins (результат)', 'Bins (result)'],
	['Мін. ціна коридору', 'Min corridor price'],
	['Мін. ціна', 'Min price'],
	['Макс. ціна коридору', 'Max corridor price'],
	['Макс. ціна', 'Max price'],
	['Жорсткий ліміт ціни', 'Hard price limit'],
	['CLMM: суцільний tick-діапазон (без дискретної сітки bins).', 'CLMM: continuous tick range (no discrete bin grid).'],
	['Стратегія потребує виправлення', 'Strategy needs fixes'],
	['Чернетку можна редагувати. Транзакції заблоковані, доки є помилки.', 'Draft is editable. Transactions stay blocked while errors remain.'],
	['Оцінка', 'Estimate'],
	[
		'Indicative розрахунок — стратегія невалідна. Це не виконуваний торговий сценарій.',
		'Indicative estimate — strategy invalid. Not an executable trade plan.',
	],
	['Середня купівля', 'Avg buy'],
	['Середній продаж', 'Avg sell'],
	['Перекриття', 'Overlap'],
	['Скопійовано:', 'Copied:'],
	['Діапазон', 'Range'],
	['Бюджет', 'Budget'],
	['Бюджет ${lp.id}', 'Budget ${lp.id}'],
	['Купівля', 'Buy'],
	['Продаж', 'Sell'],
	['один', 'single'],
	['каскад', 'cascade'],
	['Збережено локально як чернетку.', 'Saved locally as a draft.'],
	['Виправте помилки стратегії', 'Fix strategy errors'],
	['Відновлено останню валідну конфігурацію.', 'Restored last valid configuration.'],
	['Огляд ринку для конструктора. Нові пули тут не створюються.', 'Market overview for the constructor. New pools are not created here.'],
	['Якір', 'Anchor'],
	['Protocol пулів', 'Pool protocol'],
	['Порівняти', 'Compare'],
	['пил приховано', 'dust hidden'],
	['Пули не знайдені.', 'No pools found.'],
	['Native USDC/SUI fee tiers через SDK.', 'Native USDC/SUI fee tiers via SDK.'],
	['Пул', 'Pool'],
	['Ціна', 'Price'],
	['/день', '/day'],
	['Топ пул за TVL у кожному протоколі', 'Top pool by TVL in each protocol'],
	['Немає даних', 'No data'],
	['· геп', '· gap'],
	['Баланс ${walletAssetLabel}', 'Balance ${walletAssetLabel}'],
	['пул', 'pool'],
	['ів', 's'],
]

for (const file of [
	'src/pages/autopilot/ConstructorPage.tsx',
	'src/pages/autopilot/MarketsPage.tsx',
	'src/pages/autopilot/PreviewDrawer.tsx',
	'src/pages/autopilot/LpEditor.tsx',
	'src/pages/autopilot/PoolPicker.tsx',
	'src/pages/autopilot/OverlapControl.tsx',
	'src/pages/autopilot/CetusManageMenu.tsx',
	'src/pages/autopilot/BuildPage.tsx',
	'src/pages/autopilot/MarketsRoutePage.tsx',
]) {
	if (!fs.existsSync(file)) continue
	let s = fs.readFileSync(file, 'utf8')
	let n = 0
	for (const [a, b] of [...map].sort((x, y) => y[0].length - x[0].length)) {
		if (!s.includes(a)) continue
		n += s.split(a).length - 1
		s = s.split(a).join(b)
	}
	fs.writeFileSync(file, s, 'utf8')
	console.log(file, n)
}
