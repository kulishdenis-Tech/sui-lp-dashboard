import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Node ESM needs extension or index.js — aftermath-ts-sdk imports bare `dayjs/plugin/duration`. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'dayjs', 'plugin')
const plugins = ['duration']

for (const name of plugins) {
	const dir = join(root, name)
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
	const index = join(dir, 'index.js')
	if (!existsSync(index)) {
		writeFileSync(index, `export { default } from '../${name}.js'\n`)
	}
}
