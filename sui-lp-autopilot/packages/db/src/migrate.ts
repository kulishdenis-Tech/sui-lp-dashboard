import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Copies SQL migrations into data/ for operators who prefer real SQLite/Postgres later. */
const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'migrations', '001_init.sql')
const destDir = join(process.cwd(), 'data', 'migrations')
mkdirSync(destDir, { recursive: true })
if (existsSync(src)) {
	copyFileSync(src, join(destDir, '001_init.sql'))
	console.log('Copied 001_init.sql → data/migrations/')
} else {
	console.log('JSON store active; SQL migration file packaged at packages/db/migrations/')
}
