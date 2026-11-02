import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const outfile = 'api/_lib/cron-bundle.mjs'
mkdirSync(dirname(outfile), { recursive: true })

await esbuild.build({
	entryPoints: ['server/cronEntry.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile,
	alias: {
		'@': './src',
	},
	logLevel: 'info',
	sourcemap: false,
	packages: 'external',
})

console.log('Built', outfile)

const quoteOut = 'api/_lib/pool-quote-bundle.mjs'
await esbuild.build({
	entryPoints: ['server/poolQuoteEntry.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile: quoteOut,
	alias: {
		'@': './src',
	},
	logLevel: 'info',
	sourcemap: false,
	packages: 'external',
})
console.log('Built', quoteOut)
