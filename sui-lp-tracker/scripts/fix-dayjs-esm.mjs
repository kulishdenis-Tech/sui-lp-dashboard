import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Node ESM needs extension — aftermath-ts-sdk imports bare `dayjs/plugin/duration`. */
const durationDir = join(root, 'node_modules', 'dayjs', 'plugin', 'duration')
if (!existsSync(durationDir)) mkdirSync(durationDir, { recursive: true })
const index = join(durationDir, 'index.js')
if (!existsSync(index)) {
	writeFileSync(index, `export { default } from '../duration.js'\n`)
}

const aftermathIndex = join(root, 'node_modules', 'aftermath-ts-sdk', 'dist', 'index.js')
if (existsSync(aftermathIndex)) {
	const src = readFileSync(aftermathIndex, 'utf8')
	const patched = src
		.replaceAll('from "dayjs/plugin/duration"', 'from "dayjs/plugin/duration.js"')
		.replaceAll("from 'dayjs/plugin/duration'", "from 'dayjs/plugin/duration.js'")
	if (patched !== src) {
		writeFileSync(aftermathIndex, patched)
		console.log('Patched aftermath-ts-sdk dayjs/plugin/duration import')
	}
}
