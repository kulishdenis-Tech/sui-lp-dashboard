import fs from 'node:fs'

const files = [
	'src/pages/autopilot/ConstructorPage.tsx',
	'src/pages/autopilot/MarketsPage.tsx',
	'src/pages/autopilot/PreviewDrawer.tsx',
	'src/pages/autopilot/CetusManageMenu.tsx',
	'src/pages/autopilot/BuildPage.tsx',
]
const re = /['"`]([^'"`]*[А-Яа-яЇїІіЄєҐґ][^'"`]*)['"`]/g
for (const f of files) {
	const s = fs.readFileSync(f, 'utf8')
	const out = new Set()
	let m
	while ((m = re.exec(s))) {
		if (m[1].length < 160) out.add(m[1])
	}
	if (out.size) {
		console.log('\n##', f, out.size)
		for (const x of [...out].slice(0, 40)) console.log('-', x)
	}
}
