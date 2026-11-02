import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const trackerRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(trackerRoot, '..')

function patchDayjs(dayjsRoot) {
	const pkg = join(dayjsRoot, 'package.json')
	if (!existsSync(pkg)) return
	const durationJs = join(dayjsRoot, 'plugin', 'duration.js')
	if (!existsSync(durationJs)) return
	const index = join(dayjsRoot, 'plugin', 'duration', 'index.js')
	if (!existsSync(index)) {
		mkdirSync(dirname(index), { recursive: true })
		writeFileSync(index, `export { default } from '../duration.js'\n`)
	}
}

/** Node ESM needs an extension — aftermath-ts-sdk imports bare `dayjs/plugin/duration`. */
for (const dayjsRoot of [join(trackerRoot, 'node_modules', 'dayjs'), join(repoRoot, 'node_modules', 'dayjs')]) {
	patchDayjs(dayjsRoot)
}

function patchAftermath(indexPath) {
	if (!existsSync(indexPath)) return
	const src = readFileSync(indexPath, 'utf8')
	const patched = src
		.replaceAll('from "dayjs/plugin/duration"', 'from "dayjs/plugin/duration.js"')
		.replaceAll("from 'dayjs/plugin/duration'", "from 'dayjs/plugin/duration.js'")
	if (patched !== src) {
		writeFileSync(indexPath, patched)
		console.log('Patched aftermath-ts-sdk dayjs/plugin/duration import')
	}
}

patchAftermath(join(trackerRoot, 'node_modules', 'aftermath-ts-sdk', 'dist', 'index.js'))
patchAftermath(join(repoRoot, 'node_modules', 'aftermath-ts-sdk', 'dist', 'index.js'))
