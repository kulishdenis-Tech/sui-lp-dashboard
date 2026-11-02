import fs from 'node:fs'

const p = 'src/pages/autopilot/ConstructorPage.tsx'
let s = fs.readFileSync(p, 'utf8')
const pairs = [
	['лише змінено', 'only edited'],
	['Перекриття з сусідами перераховано — інші діапазони без змін.', 'Neighbor overlap recalculated — other ranges unchanged.'],
	['Інші LP не зсувались.', 'Other LPs were not shifted.'],
	['BUY — купівля SUI', 'BUY — buy SUI'],
	['SELL — продаж SUI', 'SELL — sell SUI'],
	['купівля SUI', 'buy SUI'],
	['продаж SUI', 'sell SUI'],
	['Про вибір пулу', 'About pool selection'],
	['Сортування списку', 'List sorting'],
	['іконки монет сховано', 'coin icons hidden'],
	['денна оборотність', 'daily turnover'],
	['Не розподілено', 'Not allocated'],
	['Розподілено по LP', 'Allocated across LPs'],
	['геп до тоталу', 'gap to total'],
	['тотал збігається з тоталом', 'matches investment total'],
	['Від коридору', 'From corridor'],
	['ціни задають діапазон, ticks/bins на LP рахуються', 'prices set the range; ticks/bins per LP are computed'],
	['Від кількості', 'From count'],
	['Жорстка межа', 'Hard bound'],
	['Жорсткий стоп', 'Hard stop'],
	['Нижня ціна', 'Lower price'],
	['Верхня ціна', 'Upper price'],
	['Активний зараз', 'Active now'],
	['Повна конверсія', 'Fully converted'],
	['Початок конверсії', 'Conversion starts'],
	['Середня ціна', 'Average price'],
	['Зберегти конфіг', 'Save config'],
	['Відкрити preview / підпис', 'Open preview / sign'],
	['Немає помилок', 'No errors'],
	['Блокуючі помилки', 'Blocking errors'],
	['Попередження', 'Warnings'],
	['Обраний LP', 'Selected LP'],
	['Редагувати LP', 'Edit LP'],
	['Скинути ручні правки', 'Reset manual edits'],
	['Додати LP', 'Add LP'],
	['Видалити LP', 'Remove LP'],
	['Скасувати', 'Undo'],
	['Повторити', 'Redo'],
	['приховати bins', 'hide bins'],
	['комісій', 'fees'],
	['Ціна як від', 'Price as from'],
	['ціна ·', 'price ·'],
]
pairs.sort((a, b) => b[0].length - a[0].length)
let n = 0
for (const [a, b] of pairs) {
	if (!s.includes(a)) continue
	n += s.split(a).length - 1
	s = s.split(a).join(b)
}
fs.writeFileSync(p, s, 'utf8')
console.log('Constructor replacements', n)
const left = [...s.matchAll(/[А-Яа-яЇїІіЄєҐґ]{4,}/g)].map((x) => x[0])
console.log('sample left', [...new Set(left)].slice(0, 30).join(', '))
